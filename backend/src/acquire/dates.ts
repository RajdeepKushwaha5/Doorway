/**
 * Has this door already shut?
 *
 * Nothing anywhere in the pipeline asked. A live search returned "AI Hackathon
 * in India", whose own summary read "Applications closed 7 November" and whose
 * deadline was 7 November 2025, and it was served to a student as something to
 * apply to nine months after it ended.
 *
 * Detecting the words "applications are closed" catches the pages that say so.
 * Most do not. They simply publish a date, leave the page up forever, and let
 * the reader do the subtraction, which is exactly the arithmetic a piece of
 * software should be doing on their behalf.
 *
 * This is deliberately conservative in one direction only. A date that cannot
 * be parsed is not treated as expired, because dropping a live opportunity over
 * an unfamiliar format is a worse failure than showing one whose date we could
 * not read. Being unsure means showing it, with the raw text attached.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function monthFrom(name: string): number | null {
  const key = name.slice(0, 3).toLowerCase();
  return key in MONTHS ? (MONTHS[key] as number) : null;
}

/** A date built in UTC, so a timezone cannot shift a deadline across midnight. */
function utc(year: number, month: number, day: number): number | null {
  if (day < 1 || day > 31 || month < 0 || month > 11) return null;
  if (year < 1990 || year > 2100) return null;
  return Date.UTC(year, month, day);
}

/**
 * The date a deadline sentence is talking about.
 *
 * Returns the *latest* date found rather than the first. A page saying
 * "opens 1 March, closes 30 April" is talking about a window, and the one a
 * student can miss is the end of it.
 */
export function parseDeadline(raw: string): number | null {
  const found: number[] = [];

  // 18 September 2026, and 17th May, 2026. Ordinal suffixes are ordinary in
  // the way people write closing dates.
  const dmy = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+((?:19|20)\d{2})\b/g;
  // September 18, 2026
  const mdy = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b/g;
  // 2026-09-18
  const iso = /\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b/g;
  // 31/12/2026 and 31-12-2026, day first: these pages are not American by default
  const slash = /\b(\d{1,2})[/.-](\d{1,2})[/.-]((?:19|20)\d{2})\b/g;

  for (const match of raw.matchAll(dmy)) {
    const month = monthFrom(match[2] ?? '');
    if (month === null) continue;
    const at = utc(Number(match[3]), month, Number(match[1]));
    if (at !== null) found.push(at);
  }

  for (const match of raw.matchAll(mdy)) {
    const month = monthFrom(match[1] ?? '');
    if (month === null) continue;
    const at = utc(Number(match[3]), month, Number(match[2]));
    if (at !== null) found.push(at);
  }

  for (const match of raw.matchAll(iso)) {
    const at = utc(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (at !== null) found.push(at);
  }

  for (const match of raw.matchAll(slash)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    // Ambiguous unless one of them cannot be a month. Prefer day-first, which
    // is what most of the world writes, and fall back when it cannot be.
    const at = first > 12 ? utc(Number(match[3]), second - 1, first) : utc(Number(match[3]), first - 1, second);
    if (at !== null) found.push(at);
  }

  if (found.length === 0) return null;
  return Math.max(...found);
}

/**
 * Whether this deadline is behind us.
 *
 * A day of grace, because a deadline today has not passed for somebody in an
 * earlier timezone, and a listing that closes tonight is exactly the one worth
 * surfacing.
 */
export function deadlineHasPassed(raw: string | null, now = Date.now()): boolean {
  if (raw === null) return false;
  const at = parseDeadline(raw);
  if (at === null) return false;
  return at < now - 24 * 60 * 60 * 1000;
}
