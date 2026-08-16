import { brightDataRequest, type RetryPolicy } from './http.js';
import { BrightDataRequestError, BrightDataServerError } from './errors.js';

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
  /**
   * ISO 3166-1 alpha-2, lowercased, pinning where the page is fetched from.
   *
   * Not cosmetic. The two sensors are only comparable when they saw the same
   * page, and a store that prices by region will hand them different numbers
   * for reasons that have nothing to do with extraction. Left unset, Bright
   * Data picks the optimal exit for the domain, which is a sensible default
   * for scraping and a poor one for arbitration, because it can differ between
   * two calls to the same URL.
   *
   * The value is recorded on the observation so the classifier can return
   * `access_anomaly` rather than blaming the collector.
   */
  country?: string;
  /**
   * Which layout to ask for. Defaults to desktop, which is also Web Unlocker's
   * own default.
   *
   * Recorded rather than merely set, because the two sensors are comparable
   * only if they saw the same page, and a mobile layout is a different page.
   * Scraper Studio can emulate a phone with `emulate_device`, so a collector
   * on mobile against a witness on desktop is a real configuration, and the
   * price it disagrees about may be genuinely different rather than wrong.
   * Recording it lets the classifier call that an access anomaly instead of
   * blaming the extractor.
   */
  device?: 'desktop' | 'mobile';
  baseUrl?: string;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
}

export interface WitnessFetch {
  markdown: string;
  fetchedAt: string;
  /** The URL actually requested, for the acquisition context. */
  url: string;
  /** Exit country used, when one was pinned. Recorded as acquisition context. */
  country?: string;
  /** Layout requested. Recorded so a device mismatch is detectable. */
  deviceType: 'desktop' | 'mobile';
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * A 200 from `/request` does not mean the page was fetched.
 *
 * Bright Data's own reference is explicit: "The outer response is 200 OK once
 * the request reaches the unlocker. The result status is in the
 * x-brd-status-code header." Every failure also carries `x-brd-error`, and
 * most carry a machine-readable `x-brd-error-code`.
 *
 * This matters more here than in most clients. The witness is the sensor the
 * rest of the system trusts to arbitrate whether a collector is broken. If an
 * unlock failure is accepted as page content, the extractor finds nothing or
 * finds the wrong thing, and NOTICE reaches a confident conclusion from an
 * error page. Refusing loudly produces an `inconclusive` incident instead,
 * which is the honest outcome.
 *
 * Throws rather than returns, so an unusable witness can never be mistaken for
 * a witness that saw an empty page.
 */
/**
 * Unlock failures that a different peer may not hit.
 *
 * Bright Data's error reference splits its codes by whether a retry can help:
 * "Retrying is worth doing for errors caused by the peer or by the unlock
 * attempt, because each request uses a different peer." A block or a failed
 * resolution is in that class. A bad certificate, an unroutable host or a
 * zone misconfiguration is not, and retrying those just spends the allowance
 * to reach the same answer more slowly.
 */
function isTransientUnlockFailure(code: string | null): boolean {
  if (code === null) return false;
  return code === 'reject_block' || code.startsWith('resolve_failed');
}

function assertUnlockSucceeded(headers: Headers): void {
  const error = headers.get('x-brd-error');
  const code = headers.get('x-brd-error-code') ?? headers.get('x-brd-err-code');
  const status = Number(headers.get('x-brd-status-code') ?? '200');

  if (error !== null || code !== null) {
    const message = `Web Unlocker could not read the page: ${code ?? 'unknown'} ${error ?? ''}`.trim();

    // Thrown as a server error so the request helper's backoff retries it. A
    // transient block that fails permanently turns a page NOTICE could have
    // read into a quarantined incident, which is a false alarm dressed up as
    // caution.
    if (isTransientUnlockFailure(code)) {
      throw new BrightDataServerError(message, Number.isFinite(status) ? status : 502);
    }

    throw new BrightDataRequestError(
      message,
      Number.isFinite(status) ? status : 502,
      code ?? '',
    );
  }

  // The target's own status, passed through. A 404 or a 500 from the site is
  // not an unlock failure, but it is not a page either, and treating a site
  // error page as evidence is how a witness ends up agreeing with nothing.
  if (Number.isFinite(status) && status >= 400) {
    throw new BrightDataRequestError(
      `the target returned HTTP ${String(status)} to the witness`,
      status,
      '',
    );
  }
}

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
      ...(config.country === undefined || config.country.trim() === ''
        ? {}
        : { country: config.country.trim().toLowerCase() }),
      // Desktop is the API's default, so only the opt-in needs sending.
      ...(config.device === 'mobile' ? { ua: 'mobile' } : {}),
    },
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    onResponseHeaders: assertUnlockSucceeded,
    ...(config.retryPolicy === undefined ? {} : { retryPolicy: config.retryPolicy }),
    ...(signal === undefined ? {} : { signal }),
  });

  const markdown =
    typeof response === 'string'
      ? response
      : typeof (response as { body?: unknown } | null)?.body === 'string'
        ? (response as { body: string }).body
        : null;

  // Previously this fell back to JSON.stringify, which turned an unexpected
  // response object into a "page" the extractor would dutifully search. A
  // witness that cannot produce a document has not seen anything, and saying
  // so is the whole point of having an `inconclusive` verdict.
  if (markdown === null) {
    throw new BrightDataRequestError(
      'Web Unlocker returned no document body for the witness',
      502,
      '',
    );
  }
  if (markdown.trim() === '') {
    throw new BrightDataRequestError('Web Unlocker returned an empty document', 502, '');
  }

  return {
    markdown,
    fetchedAt: new Date().toISOString(),
    url,
    deviceType: config.device ?? 'desktop',
    ...(config.country === undefined ? {} : { country: config.country.trim().toLowerCase() }),
  };
}

export interface WitnessScreenshot {
  /** PNG bytes, exactly as Bright Data rendered them. */
  png: Uint8Array;
  capturedAt: string;
  url: string;
}

/**
 * Capture what the page looked like, as a picture.
 *
 * The markdown witness proves what the page said. This proves what it showed.
 * They answer different questions, and the second one is the one an operator
 * actually asks before approving a repair: not "what did the extractor claim"
 * but "what was on the page". A disagreement between two numbers is an
 * argument; a disagreement next to an image of the page is a fact.
 *
 * Deliberately not fetched on every run. A screenshot costs a request and
 * roughly 200KB, and a healthy observation has nothing to illustrate, so the
 * pipeline captures one only when an incident is being opened.
 *
 * Uses a direct fetch rather than the shared request helper, because that
 * helper reads every response as text and PNG bytes do not survive the trip.
 */
export async function fetchWitnessScreenshot(
  config: UnlockerConfig,
  url: string,
  signal?: AbortSignal,
): Promise<WitnessScreenshot> {
  assertPublicHttpUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onCallerAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  try {
    const response = await fetch(`${config.baseUrl ?? 'https://api.brightdata.com'}/request`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        zone: config.zone,
        url,
        format: 'raw',
        data_format: 'screenshot',
        ...(config.country === undefined || config.country.trim() === ''
          ? {}
          : { country: config.country.trim().toLowerCase() }),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new BrightDataRequestError(
        `screenshot request failed with HTTP ${String(response.status)}`,
        response.status,
        '',
      );
    }

    // Same trap as the markdown path: the outer 200 only means the request
    // reached the unlocker.
    assertUnlockSucceeded(response.headers);

    const png = new Uint8Array(await response.arrayBuffer());

    // The response is labelled `Content-Type: application/json` even though the
    // body is a PNG, so the header cannot be used to tell success from an error
    // payload. Check the magic number instead: an error would arrive as JSON
    // text and fail this.
    const isPng =
      png.length > 8 &&
      png[0] === 0x89 &&
      png[1] === 0x50 &&
      png[2] === 0x4e &&
      png[3] === 0x47;
    if (!isPng) {
      throw new BrightDataRequestError(
        'Web Unlocker returned something that is not a PNG for the screenshot',
        502,
        '',
      );
    }

    return { png, capturedAt: new Date().toISOString(), url };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Build a witness fetcher for the pipeline.
 *
 * Falls back to the CLI when no zone is configured, so local development keeps
 * working for anyone who has already run `bdata login`, while a deployment
 * with `BRIGHTDATA_UNLOCKER_ZONE` set never touches the CLI at all.
 */
export function createWitnessFetcher(
  config: {
    apiKey: string;
    zone: string | undefined;
    country?: string | undefined;
    device?: 'desktop' | 'mobile' | undefined;
  },
  cliFallback: (url: string) => Promise<{ markdown: string; fetchedAt: string }>,
): (url: string) => Promise<{ markdown: string; fetchedAt: string }> {
  if (config.zone === undefined || config.zone.trim() === '') {
    return cliFallback;
  }
  return async (url: string) =>
    fetchWitnessMarkdown(
      {
        apiKey: config.apiKey,
        zone: config.zone as string,
        ...(config.country === undefined ? {} : { country: config.country }),
        ...(config.device === undefined ? {} : { device: config.device }),
      },
      url,
    );
}
