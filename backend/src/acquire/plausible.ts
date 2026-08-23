/**
 * Does this extracted value look like the thing it claims to be?
 *
 * The witness extractor finds a labelled line and returns what follows it.
 * That is exactly right on a page built out of labelled facts, which is what
 * the fixture is and what a well-made funding page is. It is not enough on an
 * arbitrary page found by searching, where "Benefits" is a heading above a
 * bulleted list of nice things and "Award" is the anchor text of a link to a
 * different page entirely.
 *
 * Run against real discovered pages, unguarded extraction produced a funding
 * level of `//acr.iitm.ac.in/distinguished-alumni-award)` and another of
 * "Highly interdisciplinary work environment with mentoring by leading
 * faculty". Both were found under a correct label. Neither is a funding level.
 *
 * So every field gets a shape it has to satisfy, and a value that fails is
 * reported as absent. "Not stated on the page" is a true and useful thing to
 * tell a student. A URL fragment presented as the amount of money on offer is
 * neither, and it is the confident-wrong-answer failure this whole project
 * exists to argue against. Discovery is the last place that should be relaxed
 * about it.
 */

import { parseDeadline } from './dates.js';

/** Markdown link syntax, stray URLs, and bare parenthesised paths. */
const LOOKS_LIKE_MARKUP = /\]\(|https?:\/\/|^\s*\/\/|www\./i;

/**
 * Language that means the page is guessing rather than stating.
 *
 * Written as a literal regex rather than a `new RegExp` string. In a string,
 * `\.` collapses to a bare `.` before the pattern is ever compiled, so the
 * intended literal dots in `e.g.` silently became wildcards.
 */
const HEDGED =
  /(?:e\.g\.|around|approximately|typically|usually|expected|likely|estimated|varies|tbd|to be announced)/i;

/** A run of a value that is clearly a navigation label rather than a fact. */
const NAVIGATION = /^(read more|learn more|click here|apply now|home|menu|back)\b/i;

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Drop a fragment of the previous sentence.
 *
 * A scanned line frequently begins mid-thought: an Oxford fellowship page
 * yielded a deadline starting "No. Applications received after 23 February
 * 2026 ...", where the "No." is the tail of the sentence before it. Cutting at
 * the last sentence boundary before the first digit leaves the statement the
 * reader needs and nothing of the one they do not.
 */
function fromSentenceStart(value: string): string {
  const firstDigit = value.search(/\d/);
  if (firstDigit < 0) return value;

  const before = value.slice(0, firstDigit);
  const boundary = before.lastIndexOf('. ');
  if (boundary < 0) return value;

  const trimmed = value.slice(boundary + 2).trim();
  return trimmed.length < 12 ? value : trimmed;
}

/**
 * A page title wearing a fact's clothes.
 *
 * "Google DeepMind Artificial Intelligence Scholarship in France 2026 | Fully
 * Funded | Scholarship Region" contains the words "Fully Funded" and so passed
 * as a statement about funding. It is the browser tab's text. The pipe is the
 * reliable tell, because no funding body writes an amount with pipes in it,
 * and a trailing site name after a dash is the same thing in another costume.
 */
const TITLE_SHAPED = /\|/;

/**
 * A date a human would recognise as one.
 *
 * Accepts "18 September 2026", "September 18, 2026", "18/09/2026",
 * "2026-09-18" and "Rolling until 10 October 2026". Rejects a bare year, which
 * is almost always a copyright line or a programme name.
 */
export function plausibleDeadline(raw: string): string | null {
  const value = tidy(raw);
  if (value === '' || value.length > 160) return null;
  if (LOOKS_LIKE_MARKUP.test(value)) return null;
  if (NAVIGATION.test(value)) return null;
  // A hedged date is not a deadline. An aggregator article produced "Timeline
  // for 2026 Deadline around mid-November 2025 (e.g., November 16 for recent
  // cycles)", which parses as a date and tells a student nothing they can plan
  // around. If the page is unsure, the honest answer is that it did not say.
  if (HEDGED.test(value)) return null;
  if (TITLE_SHAPED.test(value)) return null;

  /*
   * One understanding of what a date is, rather than two that drift.
   *
   * This carried its own pair of regexes alongside the parser in dates.ts.
   * Ordinal suffixes were added there and not here, so "Registration Deadline:
   * 15th July 2026" was rejected while "15 July 2026" was accepted. Real pages
   * write the ordinal, and it cost most of the deadlines in the index: two out
   * of twenty-three records had one, and the diagnosis was going to be "the
   * dates are in PDFs" until somebody read the markdown.
   *
   * Asking the parser is also a stronger test than matching a shape. A string
   * that parses to a date contains a date; a string that matches a date-shaped
   * pattern might say "32 Septembre".
   */
  if (parseDeadline(value) === null) return null;

  return fromSentenceStart(value);
}

/** Currency markers that appear on funding pages, symbol or code. */
const MONEY = /(?:₹|\$|£|€|¥)\s?[\d,.]+|\b(?:INR|USD|GBP|EUR|CAD|AUD|SGD)\b\s?[\d,.]*|\b\d[\d,.]*\s?(?:lakh|lakhs|crore|per month|per annum|pa|p\.a\.|monthly|stipend|in prizes|in prize money)\b/i;

/** Phrases that state coverage without naming a number. */
const COVERAGE =
  /\b(fully[- ]funded|full[- ]scholarship|full tuition|tuition (?:and|&) (?:living|stipend|accommodation)|tuition waiver|no tuition fee|covers? (?:tuition|full|all)|partially funded|part[- ]funded|travel grant|living allowance)\b/i;

/**
 * A funding statement, meaning either an amount or a coverage claim.
 *
 * Prose is rejected even when it sits under a correct "Benefits" heading,
 * because a list of benefits is not a statement about money and a student
 * comparing two opportunities on funding needs the two to be comparable.
 */
export function plausibleFunding(raw: string): string | null {
  const value = tidy(raw);
  if (value === '' || value.length > 180) return null;
  if (LOOKS_LIKE_MARKUP.test(value)) return null;
  if (NAVIGATION.test(value)) return null;

  if (TITLE_SHAPED.test(value)) return null;

  if (MONEY.test(value) || COVERAGE.test(value)) return value;
  return null;
}

/**
 * An eligibility sentence.
 *
 * The loosest of the three, because eligibility is genuinely prose and there
 * is no shape to insist on beyond it being a sentence rather than furniture.
 */
export function plausibleEligibility(raw: string): string | null {
  const value = tidy(raw);
  if (value.length < 12 || value.length > 400) return null;
  if (LOOKS_LIKE_MARKUP.test(value)) return null;
  if (NAVIGATION.test(value)) return null;
  return value;
}

/** The name of a body, not a sentence and not a link. */
export function plausibleProvider(raw: string): string | null {
  const value = tidy(raw);
  if (value.length < 3 || value.length > 90) return null;
  if (LOOKS_LIKE_MARKUP.test(value)) return null;
  if (NAVIGATION.test(value)) return null;
  // A provider is a name. More than about twelve words is a description.
  if (value.split(' ').length > 12) return null;
  // Names start like names. Scanning a sentence produced the provider
  // "created AI policy organization", which is the tail of a clause and not
  // what anybody is called. A leading lowercase word is the cheap tell.
  if (/^[a-z]/.test(value) && !value.includes('.')) return null;
  return value;
}

/* ------------------------------------------------------------------------ *
 * Scanning
 *
 * Label extraction finds "Deadline: 18 September 2026". Real funding pages
 * frequently do not write that. They write, in a bullet halfway down a page,
 * "Fellowship includes a monthly stipend of INR 1 lakh", and the fact a
 * student needs is in a sentence rather than beside a label.
 *
 * Read against live pages, label extraction alone returned nothing usable from
 * any of eight official sources, because the labels it needs were not there to
 * find. Scanning the whole page for a sentence that states the fact recovers
 * those without loosening what counts as a fact: every candidate line still has
 * to pass the same shape check as a labelled one.
 *
 * Label extraction is still tried first. A labelled value is stated where the
 * page says it is stated, and that is better evidence than a sentence found by
 * searching for it.
 * ------------------------------------------------------------------------ */

/** Strip list markers, emphasis and table pipes so a line reads as a sentence. */
function unbullet(line: string): string {
  return line
    .replace(/^\s*[*\-+•]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*[|>#]+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s*\|\s*$/, '')
    .trim();
}

const DEADLINE_WORDS =
  /\b(deadline|last date|apply by|applications? close|closing date|submission (?:date|deadline)|due by|before)\b/i;

/** Words that mean this date is not the closing date. */
const NOT_A_DEADLINE =
  /\b(result|announced|notification|published|posted|interview|copyright|updated|founded|since)\b/i;

/**
 * Find a closing date stated anywhere on the page.
 *
 * Requires both a deadline word and a date on the same line. A date alone is
 * meaningless here: funding pages are full of them, and picking the first one
 * would reliably produce a confident wrong answer, which is the failure this
 * project exists to prevent.
 */
export function scanForDeadline(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/).map(unbullet);

  for (const [index, line] of lines.entries()) {
    if (line.length < 4 || line.length > 220) continue;
    if (!DEADLINE_WORDS.test(line) && !/^when$/i.test(line)) continue;
    if (NOT_A_DEADLINE.test(line)) continue;

    const accepted = plausibleDeadline(line);
    if (accepted !== null) return accepted;

    /*
     * Timeline cards often put the date immediately above its label:
     *
     *   Aug 23, 2026
     *   Submissions close
     *
     * This is the mirror image of the heading shape handled below. Only the
     * two preceding lines are considered and the combined text still has to
     * pass the same deadline parser.
     */
    for (const above of lines.slice(Math.max(0, index - 2), index).reverse()) {
      if (above === '') continue;
      if (above.length > 220 || NOT_A_DEADLINE.test(above)) break;
      const over = plausibleDeadline(`${above} ${line}`);
      if (over !== null) return over;
      break;
    }

    /*
     * The date under the heading.
     *
     * A line scanner structurally cannot see the shape a great many funding
     * pages use:
     *
     *   ## Application deadline
     *   15 July 2026
     *
     * The word and the date are both on the page and never share a line, so
     * every one of these read as "not stated". Only the next few non-empty
     * lines are considered, and each still has to pass the same date test, so
     * a heading followed by prose yields nothing rather than a guess.
     */
    for (const below of lines.slice(index + 1, index + 4)) {
      if (below === '') continue;
      if (below.length > 220) break;
      // Another labelled field means this heading's value is not below it.
      if (DEADLINE_WORDS.test(below)) break;
      if (NOT_A_DEADLINE.test(below)) break;

      const under = plausibleDeadline(below);
      if (under !== null) return under;
      break;
    }
  }
  return null;
}

const FUNDING_WORDS =
  // A hackathon pays in prizes, which answers the same question a student is
  // asking and uses a different word entirely. Leaving it out meant every
  // hackathon reported its money as "not stated" while the page announced a
  // prize pool in the heading.
  /\b(stipend|scholarship|fellowship|grant|award|funding|funded|tuition|allowance|honorarium|bursary|prizes?|winnings)\b/i;

/**
 * Find a statement about money anywhere on the page.
 *
 * The funding word and the amount have to share a line, for the same reason
 * the deadline does: a page mentioning both "fellowship" and "$500" in
 * different paragraphs has told us nothing about what this fellowship pays.
 */
export function scanForFunding(markdown: string): string | null {
  for (const raw of markdown.split(/\r?\n/)) {
    const line = unbullet(raw);
    if (line.length < 8 || line.length > 220) continue;
    if (!FUNDING_WORDS.test(line)) continue;

    const accepted = plausibleFunding(line);
    if (accepted !== null) return accepted;
  }
  return null;
}


/* ------------------------------------------------------------------------ *
 * Closed
 *
 * The single most important thing a funding page can tell a student is that
 * they are too late, and it was the one thing being discarded.
 *
 * Adobe's fellowship page has a "Key dates" section whose entire content is
 * "Applications are closed for the Adobe India AI Research Fellowship". That
 * line was found, matched the deadline label, and was then rejected for not
 * containing a date. The record went out with the deadline reading "Not
 * stated", which is not what the page said and is worse than saying nothing:
 * a student reads "Not stated" as "still open, date unclear" and spends an
 * evening on an application that cannot be submitted.
 *
 * A closed opportunity is not an opportunity. It is detected here, and the
 * record is kept out of the results rather than shown with a caveat, because
 * the product's entire job is finding things somebody can still apply to.
 * ------------------------------------------------------------------------ */

const CLOSED_PHRASES = [
  /\bapplications?\s+(?:are|is|has|have)\s+(?:now\s+)?closed\b/i,
  /\bapplications?\s+(?:for\s+\d{4}\s+)?(?:are\s+)?no longer\s+(?:being\s+)?accept/i,
  /\bno longer accepting applications\b/i,
  /\bthis (?:programme|program|fellowship|scholarship|call) (?:is|has) closed\b/i,
  /\bapplications? closed\b/i,
  /\bthe deadline has passed\b/i,
  /\bsubmissions? (?:are|is) closed\b/i,
  /\bround (?:is|has) closed\b/i,
];

/**
 * Language that means the page is announcing a future opening, not a closure.
 *
 * "Applications open in March" and "applications are closed until March" mean
 * opposite things to a student deciding whether to read on, and only one of
 * them should remove the record.
 */
const REOPENING = /\bapplications?\s+(?:will\s+)?(?:open|reopen)\b/i;

/**
 * Whether this page says the door is shut.
 *
 * Checked against the whole document rather than one line, because a closure
 * notice is a banner or a section heading far more often than it is a labelled
 * field.
 */
export function saysClosed(markdown: string): boolean {
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 6 || line.length > 300) continue;
    if (!CLOSED_PHRASES.some((phrase) => phrase.test(line))) continue;
    // A line that announces the next opening in the same breath is news about
    // the next cycle, not a shut door today.
    if (REOPENING.test(line)) continue;
    return true;
  }
  return false;
}
