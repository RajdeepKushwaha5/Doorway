import { brightDataRequest } from '../brightdata/http.js';
import { looksOfficial } from './queries.js';

/**
 * Search, through Bright Data, and get structured results back.
 *
 * Appending `brd_json=1` to a search URL makes Bright Data parse the results
 * page server-side and return organic results as JSON. That matters more than
 * convenience: scraping a search page's markup is exactly the brittle,
 * position-bound extraction this project exists to complain about, and doing
 * it here would be indefensible.
 *
 * This is the same Web Unlocker zone the witness uses. No second credential
 * and no second vendor.
 */

export interface SerpResult {
  url: string;
  title: string;
  description: string;
  host: string;
  /** Whether the host publishes funding rather than writing about it. */
  official: boolean;
  /** Which query surfaced it, kept so a result can explain where it came from. */
  query: string;
}

interface SerpConfig {
  apiKey: string;
  zone: string;
  baseUrl?: string;
}

/**
 * Hosts that will never be an opportunity page.
 *
 * Social and video results are common for funding terms and are never the
 * thing itself. Dropping them here rather than after fetching saves a Web
 * Unlocker request each, which is the expensive step.
 */
const NEVER = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'quora.com',
  // Every LinkedIn path, not just /posts. A /pulse article passed the old
  // filter and produced an opportunity whose title was "Sign in to view more
  // content" and whose funding level was the post's own headline, emoji and
  // all. The page a signed-out reader gets is a sign-in wall wearing the
  // article's clothes.
  'linkedin.com',
  'google.',
  'gstatic.com',
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Run one query and return the organic results.
 *
 * Returns an empty list rather than throwing when a query fails. One search
 * failing is not a reason to abandon a student's whole request, and the caller
 * runs several.
 */
export async function search(
  config: SerpConfig,
  query: string,
  options: { count?: number; country?: string; signal?: AbortSignal } = {},
): Promise<SerpResult[]> {
  const count = options.count ?? 20;
  const url =
    'https://www.google.com/search?q=' +
    encodeURIComponent(query) +
    `&num=${String(count)}&brd_json=1`;

  let body: unknown;
  try {
    body = await brightDataRequest(config.apiKey, config.baseUrl ?? 'https://api.brightdata.com', {
      method: 'POST',
      path: '/request',
      body: { zone: config.zone, url, format: 'raw' },
      // A search through the unlocker routinely takes tens of seconds. The
      // default here would abandon most of them.
      timeoutMs: 90_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    return [];
  }

  // The unlocker returns the parsed page as a JSON string on the raw format.
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return [];
    }
  }

  if (!isRecord(parsed)) return [];
  const organic = parsed['organic'];
  if (!Array.isArray(organic)) return [];

  const results: SerpResult[] = [];
  for (const entry of organic) {
    if (!isRecord(entry)) continue;
    const link = text(entry['link']);
    if (link === '') continue;

    const host = hostOf(link);
    if (host === null) continue;
    if (NEVER.some((bad) => link.includes(bad))) continue;

    results.push({
      url: link,
      title: text(entry['title']),
      description: text(entry['description']),
      host,
      official: looksOfficial(host),
      query,
    });
  }

  return results;
}

/**
 * Merge several searches into one candidate list, best first.
 *
 * Deduplicated by URL, then capped per host. Without the host cap a single
 * aggregator with good search presence contributes fifteen of twenty
 * candidates and a student's results are one site's opinion. Official sources
 * sort first because they are the thing itself rather than a description of
 * it, and they are the ones a student most needs and least easily finds.
 */
export function mergeResults(
  batches: readonly SerpResult[][],
  options: { perHost?: number; limit?: number } = {},
): SerpResult[] {
  const perHost = options.perHost ?? 2;
  const limit = options.limit ?? 12;

  const seen = new Set<string>();
  const byHost = new Map<string, number>();
  const merged: SerpResult[] = [];

  // Interleave the batches rather than concatenating them. Concatenation means
  // the last query's results are always the ones the cap discards, so asking
  // for three opportunity types would quietly return results for the first.
  const depth = Math.max(0, ...batches.map((batch) => batch.length));
  const ordered: SerpResult[] = [];
  for (let index = 0; index < depth; index++) {
    for (const batch of batches) {
      const entry = batch[index];
      if (entry !== undefined) ordered.push(entry);
    }
  }

  /*
   * Official sources get a head start, not the whole field.
   *
   * Sorting every official result ahead of every other one sounds right and
   * starved the results in practice: with eight pages to open, the list filled
   * entirely with ministry and university landing pages, which are indexes
   * rather than opportunities, and a live run returned nothing at all. The
   * runs that found real fellowships found them at research.adobe.com, iaps.ai
   * and cprgindia.org, none of which end in .gov or .edu and all of which are
   * the body offering the money.
   *
   * So official sources are guaranteed a majority of the slots and no more
   * than that. A guarantee is what they needed; exclusivity is what broke it.
   */
  const officialSlots = Math.ceil(limit * 0.6);

  const take = (result: SerpResult): boolean => {
    if (seen.has(result.url)) return false;
    const used = byHost.get(result.host) ?? 0;
    if (used >= perHost) return false;

    seen.add(result.url);
    byHost.set(result.host, used + 1);
    merged.push(result);
    return true;
  };

  let officialTaken = 0;
  for (const result of ordered) {
    if (!result.official) continue;
    if (officialTaken >= officialSlots) break;
    if (take(result)) officialTaken += 1;
  }

  for (const result of ordered) {
    if (merged.length >= limit) break;
    if (result.official) continue;
    take(result);
  }

  // Any slots the official pass could not fill go back to the rest, so a
  // profile with few official matches still gets a full set of candidates.
  for (const result of ordered) {
    if (merged.length >= limit) break;
    take(result);
  }

  return merged;
}
