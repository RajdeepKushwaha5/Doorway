import { brightDataRequest, type RetryPolicy } from './http.js';
import { BrightDataRequestError } from './errors.js';

/**
 * The independent witness, over HTTP.
 *
 * The witness was originally acquired by shelling out to `bdata scrape`. That
 * works on a laptop where the CLI is installed and authenticated, and fails on
 * every clean deployment, which is the one place it has to work. The CLI stays
 * in the project where it earns its place, in collector creation and the
 * agent-driven demo, but the production path here is a direct call.
 *
 * This is deliberately a different Bright Data product from the collector.
 * Scraper Studio runs selector-bound extraction code; Web Unlocker returns the
 * rendered page with no selectors involved. Two sensors that cannot fail the
 * same way is the entire premise, and it would be defeated by fetching the
 * page through the same machinery twice.
 */

export interface UnlockerConfig {
  apiKey: string;
  /** Zone to bill and route through. The CLI creates `cli_unlocker` on login. */
  zone: string;
  baseUrl?: string;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
}

export interface WitnessFetch {
  markdown: string;
  fetchedAt: string;
  /** The URL actually requested, for the acquisition context. */
  url: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function assertPublicHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BrightDataRequestError(`witness target is not a valid URL: ${url}`, 400, '');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BrightDataRequestError(
      `witness target must be http or https, got ${parsed.protocol}`,
      400,
      '',
    );
  }

  // Refuse private and loopback targets. The witness URL can originate from a
  // registered collector, so without this the backend can be pointed at
  // internal services or a cloud metadata endpoint.
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);

  if (blocked) {
    throw new BrightDataRequestError(
      `refusing to fetch a private or loopback address as a witness: ${host}`,
      400,
      '',
    );
  }
  return parsed;
}

/**
 * Fetch a page as markdown through Web Unlocker.
 *
 * @param url Must be a public http(s) URL. Private ranges are refused.
 * @returns The rendered page as markdown, with the time it was observed.
 */
export async function fetchWitnessMarkdown(
  config: UnlockerConfig,
  url: string,
  signal?: AbortSignal,
): Promise<WitnessFetch> {
  assertPublicHttpUrl(url);

  const response = await brightDataRequest(config.apiKey, config.baseUrl ?? 'https://api.brightdata.com', {
    method: 'POST',
    path: '/request',
    body: {
      zone: config.zone,
      url,
      format: 'raw',
      // Bright Data converts the rendered document to markdown server-side, so
      // no HTML parsing happens here and the witness shares no code with the
      // collector's parser.
      data_format: 'markdown',
    },
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(config.retryPolicy === undefined ? {} : { retryPolicy: config.retryPolicy }),
    ...(signal === undefined ? {} : { signal }),
  });

  const markdown =
    typeof response === 'string'
      ? response
      : typeof (response as { body?: unknown } | null)?.body === 'string'
        ? (response as { body: string }).body
        : JSON.stringify(response);

  return { markdown, fetchedAt: new Date().toISOString(), url };
}

/**
 * Build a witness fetcher for the pipeline.
 *
 * Falls back to the CLI when no zone is configured, so local development keeps
 * working for anyone who has already run `bdata login`, while a deployment
 * with `BRIGHTDATA_UNLOCKER_ZONE` set never touches the CLI at all.
 */
export function createWitnessFetcher(
  config: { apiKey: string; zone: string | undefined },
  cliFallback: (url: string) => Promise<{ markdown: string; fetchedAt: string }>,
): (url: string) => Promise<{ markdown: string; fetchedAt: string }> {
  if (config.zone === undefined || config.zone.trim() === '') {
    return cliFallback;
  }
  return async (url: string) => fetchWitnessMarkdown({ apiKey: config.apiKey, zone: config.zone as string }, url);
}
