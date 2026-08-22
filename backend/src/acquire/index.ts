import type { DoorwayProfile } from '../doorway/types.js';
import { buildQueries } from './queries.js';
import { mergeResults, search, type SerpResult } from './serp.js';
import { corroborate, readCandidate, type OpportunityDraft } from './read.js';

export type { OpportunityDraft } from './read.js';
export type { SerpResult } from './serp.js';
export { OPPORTUNITY_SPECS } from './read.js';
export { buildQueries } from './queries.js';
export { mergeResults, search } from './serp.js';

/**
 * Find opportunities for one student, now, from the live web.
 *
 * Three moves: ask a search engine several narrow questions, decide which
 * answers are worth the cost of opening, then read each one by label the way
 * the witness does.
 *
 * The honesty constraint is the whole design. Everything this produces has
 * been read exactly once, by one sensor, and has no history to be checked
 * against. That is strictly weaker than anything in the verified feed, and the
 * drafts say so rather than arriving alongside verified records looking the
 * same. A student can tell, at a glance, the difference between "we found this
 * for you a moment ago" and "we have been watching this and will stand behind
 * it".
 */

export interface DiscoveryConfig {
  apiKey: string;
  zone: string;
  baseUrl?: string;
  /** Where to appear to browse from. Funding pages are frequently geo-fenced. */
  country?: string;
}

export interface DiscoveryEvent {
  step: 'searching' | 'searched' | 'reading' | 'read' | 'skipped' | 'done';
  line: string;
  detail?: Record<string, unknown>;
}

export interface DiscoveryResult {
  drafts: OpportunityDraft[];
  /** Every candidate considered, so the count of what was rejected is visible. */
  considered: number;
  queries: string[];
  startedAt: string;
  finishedAt: string;
}

export interface DiscoverOptions {
  /** How many candidate pages to open. Each one is a Web Unlocker request. */
  maxPages?: number;
  /** How many opportunity types to search for. */
  maxTypes?: number;
  signal?: AbortSignal;
  onEvent?: (event: DiscoveryEvent) => void;
}

/**
 * How many pages to read at once.
 *
 * Sequential reading of twelve pages takes long enough that a student assumes
 * the page has hung. Unbounded parallelism trips rate limits and turns a slow
 * result into no result. Four is comfortably under the limit and finishes in a
 * time somebody will wait for.
 */
const READ_CONCURRENCY = 4;

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item, index);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function discover(
  config: DiscoveryConfig,
  profile: DoorwayProfile,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const maxPages = options.maxPages ?? 10;
  const startedAt = new Date().toISOString();
  const emit = options.onEvent ?? ((): void => undefined);

  const queries = buildQueries(profile, {
    ...(options.maxTypes === undefined ? {} : { maxTypes: options.maxTypes }),
  });

  emit({
    step: 'searching',
    line: `searching        ${String(queries.length)} queries for ${profile.educationLevel.toLowerCase()} in ${profile.country}`,
    detail: { queries: queries.map((query) => query.text) },
  });

  // Searches run together. They are independent and each takes tens of
  // seconds, so running them in sequence would dominate the whole request.
  const batches = await Promise.all(
    queries.map(async (query) =>
      search(
        config,
        query.text,
        {
          count: 20,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      ),
    ),
  );

  // Remember which query produced which result, so a draft can say where it
  // came from and so the type guess has somewhere to start.
  const typeByUrl = new Map<string, (typeof queries)[number]>();
  batches.forEach((batch, index) => {
    const query = queries[index];
    if (query === undefined) return;
    for (const result of batch) if (!typeByUrl.has(result.url)) typeByUrl.set(result.url, query);
  });

  const candidates: SerpResult[] = mergeResults(batches, { limit: maxPages, perHost: 2 });

  emit({
    step: 'searched',
    line: `found            ${String(candidates.length)} candidate pages worth opening`,
    detail: {
      candidates: candidates.map((candidate) => candidate.url),
      official: candidates.filter((candidate) => candidate.official).length,
    },
  });

  const drafts = await mapWithLimit(candidates, READ_CONCURRENCY, async (candidate) => {
    emit({ step: 'reading', line: `reading          ${candidate.host}` });

    const query = typeByUrl.get(candidate.url);
    const draft = await readCandidate(
      config,
      candidate,
      query?.type ?? 'scholarship',
      options.signal,
    );

    if (draft === null) {
      emit({
        step: 'skipped',
        line: `not an opportunity ${candidate.host}`,
        detail: { url: candidate.url },
      });
      return null;
    }

    const corroborated = await corroborate(config, draft, options.signal);

    emit({
      step: 'read',
      line: `read             ${corroborated.title.slice(0, 58)}`,
      detail: {
        url: corroborated.sourceUrl,
        deadline: corroborated.deadlineRaw,
        status: corroborated.applicationStatus,
        sensors: corroborated.sensorCount,
        missing: corroborated.missing,
      },
    });
    return corroborated;
  });

  const kept = drafts.filter((draft): draft is OpportunityDraft => draft !== null);

  emit({
    step: 'done',
    line: `done             ${String(kept.length)} opportunities from ${String(candidates.length)} pages`,
    detail: { kept: kept.length, considered: candidates.length },
  });

  return {
    drafts: kept,
    considered: candidates.length,
    queries: queries.map((query) => query.text),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
