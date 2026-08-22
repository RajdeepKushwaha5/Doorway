import { createHash } from 'node:crypto';
import { compareValues, type ValueAgreement } from '../shared/index.js';
import { getPath } from '../contracts/paths.js';
import { extractFields } from './extract.js';
import type { EvidenceSpan, WitnessFieldSpec, WitnessObservation } from './spec.js';
import { pageShape } from './shape.js';
import { parseDeadline } from '../acquire/dates.js';

/** How the collector and the witness compared on a single field. */
export interface FieldComparison {
  path: string;
  collectorValue: unknown;
  witnessValue: unknown;
  agreement: ValueAgreement;
  /** Trust in the witness side specifically, from the extraction strategy. */
  witnessConfidence: number;
  evidence: EvidenceSpan | null;
}

/** The reconciled picture across every field. */
export interface ReconciliationSummary {
  comparisons: FieldComparison[];
  agreed: string[];
  disagreed: string[];
  incomparable: string[];
  /**
   * Share of fields where the sensors agreed, over the fields that could be
   * compared at all. Incomparable fields are excluded from both sides rather
   * than counted as agreement, so poor evidence shows up as low coverage
   * instead of false confidence.
   */
  agreementRate: number;
  /** Fields compared, over fields attempted. */
  coverage: number;
  /** Lowest witness confidence among the disagreements, or 1 when none. */
  weakestDisagreementConfidence: number;
}

const EXCERPT_LIMIT = 4000;

/** SHA-256 of the raw witness body, so evidence can be shown unedited. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Turn a fetched markdown body into a witness observation.
 *
 * The full body is deliberately not retained. A hash proves the excerpt was
 * not edited after the fact, and an excerpt is enough for a human to check the
 * machine, while storing entire pages would turn the incident log into an
 * uncontrolled copy of other people's sites.
 */
export function observeMarkdown(
  url: string,
  markdown: string,
  specs: readonly WitnessFieldSpec[],
  fetchedAt: string,
): WitnessObservation {
  const { values, notFound } = extractFields(markdown, specs);
  return {
    url,
    fetchedAt,
    contentHash: hashContent(markdown),
    excerpt: markdown.slice(0, EXCERPT_LIMIT),
    values,
    notFound,
    shape: pageShape(markdown),
  };
}

/**
 * Compare one collector row against a witness observation.
 *
 * This produces evidence, not a verdict. Whether a disagreement means the
 * extractor drifted, the page varied by region, or the witness simply read the
 * wrong line is the classifier's decision, and it needs the acquisition
 * context to make it.
 */
/**
 * Compare two dates on the day they mean, not the way they are written.
 *
 * Falls back to ordinary comparison when either side cannot be parsed, so a
 * value that is not a date is still judged rather than waved through.
 */
function compareDates(collectorValue: unknown, witnessValue: unknown): ValueAgreement {
  if (typeof collectorValue === 'string' && typeof witnessValue === 'string') {
    const left = parseDeadline(collectorValue);
    const right = parseDeadline(witnessValue);
    if (left !== null && right !== null) {
      return left === right
        ? { kind: 'agree', note: 'both readings name the same day' }
        : {
            kind: 'disagree',
            note: `the readings name different days: ${collectorValue} against ${witnessValue}`,
          };
    }
  }
  return compareValues(collectorValue, witnessValue);
}

export function reconcile(
  collectorRow: unknown,
  observation: WitnessObservation,
  specs: readonly WitnessFieldSpec[],
): ReconciliationSummary {
  const comparisons: FieldComparison[] = [];

  for (const spec of specs) {
    const lookup = getPath(collectorRow, spec.path);
    const collectorValue = lookup.found ? lookup.value : null;
    const witnessValue = observation.values.find((value) => value.path === spec.path);

    // Money is compared on magnitude and currency together. Handing the whole
    // object to compareValues lets it catch a correct number in the wrong
    // currency, which is invisible if only magnitudes are compared.
    /*
     * Two spellings of one date are one date.
     *
     * Text is compared as text, which is right for a title and wrong for a
     * closing date: a collector reading "18 September 2026" and a witness
     * reading "2026-09-18" are agreeing, and comparing the strings calls that
     * drift. It would have quarantined a correct record on the strength of two
     * publishers formatting a date differently, which is most of them.
     *
     * Only for specs that declared themselves dates. Everything else compares
     * exactly as before.
     */
    const agreement =
      spec.shape === 'date'
        ? compareDates(collectorValue, witnessValue?.value ?? null)
        : compareValues(collectorValue, witnessValue?.value ?? null);

    comparisons.push({
      path: spec.path,
      collectorValue,
      witnessValue: witnessValue?.value ?? null,
      agreement,
      witnessConfidence: witnessValue?.confidence ?? 0,
      evidence: witnessValue?.evidence ?? null,
    });
  }

  const agreed = comparisons.filter((c) => c.agreement.kind === 'agree').map((c) => c.path);
  const disagreed = comparisons.filter((c) => c.agreement.kind === 'disagree').map((c) => c.path);
  const incomparable = comparisons
    .filter((c) => c.agreement.kind === 'incomparable')
    .map((c) => c.path);

  const comparable = agreed.length + disagreed.length;
  const disagreementConfidences = comparisons
    .filter((c) => c.agreement.kind === 'disagree')
    .map((c) => c.witnessConfidence);

  return {
    comparisons,
    agreed,
    disagreed,
    incomparable,
    agreementRate: comparable === 0 ? 0 : agreed.length / comparable,
    coverage: comparisons.length === 0 ? 0 : comparable / comparisons.length,
    weakestDisagreementConfidence:
      disagreementConfidences.length === 0 ? 1 : Math.min(...disagreementConfidences),
  };
}

/**
 * Detect a collector value that matches a *different* field on the page.
 *
 * This is the signature of selector drift rather than a source change. When
 * the collector's price equals what the witness read as the deposit, the page
 * did not change its prices, the extractor moved. Naming that in the repair
 * prompt is the difference between "price is wrong" and an instruction the
 * healer can act on.
 *
 * @returns Paths whose witness value matches this field's collector value.
 */
export function findCrossFieldMatch(
  path: string,
  summary: ReconciliationSummary,
): string[] {
  const subject = summary.comparisons.find((c) => c.path === path);
  if (subject === undefined || subject.agreement.kind !== 'disagree') return [];

  const matches: string[] = [];
  for (const other of summary.comparisons) {
    if (other.path === path || other.witnessValue === null) continue;
    if (compareValues(subject.collectorValue, other.witnessValue).kind === 'agree') {
      matches.push(other.path);
    }
  }
  return matches;
}
