/**
 * Environment variables, read defensively.
 *
 * A hosting dashboard cannot express "unset". Creating a variable and leaving
 * the value blank stores an empty string, and `??` does not fall back on an
 * empty string, only on undefined. That difference took a production build
 * down with `ERR_INVALID_URL, input: ''` from `new URL('')`, on a page that
 * had nothing to do with the variable.
 *
 * So treat blank as absent, and treat a value that cannot be parsed as a URL
 * as absent too. A misconfigured variable should degrade to the default, not
 * fail the build.
 */

/** Blank, whitespace-only and unset all mean the same thing: not configured. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * Read a variable expected to hold an absolute URL.
 *
 * Trailing slashes are stripped because callers append paths directly, and
 * `https://host/` + `/api/incidents` produces a double slash that some hosts
 * answer with a redirect and others with a 404.
 */
function readUrl(value: string | undefined, fallback: string): string {
  const candidate = present(value);
  if (candidate === undefined) return fallback;
  try {
    // Throws on a missing scheme, which is the other common way to fill one of
    // these in by hand.
    new URL(candidate);
  } catch {
    return fallback;
  }
  let trimmed = candidate;
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

/** Base URL of the NOTICE backend, as seen from the browser. */
export const apiBase = (): string =>
  readUrl(process.env['NEXT_PUBLIC_NOTICE_API_BASE'], 'http://localhost:4000');

/**
 * Base URL of the backend as seen from the server.
 *
 * Separate from apiBase because a deployment may route server-side traffic
 * over an internal hostname the browser cannot reach. Falls through to the
 * public value, which is the common case.
 */
export const serverApiBase = (): string =>
  readUrl(process.env['NOTICE_API_BASE'], apiBase());

/** Public origin of this dashboard, used to resolve metadata URLs. */
export const siteUrl = (): string =>
  readUrl(process.env['NEXT_PUBLIC_SITE_URL'], 'http://localhost:3000');
