import { comparisonKey, normalizeMoney, normalizeText } from '../shared/index.js';
import type { EvidenceSpan, WitnessFieldSpec, WitnessValue } from './spec.js';

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
    const coerced = coerce(candidate.trim(), spec);
    if (coerced === null) continue;

    return {
      path: spec.path,
      value: coerced,
      confidence: CONFIDENCE.labelledLine,
      evidence: { line, lineNumber: index + 1, strategy: 'labelled-line' },
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

  if (candidates.length !== 1) return null;
  const only = candidates[0];
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
    if (found !== null) return found;
  }
  return null;
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
