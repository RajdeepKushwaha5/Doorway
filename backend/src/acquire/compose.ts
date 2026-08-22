import { parseDeadline } from './dates.js';

/**
 * Turn a page into the brief a scraper gets built from.
 *
 * This is the step that decides what a collector will be, and it was the step
 * nobody could see. A `c_*` id is a receipt; the sentence handed to Scraper
 * Studio is the design, and the useful part of a design is the alternative it
 * rejected.
 *
 * So this does not summarise the page. It looks for the specific ambiguity
 * that costs students opportunities, which is a page carrying more than one
 * date, and it says out loud which one it chose and which it refused. On a
 * funding page the difference between "Early interest deadline" and
 * "Application deadline" is seventeen days and a missed fellowship, and a
 * scraper built without being told the difference will take whichever comes
 * first in the DOM.
 *
 * Deterministic on purpose. A judge can run it twice and get the same brief,
 * and every observation it reports can be checked against the page it read.
 */

/** Labels that mean the date applications close. */
const CLOSING = [
  'application deadline',
  'applications close',
  'closing date',
  'apply by',
  'deadline to apply',
  'last date to apply',
  'submission deadline',
];

/** Labels that carry a date which is emphatically not the closing date. */
const NOT_CLOSING = [
  'early interest',
  'early bird',
  'notification',
  'results announced',
  'result date',
  'interview',
  'programme starts',
  'program starts',
  'start date',
  'posted',
  'published',
];

export interface DateSighting {
  label: string;
  value: string;
  /** Whether this label means the date applications close. */
  closing: boolean;
}

export interface ComposedBrief {
  /** The brief, within the 500 characters Scraper Studio accepts. */
  description: string;
  /** What was seen on the page, in the order it was seen. */
  observations: string[];
  /** Every labelled date found, closing or otherwise. */
  dates: DateSighting[];
  /** Fields worth protecting, and the reason in plain language. */
  protectedBecause: Record<string, string>;
  /** Whether the page shows a link somebody can apply through. */
  hasApplyLink: boolean;
}

const LIMIT = 500;

/** A label and the value beside or beneath it, as markdown tends to render. */
function sightings(markdown: string): DateSighting[] {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  const seen: DateSighting[] = [];

  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    const label = [...CLOSING, ...NOT_CLOSING].find((candidate) => lower.includes(candidate));
    if (label === undefined) continue;

    /*
     * The value may sit on the line, after a separator, or on the next
     * non-empty line. Both are ordinary, and a label alone is not a sighting:
     * reporting "Application deadline" with no date would put a claim in the
     * brief that the page never made.
     */
    const inline = line.replace(new RegExp(`.*${label}`, 'i'), '').replace(/^[\s:|/-]+/, '');
    const next = lines.slice(index + 1).find((candidate) => candidate !== '') ?? '';
    const value = parseDeadline(inline) !== null ? inline : parseDeadline(next) !== null ? next : '';
    if (value === '') continue;

    if (!seen.some((existing) => existing.label === label)) {
      seen.push({ label, value: value.trim(), closing: CLOSING.includes(label) });
    }
  }

  return seen;
}

export function composeBrief(markdown: string, url: string): ComposedBrief {
  const dates = sightings(markdown);
  const closing = dates.filter((date) => date.closing);
  const decoys = dates.filter((date) => !date.closing);
  const hasApplyLink = /\[[^\]]*\b(apply|application)\b[^\]]*\]\([^)]+\)/i.test(markdown);

  const observations: string[] = [];
  observations.push(`read ${String(markdown.length)} characters of markdown from ${url}`);
  observations.push(
    dates.length === 0
      ? 'no labelled date found on the page'
      : `${String(dates.length)} labelled date${dates.length === 1 ? '' : 's'} on the page`,
  );
  for (const date of dates) {
    observations.push(
      `"${date.value}" is labelled ${date.label}${date.closing ? '' : ', which is not the closing date'}`,
    );
  }
  observations.push(
    hasApplyLink ? 'the page shows a link to apply' : 'the page shows no link to apply',
  );

  /*
   * The refusal is the important half.
   *
   * Naming only the field to extract produces a scraper that takes the first
   * plausible date it finds. Naming the label to avoid is what makes the
   * difference between the right date and a date, and it is the whole reason
   * this composes a brief rather than passing a generic one.
   */
  const parts: string[] = [
    'Extract the opportunity title, the provider, the funding level, and the date applications close.',
  ];

  if (closing.length > 0) {
    parts.push(`Take the closing date from the label "${closing[0]?.label ?? ''}".`);
  }
  if (decoys.length > 0) {
    parts.push(`Never take it from ${decoys.map((d) => `"${d.label}"`).join(' or ')}.`);
  }
  if (hasApplyLink) {
    parts.push('Also extract the URL of the apply link.');
  }

  let description = parts.join(' ');
  if (description.length > LIMIT) {
    // Trimmed from the end, because the first sentence names what to extract
    // and the rest refines it. A truncated brief is worse than a shorter one
    // only if it loses the subject.
    description = `${description.slice(0, LIMIT - 1).trimEnd()}.`;
  }

  const protectedBecause: Record<string, string> = {};
  if (closing.length > 0 || decoys.length > 0) {
    protectedBecause['deadline_raw'] =
      decoys.length > 0
        ? `the page carries ${String(decoys.length + closing.length)} dates, and publishing the wrong one costs a student the opportunity silently`
        : 'publishing a wrong closing date costs a student the opportunity silently';
  }
  if (hasApplyLink) {
    protectedBecause['application_url'] =
      'a listing with no way to apply looks complete and cannot be acted on';
  }

  return { description, observations, dates, protectedBecause, hasApplyLink };
}
