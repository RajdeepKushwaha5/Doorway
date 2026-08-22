import { comparisonKey, normalizeMoney, normalizeText } from '../shared/index.js';
import type { EvidenceSpan, WitnessFieldSpec, WitnessValue } from './spec.js';
import { parseDeadline } from '../acquire/dates.js';

/**
 * Deterministic extraction from markdown.
 *
 * Strategies run in descending order of trustworthiness and stop at the first
 * hit. An LLM extractor may be added as a last resort, but it must return
 * evidence spans and must not outrank these, because a model that infers a
 * plausible price is indistinguishable from a collector that extracts one, and
 * two confidently wrong sensors agreeing is worse than no witness at all.
 */

const CONFIDENCE = {
  jsonLd: 0.95,
  labelledLine: 0.85,
  tableRow: 0.85,
  headingAdjacent: 0.6,
  bareCurrency: 0.35,
} as const;

function lineMatchesAny(line: string, needles: readonly string[]): boolean {
  const key = comparisonKey(line);
  return needles.some((needle) => key.includes(comparisonKey(needle)));
}

/** Coerce a raw string to the type the spec asks for. */
function coerce(raw: unknown, spec: WitnessFieldSpec): unknown | null {
  switch (spec.kind) {
    case 'money': {
      const money = normalizeMoney(raw);
      return money === null ? null : { value: money.value, currency: money.currency };
    }
    case 'number': {
      const money = normalizeMoney(raw);
      return money?.value ?? null;
    }
    case 'enum': {
      if (typeof raw !== 'string') return null;
      // Canonical enum values are snake_case (`in_stock`) while prose is
      // spaced ("In stock"). comparisonKey strips punctuation but keeps
      // spaces, so the two never met. Collapse whitespace on both sides.
      const squash = (value: string): string => comparisonKey(value).replace(/\s+/g, '');
      const key = squash(raw);
      const match = spec.allowed.find((candidate) => key.includes(squash(candidate)));
      return match ?? null;
    }
    case 'text':
      return typeof raw === 'string' ? normalizeText(stripMarkdown(raw)) : null;
  }
}

/**
 * Remove markdown syntax from a captured value.
 *
 * The witness reports what a person reads on the page, and a person does not
 * read the `#` in front of a heading. Extracting a product name from a heading
 * line returned `"# Nova Headphones"`, which survives comparison only because
 * comparisonKey happens to strip punctuation, and which reads as a bug in
 * every incident timeline that shows it.
 *
 * Deliberately conservative: leading block markers and paired emphasis only.
 * A `#` inside a value can be meaningful, as in a model number.
 */
function stripMarkdown(raw: string): string {
  return raw
    .replace(/^\s*(?:#{1,6}\s+|>\s+|[-*+]\s+)/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<![\w*])\*(?!\*)(.+?)(?<!\*)\*(?![\w*])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Strategy 1: structured data embedded in the page.
 *
 * When a site ships JSON-LD, it is the publisher's own machine-readable claim
 * about the page and outranks anything inferred from prose.
 */
function fromJsonLd(lines: readonly string[], spec: WitnessFieldSpec): WitnessValue | null {
  const blob = lines.join('\n');
  const blocks = blob.match(/\{[\s\S]*?\}/g);
  if (blocks === null) return null;

  const leaf = spec.path.split('.').pop() ?? spec.path;

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') continue;

    const record = parsed as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (!spec.labels.some((label) => comparisonKey(key) === comparisonKey(label)) &&
          comparisonKey(key) !== comparisonKey(leaf)) {
        continue;
      }
      const coerced = coerce(value, spec);
      if (coerced === null) continue;

      const lineNumber = lines.findIndex((line) => line.includes(String(value))) + 1;
      return {
        path: spec.path,
        value: coerced,
        confidence: CONFIDENCE.jsonLd,
        evidence: {
          line: normalizeText(block).slice(0, 200),
          lineNumber: lineNumber > 0 ? lineNumber : 1,
          strategy: 'json-ld',
        },
      };
    }
  }
  return null;
}

/** Strategy 2: `Label: value` on a single line. */
function fromLabelledLine(lines: readonly string[], spec: WitnessFieldSpec): WitnessValue | null {
  for (const [index, rawLine] of lines.entries()) {
    const line = normalizeText(rawLine);
    if (line === '') continue;

    // A table row is not a labelled line. Without this, `| Purchase price |
    // $249 |` is swallowed here and the recorded evidence names the wrong
    // strategy, which makes the receipt misleading even though the value is
    // right.
    if (line.includes('|')) continue;

    // An excluded label on the line disqualifies it outright. This is what
    // stops "Refundable deposit: $25" being read as the purchase price.
    if (lineMatchesAny(line, spec.excludeLabels)) continue;
    if (!lineMatchesAny(line, spec.labels)) continue;

    const separator = line.search(/[:–—-]/);
    const candidate = separator === -1 ? line : line.slice(separator + 1);

    /*
     * A line that is only the label may or may not also be the value.
     *
     * With no separator, `candidate` is the whole line, which is the label we
     * just matched. Sometimes that is right: a spec can use a product's own
     * name as the label to find its title, and there the label is the value.
     * Sometimes it is badly wrong. Rendered to markdown a definition list puts
     * the term and its description on separate lines:
     *
     *   Application deadline
     *
     *   18 September 2026
     *
     * For money and number the mistake is self-correcting, since "Application
     * deadline" does not coerce to a number and the fallback below gets its
     * turn. For a text field it coerces perfectly, because a label is valid
     * text, so the witness answered with the question: it reported
     * `deadline_raw` as "Application deadline" and called a collector that had
     * read the date correctly a drift.
     *
     * What separates the two cases is the line underneath. A line that looks
     * like `Something: value` belongs to a different field, so the bare label
     * is the best reading of this one. A line carrying a bare value is the
     * description of this term, and is what the page means.
     *
     * Definition lists are how government portals, university pages and
     * foundation sites publish structured facts, which is most of what this
     * system is pointed at.
     */
    const following = lines.slice(index + 1).find((entry) => normalizeText(entry) !== '');
    const followingIsOwnField =
      following === undefined || /^\s*[A-Za-z][^:\n]{0,47}:\s*\S/.test(normalizeText(following));

    /*
     * The line must be nothing but the label before its value is sought below.
     *
     * Looking only at the line underneath was not enough, and a real page
     * proved it. Adobe's fellowship page says, in a bullet:
     *
     *   * Applications are closed for the Adobe India AI Research Fellowship
     *   # Who this fellowship is for
     *
     * The first line matches the label "applications close", carries no
     * separator, and is followed by a heading that is not its own `Label:
     * value`. Every condition for reading downward was met, so the witness
     * returned "Who this fellowship is for" as the closing date and reported
     * drift against a collector that had read the sentence correctly.
     *
     * What the fixture case and this one actually differ on is how much of the
     * line the label accounts for. "Application deadline" is the label and
     * nothing else, so the value has to be elsewhere. "Applications are closed
     * for the Adobe India AI Research Fellowship" contains the label and then
     * says something, and that something is the answer.
     *
     * So: read downward only when removing the matched label leaves nothing
     * behind. That keeps definition lists working, keeps a spec that names a
     * product title as its own label working, and stops this.
     */
    const labelIsWholeLine = spec.labels.some((label) => {
      const key = comparisonKey(label);
      if (key === '') return false;
      const stripped = comparisonKey(line).replace(key, '');
      // Punctuation and list markers survive normalisation; text does not.
      return stripped.replace(/[^a-z0-9]/g, '') === '';
    });

    const preferLineBelow = separator === -1 && labelIsWholeLine && !followingIsOwnField;
    const coerced = preferLineBelow ? null : coerce(candidate.trim(), spec);

    if (coerced !== null) {
      return {
        path: spec.path,
        value: coerced,
        confidence: CONFIDENCE.labelledLine,
        evidence: { line, lineNumber: index + 1, strategy: 'labelled-line' },
      };
    }

    // The label carried no value of its own, so look at the line below it.
    //
    // Converting a table to markdown routinely puts each cell on its own line,
    // which leaves a label stranded above the number it describes:
    //
    //   Price (excl. tax)
    //   £51.77
    //
    // Found on a live site, where this returned nothing at all for price while
    // the page displayed it three times. Only the next non-empty line is
    // considered: reaching further turns a near miss into a confident guess
    // about a value that belongs to something else entirely.
    const next = lines.slice(index + 1).find((following) => normalizeText(following) !== '');
    if (next === undefined) continue;

    const below = normalizeText(next);
    if (below.includes('|') || lineMatchesAny(below, spec.excludeLabels)) continue;

    // A second label below the first is a list of headings, not a value.
    if (lineMatchesAny(below, spec.labels)) continue;

    const fromBelow = coerce(below, spec);
    if (fromBelow === null) continue;

    return {
      path: spec.path,
      value: fromBelow,
      confidence: CONFIDENCE.labelledLine,
      evidence: {
        line: `${line} / ${below}`,
        lineNumber: index + 1,
        strategy: 'labelled-line',
      },
    };
  }
  return null;
}

/** Strategy 3: a markdown table row whose first cell is the label. */
function fromTableRow(lines: readonly string[], spec: WitnessFieldSpec): WitnessValue | null {
  for (const [index, rawLine] of lines.entries()) {
    if (!rawLine.includes('|')) continue;
    const line = normalizeText(rawLine);
    if (lineMatchesAny(line, spec.excludeLabels)) continue;

    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell !== '');
    if (cells.length < 2) continue;

    const [label, ...rest] = cells;
    if (label === undefined || !lineMatchesAny(label, spec.labels)) continue;

    for (const cell of rest) {
      const coerced = coerce(cell, spec);
      if (coerced !== null) {
        return {
          path: spec.path,
          value: coerced,
          confidence: CONFIDENCE.tableRow,
          evidence: { line, lineNumber: index + 1, strategy: 'table-row' },
        };
      }
    }
  }
  return null;
}

/** Strategy 4: value on the line following a matching heading. */
function fromHeadingAdjacent(
  lines: readonly string[],
  spec: WitnessFieldSpec,
): WitnessValue | null {
  for (const [index, rawLine] of lines.entries()) {
    if (!rawLine.trimStart().startsWith('#')) continue;
    const heading = normalizeText(rawLine.replace(/^#+/, ''));
    if (!lineMatchesAny(heading, spec.labels)) continue;

    // For a text field the heading itself is usually the value, which is how
    // a product title appears in markdown.
    if (spec.kind === 'text') {
      const coerced = coerce(heading, spec);
      if (coerced !== null) {
        return {
          path: spec.path,
          value: coerced,
          confidence: CONFIDENCE.headingAdjacent,
          evidence: { line: heading, lineNumber: index + 1, strategy: 'heading-adjacent' },
        };
      }
    }

    for (let offset = 1; offset <= 3 && index + offset < lines.length; offset++) {
      const next = normalizeText(lines[index + offset] ?? '');
      if (next === '' || lineMatchesAny(next, spec.excludeLabels)) continue;
      const coerced = coerce(next, spec);
      if (coerced !== null) {
        return {
          path: spec.path,
          value: coerced,
          confidence: CONFIDENCE.headingAdjacent,
          evidence: { line: next, lineNumber: index + offset + 1, strategy: 'heading-adjacent' },
        };
      }
    }
  }
  return null;
}

/**
 * Strategy 5: the only currency amount on the page.
 *
 * Deliberately last and deliberately low confidence. It fires only when
 * exactly one candidate exists, because picking the first of several is how a
 * witness confidently reports the wrong number and corroborates a broken
 * collector.
 */
function fromBareCurrency(lines: readonly string[], spec: WitnessFieldSpec): WitnessValue | null {
  if (spec.kind !== 'money' && spec.kind !== 'number') return null;

  const candidates: { value: unknown; line: string; lineNumber: number }[] = [];
  for (const [index, rawLine] of lines.entries()) {
    const line = normalizeText(rawLine);
    if (line === '' || lineMatchesAny(line, spec.excludeLabels)) continue;

    for (const match of line.matchAll(/[£€¥₹$]\s?[\d.,]+|\b\d[\d.,]*\s?(?:USD|GBP|EUR|INR|JPY)\b/gi)) {
      const coerced = coerce(match[0], spec);
      if (coerced !== null) candidates.push({ value: coerced, line, lineNumber: index + 1 });
    }
  }

  // Refuse only when the page shows genuinely different amounts. Requiring a
  // single occurrence looked safe and was not: a real product page repeats its
  // price several times, in a heading, a summary and a tax table, and this
  // abandoned the field every time. Verified on a live site where "£51.77"
  // appeared three times and nothing was extracted.
  //
  // Three readings of the same number is more evidence than one, not less.
  // Two different numbers with no label to tell them apart is the ambiguity
  // worth refusing, and that still refuses.
  const distinct = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.value);
    if (!distinct.has(key)) distinct.set(key, candidate);
  }

  if (distinct.size !== 1) return null;
  const only = [...distinct.values()][0];
  if (only === undefined) return null;

  return {
    path: spec.path,
    value: only.value,
    confidence: CONFIDENCE.bareCurrency,
    evidence: { line: only.line, lineNumber: only.lineNumber, strategy: 'bare-currency' },
  };
}

const STRATEGIES = [
  fromJsonLd,
  fromLabelledLine,
  fromTableRow,
  fromHeadingAdjacent,
  fromBareCurrency,
] as const;

/**
 * Extract one field from markdown, returning the first confident hit.
 *
 * @returns The value with its evidence span, or null when no strategy found
 *   it. Null is a legitimate and useful answer: it makes the comparison
 *   `incomparable`, which quarantines rather than accusing the collector.
 */
export function extractField(markdown: string, spec: WitnessFieldSpec): WitnessValue | null {
  const lines = markdown.split(/\r?\n/);
  for (const strategy of STRATEGIES) {
    const found = strategy(lines, spec);
    if (found === null) continue;
    /*
     * A value has to look like the thing the spec asked for.
     *
     * `kind` says how to coerce; it does not say the result is credible. Text
     * coerces from any text, so a spec looking for a closing date accepted any
     * sentence merely containing the word, and on a real hackathon page the
     * witness returned "installing it the night before the deadline" as the
     * deadline and called a collector that had read "August 24-30, 2026"
     * drifted.
     *
     * Discovery has always held its values to a shape. The witness is where
     * that matters more, because a false reading here quarantines a real
     * opportunity and teaches an operator to distrust incidents.
     *
     * Keep looking rather than giving up: a later strategy often finds the
     * labelled line an earlier one walked past.
     */
    if (!satisfiesShape(found.value, spec)) continue;
    return found;
  }
  return null;
}

/** Whether a candidate matches the optional shape a spec declared. */
function satisfiesShape(value: unknown, spec: WitnessFieldSpec): boolean {
  if (spec.shape === undefined) return true;
  if (spec.shape === 'date') return typeof value === 'string' && parseDeadline(value) !== null;
  return true;
}

/** Extract every field in a spec list. */
export function extractFields(
  markdown: string,
  specs: readonly WitnessFieldSpec[],
): { values: WitnessValue[]; notFound: string[] } {
  const values: WitnessValue[] = [];
  const notFound: string[] = [];

  for (const spec of specs) {
    const found = extractField(markdown, spec);
    if (found === null) notFound.push(spec.path);
    else values.push(found);
  }

  return { values, notFound };
}

export type { EvidenceSpan };
