/**
 * One way to write a date, everywhere.
 *
 * There were four. Search results rendered "1 Jul 2027", the evidence page
 * rendered "2027-07-01", the application plan rendered "1 July 2027", and the
 * verified feed printed whatever the source had written, which for one
 * scholarship was "01/07/2027".
 *
 * That last one is the reason this exists. On a product whose entire subject
 * is closing dates, showing a reader "01/07/2027" leaves them to guess between
 * the first of July and the seventh of January, and the guess is worth six
 * months. The source's own wording is the honest thing to hold, and it is not
 * the honest thing to display when we have parsed it and know which day it is.
 *
 * This is the third rendering rule to be duplicated across this codebase and
 * then quietly diverge, after the funding label and the deadline parser. The
 * pattern is always the same: both copies are correct when written, one gets
 * improved, and nothing announces the gap.
 */

/**
 * The month spelled out, so no reader has to work out the order.
 *
 * en-GB rather than en-IN, only because it puts the day first without
 * abbreviating the month. The format is "18 September 2026" either way.
 */
const LONG = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * A closing date as a reader should see it.
 *
 * @param iso The parsed date, when this system managed to parse one.
 * @param raw What the source actually wrote.
 *
 * Falls back to the source's wording rather than to nothing. A page that
 * publishes "rolling admissions" or "closes at the end of term" has told a
 * student something true, and replacing it with "Date not published" would
 * discard information we were given.
 */
export function formatDeadline(iso: string | null, raw: string | null = null): string {
  if (iso !== null) {
    const at = Date.parse(iso);
    if (!Number.isNaN(at)) return LONG.format(new Date(at));
  }
  if (raw !== null && raw.trim() !== '') return raw;
  return 'Date not published';
}

/** A timestamp, for a moment rather than a day. */
export function formatMoment(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return `${LONG.format(new Date(at))}, ${new Date(at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/**
 * Whole days from now until then, negative once it has gone.
 *
 * Floored rather than rounded, because a deadline three quarters of a day away
 * is today's problem and calling it one day away invites a reader to leave it.
 */
export function daysUntil(iso: string | null, now = Date.now()): number | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.floor((at - now) / 86_400_000);
}
