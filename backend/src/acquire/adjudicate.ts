import { createHash } from 'node:crypto';
import { classify } from '../incident/classify.js';
import { reconcile } from '../witness/compare.js';
import type { WitnessFieldSpec, WitnessObservation } from '../witness/spec.js';
import type { CheckResult } from '../shared/index.js';
import type { StructuredFacts } from './structured.js';

/**
 * Judge a discovered page with the engine, not with a second opinion about it.
 *
 * Discovery grew its own way of setting two readings against each other. It
 * worked, and it meant this product contained two verification systems wearing
 * the same words: a watched source saying "two sensors" had been through
 * contracts, reconciliation and a six-way classification, while a discovered
 * one saying "two sensors" had been through forty lines written separately.
 *
 * Nobody reading either sentence could tell which they were being told, and the
 * distinction between those two claims is the entire product.
 *
 * So the comparison happens where every comparison happens. The page's visible
 * text is one sensor and its embedded structured data is the other, exactly as
 * a collector and the witness are for a watched source, and `reconcile` and
 * `classify` decide what that disagreement means. The same six verdicts, the
 * same evidence sentences, the same rules about what counts as corroboration.
 *
 * What cannot come along is the contract layer. A page found ten seconds ago
 * has no learned history to depart from, so there is nothing for a baseline to
 * say and no honest way to invent one. That is why a discovered record still
 * reads `discovered` rather than `verified`: the second sensor agrees, and
 * nobody has been watching.
 */

/** What the structured reading is treated as, so reconcile can compare them. */
const STRUCTURED_SPECS: WitnessFieldSpec[] = [
  {
    path: 'deadline_raw',
    meaning: 'the date applications close, as the page declared it in machine-readable form',
    labels: ['registrationDeadline', 'applicationDeadline', 'deadline', 'validThrough'],
    excludeLabels: [],
    kind: 'text',
    allowed: [],
    // Declared a date so the comparison judges the day rather than the
    // spelling. "15th July 2027" and "2027-07-15" are one fact written by two
    // authors for two audiences.
    shape: 'date',
  },
];

export interface Adjudication {
  /** One of the six verdicts, from the same classifier a watched source uses. */
  verdict: string;
  confidence: number;
  /** Fields the two readings disagreed about. */
  affectedFields: string[];
  /** The engine's own sentences, in the words a watched incident uses. */
  evidence: string[];
  /** Whether both readings were present and agreed. */
  corroborated: boolean;
}

/**
 * Set the visible text against the embedded data, through the engine.
 *
 * Returns null when the page declared nothing machine-readable, which is not a
 * disagreement and must not be reported as one. Most pages declare nothing, and
 * a system that treated silence as conflict would quarantine the web.
 */
export function adjudicateStructured(
  visible: { deadlineRaw: string | null },
  facts: StructuredFacts,
  sourceUrl: string,
  fetchedAt: string,
): Adjudication | null {
  if (facts.deadline === null) return null;

  /*
   * The structured reading, shaped as an observation.
   *
   * Confidence is the same value `extract.ts` gives JSON-LD, because that is
   * what this is: the publisher's own machine-readable claim about the page,
   * which outranks anything inferred from prose.
   */
  const observation: WitnessObservation = {
    url: sourceUrl,
    fetchedAt,
    contentHash: createHash('sha256').update(facts.deadline).digest('hex'),
    excerpt: `${facts.deadlineField ?? 'deadline'}: ${facts.deadline}`,
    values: [
      {
        path: 'deadline_raw',
        value: facts.deadline,
        confidence: 0.95,
        evidence: {
          line: `"${facts.deadlineField ?? 'deadline'}": "${facts.deadline}"`,
          lineNumber: 1,
          strategy: 'json-ld',
        },
      },
    ],
    notFound: [],
    /*
     * There is no page shape here, and saying so precisely matters.
     *
     * Shape answers "is this still the same document", which is a question
     * about a page being watched over time. This reading is of a machine
     * readable block, not of a rendered document, and it has no history to be
     * compared against. An empty shape is the truthful description of that
     * rather than a stand-in for one.
     */
    shape: { headings: [], labels: [], lines: 0, links: 0, tables: 0, images: 0, words: 0 },
  };

  const summary = reconcile({ deadline_raw: visible.deadlineRaw }, observation, STRUCTURED_SPECS);

  /*
   * No contracts, and therefore no checks.
   *
   * A page found seconds ago has no learned history, so there is nothing for a
   * baseline to assert. Passing an empty list is honest: the classifier is
   * being asked what the two readings mean, and nothing else.
   */
  const checks: readonly CheckResult[] = [];
  const classification = classify({ checks, reconciliation: summary });

  return {
    verdict: classification.verdict,
    confidence: classification.confidence,
    affectedFields: classification.affectedFields,
    evidence: classification.evidence,
    corroborated: summary.agreed.includes('deadline_raw'),
  };
}
