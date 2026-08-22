/**
 * What to fetch next, and what never to fetch twice.
 *
 * A crawl is only as good as its queue. Without one you get the thing this
 * project had: a search that opens a dozen pages, throws away everything it
 * learned, and starts from nothing next time. With one, every listing page read
 * makes the next crawl bigger, and the work compounds instead of evaporating.
 *
 * Three properties matter more than speed.
 *
 * Deduplication, because the same scholarship is linked from forty aggregators
 * and fetching it forty times spends forty page loads to learn one fact.
 *
 * Host fairness, because a crawler that follows every link it finds ends up
 * inside whichever site has the most internal navigation, and comes back with
 * one site's opinion of the world. Depth-first is the natural shape of a naive
 * crawl and the wrong one.
 *
 * A hard ceiling, because every fetch is a paid request. A queue that cannot
 * run out of money is not a queue, it is a way to discover your billing limit.
 */

export interface FrontierEntry {
  url: string;
  host: string;
  /** How many links away from a seed. Seeds are 0. */
  depth: number;
  /** Higher is fetched sooner. */
  priority: number;
  /** The anchor text that led here, which is often the opportunity's name. */
  hint: string;
  discoveredOn: string | null;
}

export interface FrontierLimits {
  /** The most URLs that may ever be fetched in one crawl. */
  maxFetches: number;
  /** The most that may come from any single host. */
  maxPerHost: number;
  /** How far from a seed a link may be followed. */
  maxDepth: number;
}

export const DEFAULT_LIMITS: FrontierLimits = {
  maxFetches: 500,
  maxPerHost: 40,
  maxDepth: 2,
};

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Two URLs that differ only in trailing slash are the same page.
 *
 * Not a general canonicaliser and not trying to be. It handles the cases that
 * actually duplicate: the trailing slash, the scheme, and the www prefix. Being
 * clever here risks collapsing two genuinely different pages into one, and
 * missing an opportunity is worse than fetching a page twice.
 */
export function canonical(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.protocol = 'https:';
    parsed.host = parsed.host.toLowerCase().replace(/^www\./, '');
    let path = parsed.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return url;
  }
}

export class Frontier {
  readonly #limits: FrontierLimits;
  /** Every URL ever admitted or rejected, so nothing is considered twice. */
  readonly #seen = new Set<string>();
  readonly #queued: FrontierEntry[] = [];
  readonly #takenPerHost = new Map<string, number>();
  #taken = 0;

  constructor(limits: FrontierLimits = DEFAULT_LIMITS) {
    this.#limits = limits;
  }

  get size(): number {
    return this.#queued.length;
  }

  get fetched(): number {
    return this.#taken;
  }

  get exhausted(): boolean {
    return this.#taken >= this.#limits.maxFetches;
  }

  /** How many distinct hosts are represented, which is the reach of the crawl. */
  get hosts(): number {
    return this.#takenPerHost.size;
  }

  /**
   * Offer a URL. Returns whether it was queued.
   *
   * Rejection is silent and cheap on purpose: this is called with every link on
   * every page, and most of them are navigation.
   */
  add(entry: {
    url: string;
    depth: number;
    hint?: string;
    discoveredOn?: string | null;
    priority?: number;
  }): boolean {
    if (entry.depth > this.#limits.maxDepth) return false;

    const url = canonical(entry.url);
    if (this.#seen.has(url)) return false;

    const host = hostOf(url);
    if (host === '') return false;

    this.#seen.add(url);
    this.#queued.push({
      url,
      host,
      depth: entry.depth,
      priority: entry.priority ?? 0,
      hint: entry.hint ?? '',
      discoveredOn: entry.discoveredOn ?? null,
    });
    return true;
  }

  /**
   * The next batch to fetch, spread across hosts.
   *
   * Round-robin rather than priority-sorted, because a queue drained in
   * priority order still ends up host-clustered: the highest-scoring links on a
   * page are that page's own siblings. Taking one per host per pass is what
   * actually keeps a crawl broad, and within a host the priority still decides
   * which goes first.
   */
  take(count: number): FrontierEntry[] {
    const batch: FrontierEntry[] = [];
    if (this.exhausted) return batch;

    const byHost = new Map<string, FrontierEntry[]>();
    for (const entry of this.#queued) {
      const bucket = byHost.get(entry.host);
      if (bucket === undefined) byHost.set(entry.host, [entry]);
      else bucket.push(entry);
    }

    for (const bucket of byHost.values()) {
      bucket.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
    }

    const hosts = [...byHost.keys()];
    const taken = new Set<FrontierEntry>();

    let progress = true;
    while (batch.length < count && progress) {
      progress = false;
      for (const host of hosts) {
        if (batch.length >= count) break;
        if (this.#taken + batch.length >= this.#limits.maxFetches) break;

        const used = this.#takenPerHost.get(host) ?? 0;
        const pending = batch.filter((entry) => entry.host === host).length;
        if (used + pending >= this.#limits.maxPerHost) continue;

        const bucket = byHost.get(host) ?? [];
        const next = bucket.find((entry) => !taken.has(entry));
        if (next === undefined) continue;

        taken.add(next);
        batch.push(next);
        progress = true;
      }
    }

    // Remove what was handed out, and record the spend.
    if (taken.size > 0) {
      for (let index = this.#queued.length - 1; index >= 0; index--) {
        const entry = this.#queued[index];
        if (entry !== undefined && taken.has(entry)) this.#queued.splice(index, 1);
      }
      for (const entry of batch) {
        this.#takenPerHost.set(entry.host, (this.#takenPerHost.get(entry.host) ?? 0) + 1);
      }
      this.#taken += batch.length;
    }

    return batch;
  }

  /** A snapshot for reporting, cheap enough to call every batch. */
  stats(): { queued: number; fetched: number; hosts: number; remaining: number } {
    return {
      queued: this.#queued.length,
      fetched: this.#taken,
      hosts: this.#takenPerHost.size,
      remaining: Math.max(0, this.#limits.maxFetches - this.#taken),
    };
  }
}
