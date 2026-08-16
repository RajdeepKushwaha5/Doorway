import { redactString } from '../shared/index.js';

/**
 * Base class for every Bright Data failure.
 *
 * Messages pass through redaction on construction. Bright Data errors
 * routinely echo the request back, including the Authorization header, and
 * these messages end up in incident evidence and the UI.
 */
export class BrightDataError extends Error {
  /** True when retrying the identical request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(redactString(message), options.cause === undefined ? {} : { cause: options.cause });
    this.name = new.target.name;
    this.retryable = options.retryable;
  }
}

/** Credentials missing, malformed, or rejected. Never retried. */
export class BrightDataAuthError extends BrightDataError {
  constructor(message: string, cause?: unknown) {
    super(message, { retryable: false, ...(cause === undefined ? {} : { cause }) });
  }
}

/** Rate limited. Carries the server's own backoff hint when it supplied one. */
export class BrightDataRateLimitError extends BrightDataError {
  /** Seconds to wait, taken from `Retry-After` when present. */
  readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null, cause?: unknown) {
    super(message, { retryable: true, ...(cause === undefined ? {} : { cause }) });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The request exceeded its deadline locally. */
export class BrightDataTimeoutError extends BrightDataError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, cause?: unknown) {
    super(message, { retryable: true, ...(cause === undefined ? {} : { cause }) });
    this.timeoutMs = timeoutMs;
  }
}

/** A 4xx that is not auth or rate limiting. The request itself is wrong. */
export class BrightDataRequestError extends BrightDataError {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string, cause?: unknown) {
    super(message, { retryable: false, ...(cause === undefined ? {} : { cause }) });
    this.status = status;
    this.body = redactString(body);
  }
}

/** A 5xx or transport failure. Retryable. */
export class BrightDataServerError extends BrightDataError {
  readonly status: number | null;

  constructor(message: string, status: number | null, cause?: unknown) {
    super(message, { retryable: true, ...(cause === undefined ? {} : { cause }) });
    this.status = status;
  }
}

/**
 * The collector ran but produced something unusable.
 *
 * Distinct from a transport failure on purpose. This is a NOTICE incident,
 * not an infrastructure problem, and must reach the classifier rather than
 * being retried away.
 */
export class CollectorOutputError extends BrightDataError {
  readonly collectorId: string;
  readonly errorCode: string | null;

  constructor(message: string, collectorId: string, errorCode: string | null) {
    super(message, { retryable: false });
    this.collectorId = collectorId;
    this.errorCode = errorCode;
  }
}

/** A `bdata` invocation failed or could not be started. */
export class BrightDataCliError extends BrightDataError {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message, { retryable: false });
    this.exitCode = exitCode;
    this.stderr = redactString(stderr);
  }
}
