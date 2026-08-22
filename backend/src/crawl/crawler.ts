import { fetchWitnessMarkdown } from '../brightdata/unlocker.js';
import { corroborate, readMarkdown, type OpportunityDraft } from '../acquire/read.js';
import { buildQueries } from '../acquire/queries.js';
import { mergeResults, search } from '../acquire/serp.js';
import type { DoorwayProfile } from '../doorway/types.js';
import { Frontier, DEFAULT_LIMITS, type FrontierLimits } from './frontier.js';
import { harvestLinks, looksHarvestable } from './harvest.js';

/**
 * Crawl, rather than search.
 *
 * The difference is the queue. A search asks a question, opens the dozen pages
 * it gets back, and forgets everything. A crawl treats those dozen pages as the
 * beginning: each one is read for what it is *and* mined for where it points,
 * and the pages it points at go into a queue that outlives the request.
 *
 * That is what turns twelve fetches into hundreds. A single roundup of "50
 * fully funded scholarships" contributes fifty frontier entries for one page
 * load, and each of those may be a real opportunity page or another index. The
 * listing pages discovery throws away are the cheapest source of reach
 * available, and they were being read for the wrong thing.
 *
 * Concurrency is where Bright Data earns its place. The unlocker will take
 * dozens of simultaneous requests against dozens of hosts, each from a
 * different exit, without any of the rate limiting, blocking or proxy rotation
 * a crawler normally spends most of its code on. Removing that concern is what
 * makes this a few hundred lines instead of a few thousand.
 */

export interface CrawlConfig {
  apiKey: string;
  zone: string;
  baseUrl?: string;
  country?: string;
}

export interface CrawlEvent {
  step: 'seeding' | 'seeded' | 'fetching' | 'kept' | 'harvested' | 'dropped' | 'progress' | 'done' | 'error';
  line: string;
  detail?: Record<string, unknown>;
}

export interface CrawlResult {
  drafts: OpportunityDraft[];
  fetched: number;
  hosts: number;
  harvested: number;
  startedAt: string;
  finishedAt: string;
}

export interface CrawlOptions {
  limits?: Partial<FrontierLimits>;
  /**
   * Simultaneous fetches.
   *
   * The unlocker handles far more than this; the binding constraint is that a
   * crawl should not spend its whole budget before anybody can look at what it
   * found. Twenty keeps a few hundred pages inside a couple of minutes.
   */
  concurrency?: number;
  /** How many searches to seed from. Each is one request. */
  maxSeedQueries?: number;
  signal?: AbortSignal;
  onEvent?: (event: CrawlEvent) => void;
}

/**
 * Run one page: read it as an opportunity, and mine it for links either way.
 *
 * Both, not one or the other. A page can be a real opportunity that also links
 * to its sibling programmes, and a crawler that stops looking once it has found
 * something misses most of a university's funding section.
 */
async function visit(
  config: CrawlConfig,
  url: string,
  hint: string,
  depth: number,
  frontier: Frontier,
  signal: AbortSignal | undefined,
): Promise<{ draft: OpportunityDraft | null; harvested: number }> {
  let markdown: string;
  try {
    const fetched = await fetchWitnessMarkdown(
      {
        apiKey: config.apiKey,
        zone: config.zone,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.country === undefined ? {} : { country: config.country }),
      },
      url,
      signal,
    );
    markdown = fetched.markdown;
  } catch {
    return { draft: null, harvested: 0 };
  }

  if (markdown.trim().length < 300) return { draft: null, harvested: 0 };

  /*
   * Mine first, judge second.
   *
   * A page that fails every test for being an opportunity is often the best
   * index on the crawl, and the fetch has already been paid for. Harvesting
   * before deciding means a rejected page still earns its cost.
   */
  let harvested = 0;
  const isIndex = looksHarvestable(markdown, url);
  for (const link of harvestLinks(markdown, url, { limit: isIndex ? 120 : 30 })) {
    // A link off an index is more likely to be an opportunity than a link off
    // an opportunity, which is usually navigation.
    const added = frontier.add({
      url: link.url,
      depth: depth + 1,
      hint: link.text,
      discoveredOn: url,
      priority: isIndex ? 2 : 1,
    });
    if (added) harvested += 1;
  }

  const draft = readMarkdown(markdown, {
    url,
    title: hint,
    description: '',
    host: new URL(url).host.replace(/^www\./, ''),
    official: false,
    query: 'crawl',
  });

  return { draft, harvested };
}

async function drain<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Seed a crawl from searches, then follow what it finds.
 *
 * The searches exist to find entry points, not answers. Their results are
 * queued rather than returned, and the interesting pages are usually two links
 * further in: an aggregator's roundup leads to a university's funding index,
 * which leads to the individual programme pages nobody searches for by name.
 */
export async function crawl(
  config: CrawlConfig,
  profile: DoorwayProfile,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const startedAt = new Date().toISOString();
  const emit = options.onEvent ?? ((): void => undefined);
  /*
   * The unlocker is not the bottleneck; our own timidity was.
   *
   * A single unlocker fetch takes tens of seconds, because it is doing the
   * unblocking a crawler normally writes thousands of lines to avoid. At a
   * concurrency of twenty that put throughput at a third of a page per second,
   * which is a crawl nobody will wait for. The requests are independent and
   * spread across dozens of hosts, so the limit is how many are in flight, and
   * that number can be much larger than instinct suggests.
   */
  const concurrency = options.concurrency ?? 60;
  const limits: FrontierLimits = { ...DEFAULT_LIMITS, ...options.limits };

  const frontier = new Frontier(limits);
  const drafts = new Map<string, OpportunityDraft>();
  let harvested = 0;

  const queries = buildQueries(profile, { maxTypes: 6 }).slice(0, options.maxSeedQueries ?? 8);
  emit({
    step: 'seeding',
    line: `seeding          ${String(queries.length)} searches`,
    detail: { queries: queries.map((query) => query.text) },
  });

  const batches = await Promise.all(
    queries.map(async (query) =>
      search(config, query.text, {
        count: 20,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    ),
  );

  // Everything the searches found is a seed, including the listing pages: at
  // depth zero their value is the links they carry.
  const seeds = mergeResults(batches, { perHost: 6, perPrimaryHost: 12, limit: 120 });
  for (const seed of seeds) {
    frontier.add({ url: seed.url, depth: 0, hint: seed.title, priority: seed.official ? 3 : 2 });
  }

  emit({
    step: 'seeded',
    line: `seeded           ${String(frontier.size)} pages across ${String(new Set(seeds.map((s) => s.host)).size)} sites`,
    detail: frontier.stats(),
  });

  while (!frontier.exhausted) {
    const batch = frontier.take(concurrency);
    if (batch.length === 0) break;
    if (options.signal?.aborted === true) break;

    emit({
      step: 'fetching',
      line: `fetching         ${String(batch.length)} pages at once`,
      detail: frontier.stats(),
    });

    await drain(batch, concurrency, async (entry) => {
      const { draft, harvested: found } = await visit(
        config,
        entry.url,
        entry.hint,
        entry.depth,
        frontier,
        options.signal,
      );
      harvested += found;

      if (draft === null) {
        emit({ step: 'dropped', line: `not an opportunity ${entry.host}` });
        return;
      }
      /*
       * The same opportunity, reached twice, is one opportunity.
       *
       * A crawl finds the Anthropic Fellows programme at its own URL and again
       * at the anchor an aggregator uses, and dedup by URL alone let both
       * through. What a student cares about is the name and who is offering it,
       * so that is the identity.
       */
      const identity = `${draft.host}:${draft.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      if (!drafts.has(identity)) {
        /*
         * Ask the page's structured data before keeping it.
         *
         * One more request per kept page, not per page fetched, so the cost
         * scales with what is worth keeping rather than with the crawl. It buys
         * the deadlines the visible text never yielded and, where the text did
         * yield one, a second independent reading that agrees or does not.
         */
        const checked = await corroborate(config, draft, options.signal);
        drafts.set(identity, checked);
        emit({
          step: 'kept',
          line: `found            ${checked.title.slice(0, 56)}${checked.corroboration === 'confirmed' ? ' (confirmed)' : checked.corroboration === 'conflicting' ? ' (readings disagree)' : ''}`,
          detail: {
            url: checked.sourceUrl,
            deadline: checked.deadlineRaw,
            corroboration: checked.corroboration,
          },
        });
      }
    });

    const stats = frontier.stats();
    emit({
      step: 'progress',
      line: `progress         ${String(stats.fetched)} read, ${String(drafts.size)} found, ${String(stats.queued)} queued`,
      detail: { ...stats, found: drafts.size, harvested },
    });
  }

  const stats = frontier.stats();
  emit({
    step: 'done',
    line: `done             ${String(drafts.size)} opportunities from ${String(stats.fetched)} pages across ${String(stats.hosts)} sites`,
    detail: { ...stats, found: drafts.size, harvested },
  });

  return {
    drafts: [...drafts.values()],
    fetched: stats.fetched,
    hosts: stats.hosts,
    harvested,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
