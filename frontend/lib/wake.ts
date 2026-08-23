/**
 * Fetching against a host that may be asleep.
 *
 * Both the API and the fixture run on a free plan that suspends after fifteen
 * minutes idle. The request that wakes one takes tens of seconds, and a
 * default fetch gives up long before that. The visitor this matters most for
 * is the one who has never been here: theirs is the request that does the
 * waking, and theirs is the only impression they get.
 *
 * This was learned twice. The proof page issued three reads at once against a
 * sleeping service and rendered with no record, no collector and no error to
 * show for it. Then the same thing was written a second time for the server
 * actions, with the same twenty-second write timeout, which is not long
 * enough for a cold start and meant pressing the fault switch on a sleeping
 * fixture failed for no reason a visitor could see.
 *
 * So it lives in one file now, and both callers use it.
 */

/**
 * A read is safe to repeat, so it gets several short attempts.
 *
 * Three twenty-second tries outlast a cold start with room to spare, and each
 * one is short enough that a genuinely dead host is reported quickly rather
 * than holding a page render open for a minute.
 */
const READ_TIMEOUT_MS = 20_000;
const READ_ATTEMPTS = 3;

/**
 * A write cannot be repeated, so its only defence is patience.
 *
 * Retrying a POST can start a second live search or flip a fixture twice, both
 * of which cost real money or confuse a demonstration. One attempt, given long
 * enough to outlast the host starting up.
 */
const WRITE_TIMEOUT_MS = 45_000;

/** Whether a request can be safely sent again. */
export function isRead(method: string | undefined): boolean {
  const verb = (method ?? 'GET').toUpperCase();
  return verb === 'GET' || verb === 'HEAD';
}

/** How many attempts and how long each may take, for one request. */
export function wakePolicy(method?: string): { attempts: number; timeoutMs: number } {
  return isRead(method)
    ? { attempts: READ_ATTEMPTS, timeoutMs: READ_TIMEOUT_MS }
    : { attempts: 1, timeoutMs: WRITE_TIMEOUT_MS };
}

/**
 * Fetch, waiting out a cold start and retrying only what is safe to retry.
 *
 * Throws the last error when every attempt fails, so callers keep whatever
 * they already do about failure.
 */
export async function wakeFetch(url: string, init?: RequestInit): Promise<Response> {
  const { attempts, timeoutMs } = wakePolicy(init?.method);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      lastError = error;
      // A woken service answers the next one, so there is no backoff worth the
      // name here: somebody is watching a page render.
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('network error');
}

/** Describes what was tried, for an error a reader might actually see. */
export function wakeFailureNote(method?: string): string {
  const { attempts, timeoutMs } = wakePolicy(method);
  return attempts > 1
    ? `after ${String(attempts)} attempts, ${String(timeoutMs / 1000)}s each`
    : `after ${String(timeoutMs / 1000)}s`;
}
