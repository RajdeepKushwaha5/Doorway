/**
 * Secret redaction.
 *
 * NOTICE stores raw Bright Data requests and responses as incident evidence,
 * and that evidence is displayed in the UI, written to logs, and exported into
 * the demo bundle. Every one of those paths is a way to leak an API key, so
 * redaction happens at the boundary rather than being left to call sites.
 */

/** Keys whose values are replaced wholesale, matched case-insensitively. */
const SENSITIVE_KEYS: readonly string[] = [
  'authorization',
  'api_key',
  'apikey',
  'brightdata_api_key',
  'token',
  'access_token',
  'refresh_token',
  'password',
  'secret',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
];

/** Patterns redacted anywhere they appear inside free text. */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  // Bearer tokens in headers or logged curl commands.
  /\bBearer\s+[A-Za-z0-9._\-]{12,}/gi,
  // Bright Data CLI flag form.
  /--api[-_]?key[= ]\s*[A-Za-z0-9._\-]{12,}/gi,
  // Long hex strings, which is the shape Bright Data API keys take.
  /\b[a-f0-9]{32,}\b/gi,
  // Basic-auth credentials embedded in a proxy URL.
  /\/\/[^/:@\s]+:[^/@\s]+@/g,
];

export const REDACTED = '[REDACTED]';

/** Replace secret-looking substrings in free text. */
export function redactString(input: string): string {
  let output = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

/**
 * Deep-clone a value with secrets removed.
 *
 * Redacts by key name and by content pattern, so a key smuggled into an
 * unexpected field is still caught. Cycles are replaced with `"[CIRCULAR]"`
 * so this is safe to call on anything before serializing it.
 *
 * @param maxDepth Guards against pathological nesting. Deeper values are
 *   replaced with `"[TRUNCATED]"`.
 */
export function redact<T>(value: T, maxDepth = 12): unknown {
  return redactInternal(value, maxDepth, new WeakSet());
}

function redactInternal(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth < 0) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => redactInternal(item, depth - 1, seen));
    }

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEYS.includes(key.toLowerCase())
        ? REDACTED
        : redactInternal(item, depth - 1, seen);
    }
    return output;
  }

  // Functions and symbols never belong in stored evidence.
  return undefined;
}

/**
 * Assert that a value carries no recognizable secret.
 *
 * Used in tests and before writing the demo evidence bundle, so a leak fails
 * the build rather than reaching a public repository.
 *
 * @throws If a secret pattern survives in the serialized value.
 */
export function assertNoSecrets(value: unknown, context = 'value'): void {
  const serialized = JSON.stringify(value) ?? '';
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex: these patterns carry the global flag.
    pattern.lastIndex = 0;
    if (pattern.test(serialized)) {
      throw new Error(`${context} contains a value matching a secret pattern: ${pattern}`);
    }
  }
}
