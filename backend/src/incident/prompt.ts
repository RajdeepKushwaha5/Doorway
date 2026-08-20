import type { WitnessFieldSpec } from '../witness/index.js';
import type { ReconciliationSummary } from '../witness/index.js';
import type { Classification } from './classify.js';

/**
 * Bright Data's documented ceiling for a Self-Healing prompt.
 *
 * Exceeding it is rejected by the API, so the builder trims by dropping the
 * least useful sections rather than truncating mid-sentence and leaving the
 * healer with half an instruction.
 */
export const PROMPT_CHARACTER_LIMIT = 1000;

export interface PromptInput {
  classification: Classification;
  reconciliation: ReconciliationSummary;
  specs: readonly WitnessFieldSpec[];
  /** Fields that must not change, so a repair cannot trade one break for another. */
  protectedFields: readonly string[];
}

export interface SynthesizedPrompt {
  text: string;
  /** Kept for the incident receipt, so a reviewer sees what drove the wording. */
  reasons: string[];
  withinLimit: boolean;
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return 'nothing';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) {
      const currency = typeof record['currency'] === 'string' ? ` ${record['currency']}` : '';
      return `${String(record['value'])}${currency}`;
    }
  }
  return String(value);
}

/**
 * Turn a classification into a repair instruction.
 *
 * The difference between this and "the scraper is broken, fix it" is the
 * difference between a repair that works and one that does not. Bright Data
 * repairs extraction against a description, so the prompt must name the wrong
 * value, the right value, the label the right value sits under, and the fields
 * that must not move.
 *
 * Only ever called for `extractor_drift` and `explicit_failure`. A genuine
 * source change has nothing to repair.
 */
export function synthesizeRepairPrompt(input: PromptInput): SynthesizedPrompt {
  const { classification, reconciliation, specs, protectedFields } = input;
  const reasons: string[] = [];

  const disagreements = reconciliation.comparisons.filter(
    (comparison) => comparison.agreement.kind === 'disagree',
  );

  if (disagreements.length === 0) {
    // Explicit failure with no field-level evidence: state the error plainly
    // rather than inventing a diagnosis the evidence does not support.
    const text = [
      classification.evidence[0] ?? 'The collector failed on the supplied URL.',
      'Repair the extraction so the documented output schema is returned for this page.',
      protectedFields.length > 0
        ? `Keep these fields unchanged: ${protectedFields.join(', ')}.`
        : '',
    ]
      .filter((part) => part !== '')
      .join(' ');

    return { text: text.slice(0, PROMPT_CHARACTER_LIMIT), reasons, withinLimit: true };
  }

  const sections: string[] = [];

  for (const comparison of disagreements) {
    const spec = specs.find((candidate) => candidate.path === comparison.path);
    const captured = classification.capturedInstead[comparison.path];

    let sentence = `The field "${comparison.path}" returns ${describeValue(comparison.collectorValue)}, but the page shows ${describeValue(comparison.witnessValue)}`;

    if (comparison.evidence !== null) {
      sentence += ` on the line "${comparison.evidence.line.slice(0, 90)}"`;
    }
    sentence += '.';

    if (captured !== undefined && captured.length > 0) {
      // The single most useful sentence in the prompt. It tells the healer
      // what went wrong structurally, not just that a number is off.
      sentence += ` That value is the page's ${captured.join(' and ')}, not the ${comparison.path}.`;
      reasons.push(`cross-field match: ${comparison.path} captured ${captured.join(', ')}`);
    }

    if (spec !== undefined) {
      // The declared meaning is a human sentence and usually ends in a full
      // stop already. Appending another produced "…sponsored listing price.."
      // in a prompt that goes to Bright Data, and a lower-case start read as a
      // fragment mid-instruction.
      const meaning = spec.meaning.trim().replace(/\.+$/, '');
      sentence += ` Extract ${meaning.charAt(0).toLowerCase()}${meaning.slice(1)}.`;
      if (spec.excludeLabels.length > 0) {
        sentence += ` Exclude ${spec.excludeLabels.slice(0, 4).join(', ')}.`;
      }
      reasons.push(`meaning supplied for ${comparison.path}`);
    }

    sections.push(sentence);
  }

  const expected = disagreements
    .map((comparison) => `${comparison.path}=${describeValue(comparison.witnessValue)}`)
    .join(', ');

  const closing: string[] = [`Expected values for this page: ${expected}.`];
  if (protectedFields.length > 0) {
    /*
     * "Do not change these fields" contradicted the instruction above it.
     *
     * A protected field is one a repair may not *drop*: the gate checks only
     * that it is still present and non-empty, never that its value is
     * unchanged. But the prompt said "do not change", and `price` is normally
     * both protected and the field under repair, so the healer was told to fix
     * price and to leave price alone in the same paragraph.
     */
    closing.push(
      `These fields must still be present in the output: ${protectedFields.join(', ')}.`,
    );
  }
  closing.push('Preserve the existing output schema.');

  let text = [...sections, ...closing].join(' ');

  // Trim by dropping whole sections from the least significant end, so what
  // survives is still a complete instruction.
  while (text.length > PROMPT_CHARACTER_LIMIT && sections.length > 1) {
    sections.pop();
    reasons.push('dropped a lower-priority field to fit the 1000-character limit');
    text = [...sections, ...closing].join(' ');
  }

  if (text.length > PROMPT_CHARACTER_LIMIT) {
    const minimal = `${sections[0] ?? ''} ${closing.join(' ')}`;
    text = minimal.slice(0, PROMPT_CHARACTER_LIMIT);
    reasons.push('reduced to a single field to fit the limit');
  }

  return { text, reasons, withinLimit: text.length <= PROMPT_CHARACTER_LIMIT };
}
