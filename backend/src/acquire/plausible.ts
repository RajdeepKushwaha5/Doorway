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

const MONTHS =
  '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

/** Markdown link syntax, stray URLs, and bare parenthesised paths. */
const LOOKS_LIKE_MARKUP = /\]\(|https?:\/\/|^\s*\/\/|www\./i;

/** Language that means the page is guessing rather than stating. */
const HEDGED = new RegExp(
  '(?:e\.g\.|around|approximately|typically|usually|expected|likely|estimated|varies|tbd|to be announced)',
  'i',
);

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

  const named = new RegExp(`\\b\\d{1,2}\\s*${MONTHS}\\b|\\b${MONTHS}\\s*\\d{1,2}\\b`, 'i');
  const numeric = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;

  if (!named.test(value) && !numeric.test(value)) return null;

  // A date with no year is ambiguous in a way that matters here: a student
  // reading "closes 3 March" cannot tell whether that has already happened.
  if (!/\b(19|20)\d{2}\b/.test(value) && !numeric.test(value)) return null;

  return fromSentenceStart(value);
}

/** Currency markers that appear on funding pages, symbol or code. */
const MONEY = /(?:₹|\$|£|€|¥)\s?[\d,.]+|\b(?:INR|USD|GBP|EUR|CAD|AUD|SGD)\b\s?[\d,.]*|\b\d[\d,.]*\s?(?:lakh|lakhs|crore|per month|per annum|pa|p\.a\.|monthly|stipend)\b/i;

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
  for (const raw of markdown.split(/\r?\n/)) {
    const line = unbullet(raw);
    if (line.length < 8 || line.length > 220) continue;
    if (!DEADLINE_WORDS.test(line)) continue;
    if (NOT_A_DEADLINE.test(line)) continue;

    const accepted = plausibleDeadline(line);
    if (accepted !== null) return accepted;
  }
  return null;
}

const FUNDING_WORDS =
  /\b(stipend|scholarship|fellowship|grant|award|funding|funded|tuition|allowance|honorarium|bursary)\b/i;

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
