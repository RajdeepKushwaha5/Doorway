import {
  BrightDataAuthError,
  BrightDataBalanceError,
  BrightDataRateLimitError,
  BrightDataRequestError,
  BrightDataServerError,
  BrightDataTimeoutError,
  type BrightDataError,
} from './errors.js';

export interface RetryPolicy {
  /** Attempts after the first. 2 means up to three total calls. */
  maxRetries: number;
  /** First backoff delay in milliseconds. Doubles each attempt. */
  baseDelayMs: number;
  /** Ceiling on any single backoff delay. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
};

export interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Abort this single attempt after this many milliseconds. */
  timeoutMs: number;
  retryPolicy?: RetryPolicy;
  /** Called before each retry, for logging and cost accounting. */
  onRetry?: (attempt: number, delayMs: number, error: BrightDataError) => void;
  /**
   * Inspect the headers of a successful response before its body is read.
   *
   * Needed because a 200 does not always mean success. Web Unlocker returns
   * 200 once the request reaches the unlocker and reports the real outcome in
   * `x-brd-status-code` and `x-brd-error`, so a caller that trusts the status
   * alone can hand an error page onward as if it were the page.
   *
   * Throw from here to reject the response.
   */
  onResponseHeaders?: (headers: Headers) => void;
  signal?: AbortSignal;
}

/**
 * Exponential backoff with full jitter.
 *
 * Full jitter rather than fixed backoff because NOTICE polls several
 * long-running heal jobs concurrently, and synchronized retries from one
 * worker are how a transient 429 turns into a sustained one.
 */
function backoffDelay(attempt: number, policy: RetryPolicy): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(Math.random() * ceiling);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

/** Parse `Retry-After`, which may be seconds or an HTTP date. */
function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;

  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds;

  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  }
  return null;
}

/** Ways Bright Data says the account cannot pay, across its several APIs. */
function mentionsBalance(body: string): boolean {
  return /insufficient\s+(balance|funds|credit)|no\s+available\s+(funds|balance)|not\s+enough\s+(balance|funds)|payment\s+required|billing\s+issue|account\s+is\s+suspended/i.test(
    body,
  );
}

/** Map an HTTP response to the appropriate typed error. */
async function errorForResponse(response: Response): Promise<BrightDataError> {
  const body = await response.text().catch(() => '');
  const snippet = body.slice(0, 500);

  if (response.status === 401 || response.status === 403) {
    return new BrightDataAuthError(
      `Bright Data rejected the credentials (HTTP ${response.status}): ${snippet}`,
    );
  }
  if (response.status === 429) {
    return new BrightDataRateLimitError(
      `Bright Data rate limited the request: ${snippet}`,
      parseRetryAfter(response.headers.get('retry-after')),
    );
  }
  /*
   * An empty account, said as one.
   *
   * Bright Data signals this as 402, and also as an ordinary 4xx whose body
   * names the balance, so both are matched. Getting this wrong is expensive in
   * the only currency that matters near a deadline: the message sent somebody
   * to read their own request payload, which was correct.
   */
  if (response.status === 402 || mentionsBalance(snippet)) {
    return new BrightDataBalanceError(
      'Bright Data will not run this request because the account has no available balance ' +
        `(HTTP ${response.status}): ${snippet}`,
      response.status,
    );
  }
  if (response.status >= 500) {
    return new BrightDataServerError(
      `Bright Data returned HTTP ${response.status}: ${snippet}`,
      response.status,
    );
  }
  return new BrightDataRequestError(
    `Bright Data rejected the request (HTTP ${response.status}): ${snippet}`,
    response.status,
    body,
  );
}

/**
 * A single Bright Data HTTP call with timeout, typed errors and bounded retry.
 *
 * The API key is supplied per call rather than captured, so it is never held
 * on a long-lived object that might be serialized into evidence.
 */
export async function brightDataRequest(
  apiKey: string,
  baseUrl: string,
  options: RequestOptions,
): Promise<unknown> {
  const policy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;

  const url = new URL(options.path, baseUrl);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let lastError: BrightDataError | null = null;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), options.timeoutMs);

    // Abort on either the caller's signal or our own timeout.
    const onCallerAbort = (): void => timeoutController.abort();
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: options.method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: timeoutController.signal,
      });

      if (response.ok) {
        // Some responses are 200 at the transport layer while reporting a
        // failure in headers. Web Unlocker does exactly this: the outer status
        // is 200 once the request reaches the unlocker, and the real outcome
        // is in x-brd-status-code and x-brd-error. Give callers the chance to
        // inspect that before the body is interpreted.
        options.onResponseHeaders?.(response.headers);

        const text = await response.text();
        if (text.trim() === '') return null;
        try {
          return JSON.parse(text);
        } catch {
          // Some endpoints return NDJSON or plain text. Hand the raw body back
          // and let the caller decide, rather than failing the request here.
          return text;
        }
      }

      lastError = await errorForResponse(response);
      if (!lastError.retryable || attempt === policy.maxRetries) throw lastError;

      const hinted =
        lastError instanceof BrightDataRateLimitError && lastError.retryAfterSeconds !== null
          ? lastError.retryAfterSeconds * 1000
          : null;
      const delay = hinted ?? backoffDelay(attempt, policy);
      options.onRetry?.(attempt + 1, delay, lastError);
      await sleep(delay, options.signal);
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') {
        if (options.signal?.aborted === true) throw caught;
        lastError = new BrightDataTimeoutError(
          `Bright Data request to ${options.path} exceeded ${options.timeoutMs}ms`,
          options.timeoutMs,
          caught,
        );
      } else if (caught instanceof Error && 'retryable' in caught) {
        // A typed BrightDataError. Most were thrown from the non-ok branch
        // above, which already decided not to retry, and rethrowing those is
        // correct.
        //
        // But `onResponseHeaders` also throws from inside the ok branch, for
        // responses that are 200 at the transport layer and report a failure
        // in headers, which is how Web Unlocker reports a block. Rethrowing a
        // retryable one of those unconditionally meant a transient block
        // failed permanently, so the witness gave up on a page a second
        // attempt would have read.
        if (caught.retryable !== true) throw caught;
        lastError = caught as BrightDataError;
      } else {
        lastError = new BrightDataServerError(
          `Bright Data request to ${options.path} failed at the transport layer`,
          null,
          caught,
        );
      }

      if (attempt === policy.maxRetries) throw lastError;
      const delay = backoffDelay(attempt, policy);
      options.onRetry?.(attempt + 1, delay, lastError);
      await sleep(delay, options.signal);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  throw lastError ?? new BrightDataServerError('Bright Data request failed', null);
}
