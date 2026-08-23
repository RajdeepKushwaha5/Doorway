import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OpportunityDraft } from '../acquire/read.js';

/**
 * What the crawl found, kept.
 *
 * Without this a crawl is a very expensive way to answer one question. Six
 * hundred page loads produce a list, the request ends, and the next student
 * pays for the same six hundred fetches to be told something similar. Nothing
 * accumulates, and the system is permanently as ignorant as it was on its first
 * day.
 *
 * With it, the crawl becomes the product and a search becomes a lookup. A
 * student's question is answered out of what is already known, in milliseconds,
 * across everything every previous crawl reached. The live search stops being
 * the way results are produced and becomes the way the index is topped up.
 *
 * Deliberately a file rather than a database. The store this sits beside is a
 * file for the same reason, the deployment target has no disk worth the name,
 * and introducing Postgres to hold a few thousand rows would be a bigger change
 * than the problem justifies. The interface is narrow enough that swapping it
 * later is an afternoon.
 */

/** A crawled opportunity, plus when we last saw it. */
export interface IndexedOpportunity extends OpportunityDraft {
  /** First time any crawl reached this page. */
  firstSeenAt: string;
  /** Most recent crawl that reached it, so staleness is answerable. */
  lastSeenAt: string;
  /** How many separate crawls have found it, a rough confidence signal. */
  timesSeen: number;
}

export interface IndexStats {
  total: number;
  hosts: number;
  withDeadline: number;
  withFunding: number;
  updatedAt: string | null;
  /**
   * How far the last crawl actually reached.
   *
   * The crawler has always known this and always thrown it away: it printed
   * "58 opportunities from 200 pages across 85 sites" to a log line nobody
   * kept. So the only number on the site was the size of the fleet, which is
   * six, and a reader reasonably concluded that six pages was the whole
   * system.
   *
   * The reach is the answer to whether this scales, and it was invisible.
   * Reported per crawl rather than as a lifetime total, because a lifetime
   * total on a host with no persistent disk is a number that resets and is
   * therefore a claim nobody can check.
   */
  reach: { pagesRead: number; hostsReached: number; at: string } | null;
}

/**
 * The identity of an opportunity, for merging.
 *
 * Host plus normalised title rather than URL. The same programme is reachable
 * at several URLs, and a student would call all of them the same thing.
 */
function identityOf(draft: OpportunityDraft): string {
  const title = draft.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${draft.host}:${title}`;
}

export class OpportunityIndex {
  readonly #path: string;
  #records = new Map<string, IndexedOpportunity>();
  #loaded = false;
  #reach: IndexStats['reach'] = null;
  #writing: Promise<void> = Promise.resolve();

  constructor(path?: string) {
    this.#path = path ?? join(process.cwd(), 'data', 'opportunity-index.json');
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    try {
      const raw = await readFile(this.#path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      /*
       * Two shapes, because the file used to be a bare array.
       *
       * An index written before reach was recorded still loads, and loses
       * nothing but a number it never had.
       */
      const entries: unknown = Array.isArray(parsed)
        ? parsed
        : (parsed as { records?: unknown } | null)?.records;
      if (Array.isArray(entries)) {
        for (const entry of entries as readonly unknown[]) {
          if (entry === null || typeof entry !== 'object') continue;
          const record = entry as IndexedOpportunity;
          if (typeof record.sourceUrl !== 'string') continue;
          this.#records.set(identityOf(record), record);
        }
      }
      if (!Array.isArray(parsed)) {
        const stored = (parsed as { reach?: unknown } | null)?.reach;
        if (stored !== null && typeof stored === 'object') {
          this.#reach = stored as IndexStats['reach'];
        }
      }
    } catch {
      // A missing or unreadable index is an empty one. Refusing to start over
      // a cache would be a strange way to treat a cache.
    }
    this.#loaded = true;
  }

  /**
   * Write through a temporary file.
   *
   * A crawl writes the index while requests are reading it, and a truncated
   * JSON file is indistinguishable from an empty one on the next boot. Rename
   * is atomic on every filesystem this runs on.
   */
  async #persist(): Promise<void> {
    const snapshot = { records: [...this.#records.values()], reach: this.#reach };
    this.#writing = this.#writing.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      const temporary = `${this.#path}.${String(process.pid)}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
      await rename(temporary, this.#path);
    });
    await this.#writing;
  }

  /**
   * Merge a crawl's findings in.
   *
   * A record seen again is refreshed rather than replaced wholesale: the newer
   * read wins on every field, because a page's current text is the truth, but
   * the first-seen date and the count survive. Those two are the only things
   * the index knows that no single crawl does.
   */
  async merge(drafts: readonly OpportunityDraft[]): Promise<{ added: number; refreshed: number }> {
    await this.#load();

    let added = 0;
    let refreshed = 0;
    const at = new Date().toISOString();

    for (const draft of drafts) {
      const key = identityOf(draft);
      const existing = this.#records.get(key);

      if (existing === undefined) {
        this.#records.set(key, { ...draft, firstSeenAt: at, lastSeenAt: at, timesSeen: 1 });
        added += 1;
      } else {
        this.#records.set(key, {
          ...draft,
          firstSeenAt: existing.firstSeenAt,
          lastSeenAt: at,
          timesSeen: existing.timesSeen + 1,
        });
        refreshed += 1;
      }
    }

    await this.#persist();
    return { added, refreshed };
  }

  /** Everything known. */
  async all(): Promise<IndexedOpportunity[]> {
    await this.#load();
    return [...this.#records.values()];
  }

  /**
   * What matches this student, scored on the words they gave.
   *
   * Deliberately simple. The real matching lives in the Doorway layer, which
   * scores against eligibility, funding and deadlines; this is the coarse pass
   * that decides which few hundred records are worth handing it.
   */
  async search(
    terms: readonly string[],
    types: readonly string[],
    limit = 60,
  ): Promise<IndexedOpportunity[]> {
    await this.#load();

    const wanted = new Set(types.map((type) => type.toLowerCase()));
    const words = terms
      .flatMap((term) => term.toLowerCase().split(/[^a-z0-9]+/))
      .filter((word) => word.length > 2);

    const scored: { record: IndexedOpportunity; score: number }[] = [];

    for (const record of this.#records.values()) {
      if (wanted.size > 0 && !wanted.has(record.type.toLowerCase())) continue;

      const haystack =
        `${record.title} ${record.summary} ${record.eligibility ?? ''} ${record.provider}`.toLowerCase();

      // Type is a filter; interest is a ranking signal. Requiring the page to
      // repeat every word typed by the student made "Artificial intelligence"
      // exclude pages that simply say "AI", and could turn a healthy index
      // into one unrelated result.
      let score = 1;
      for (const word of words) if (haystack.includes(word)) score += 1;
      if (terms.some((term) => mentionsAlias(haystack, term))) score += 1;

      // A stated deadline and a stated amount are what a student can act on,
      // so a record carrying them outranks one that does not.
      if (record.deadlineRaw !== null) score += 0.5;
      if (record.fundingLevel !== null) score += 0.5;
      if (record.official) score += 0.5;

      scored.push({ record, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((entry) => entry.record);
  }

  async stats(): Promise<IndexStats> {
    await this.#load();
    const records = [...this.#records.values()];
    return {
      total: records.length,
      hosts: new Set(records.map((record) => record.host)).size,
      withDeadline: records.filter((record) => record.deadlineRaw !== null).length,
      withFunding: records.filter((record) => record.fundingLevel !== null).length,
      updatedAt:
        records.length === 0
          ? null
          : records.reduce((latest, record) => (record.lastSeenAt > latest ? record.lastSeenAt : latest), ''),
      reach: this.#reach,
    };
  }

  /**
   * Record how far a finished crawl reached.
   *
   * Kept because it is the only number that answers whether this scales past
   * the handful of collectors under continuous watch, and the crawler was
   * printing it and discarding it.
   */
  async recordReach(pagesRead: number, hostsReached: number): Promise<void> {
    await this.#load();
    this.#reach = { pagesRead, hostsReached, at: new Date().toISOString() };
    await this.#persist();
  }
}

function mentionsAlias(haystack: string, term: string): boolean {
  const normalized = term.toLowerCase().trim();
  const aliases: Record<string, string[]> = {
    'artificial intelligence': ['ai', 'machine learning', 'ml', 'deep learning'],
    'machine learning': ['ml', 'ai', 'artificial intelligence'],
    'computer science': ['cs', 'computing', 'software'],
    'data science': ['analytics', 'machine learning'],
  };
  return (aliases[normalized] ?? []).some((alias) =>
    new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack),
  );
}
