import {
  aggregateChecks,
  compareAcquisitionContexts,
  type AcquisitionContext,
  type CheckResult,
  type IncidentClassification,
} from '../shared/index.js';
import { hasHardFailure, hasSuspicion } from '../contracts/index.js';
import { findCrossFieldMatch, type ReconciliationSummary } from '../witness/index.js';

/**
 * Confidence below which the witness is not considered to have said anything
 * useful. A `bare-currency` hit sits at 0.35 and must never, on its own,
 * authorize rewriting a production collector.
 */
const MIN_WITNESS_CONFIDENCE = 0.5;

/** Fraction of fields that must be comparable before a verdict is trusted. */
const MIN_COVERAGE = 0.5;

export interface ClassificationInput {
  checks: readonly CheckResult[];
  /** Absent when the run passed cleanly and no witness was fetched. */
  reconciliation?: ReconciliationSummary;
  collectorContext?: AcquisitionContext;
  witnessContext?: AcquisitionContext;
  /** True when the disagreeing values were also outside the learned baseline. */
  departsFromBaseline?: boolean;
}

export interface Classification {
  verdict: IncidentClassification;
  confidence: number;
  /** Field paths implicated, most significant first. */
  affectedFields: string[];
  /** Ordered, human-readable reasons. These become the incident timeline. */
  evidence: string[];
  /**
   * For drift only: the field the collector appears to have captured instead.
   * This is what makes the repair prompt actionable rather than a complaint.
   */
  capturedInstead: Record<string, string[]>;
}

/**
 * Decide what a suspicious run means.
 *
 * The central rule, and the thing that separates this from a diff tool:
 *
 *   If the independent witness agrees with the collector, the world changed.
 *   If it disagrees, the collector broke.
 *
 * Everything else here exists to stop that rule firing when it should not:
 * when the two sensors looked at different pages, when the witness evidence is
 * too weak to convict, or when too few fields could be compared at all.
 */
export function classify(input: ClassificationInput): Classification {
  const evidence: string[] = [];
  const summary = aggregateChecks(input.checks);

  // 1. An explicit error or an empty result needs no witness to be a problem.
  const explicit = input.checks.find(
    (check) =>
      check.status === 'fail' &&
      (check.checkId === 'structure:collector_error' ||
        check.checkId === 'structure:empty_result'),
  );
  if (explicit !== undefined) {
    evidence.push(explicit.explanation);
    return {
      verdict: 'explicit_failure',
      confidence: 1,
      affectedFields: explicit.field === undefined ? [] : [explicit.field],
      evidence,
      capturedInstead: {},
    };
  }

  // 2. Nothing tripped, so nothing to explain.
  //
  // The witness is consulted here even when every contract check passed. An
  // earlier version returned `healthy` at this point without looking at the
  // reconciliation at all, which meant a disagreement was computed and then
  // discarded whenever the contracts happened to be weak: a collector with few
  // invariants, or one with no baseline yet, could drift and be published.
  // Contract silence is not evidence of correctness.
  const contractsQuiet = !hasHardFailure(input.checks) && !hasSuspicion(input.checks);
  const witnessQuiet =
    input.reconciliation === undefined || input.reconciliation.disagreed.length === 0;

  if (contractsQuiet && witnessQuiet) {
    return {
      verdict: 'healthy',
      confidence: Math.max(0.5, summary.coverage),
      affectedFields: [],
      evidence:
        input.reconciliation === undefined
          ? ['all contract checks passed']
          : ['all contract checks passed and the independent witness agrees'],
      capturedInstead: {},
    };
  }

  const failing = input.checks
    .filter((check) => check.status === 'fail' || check.status === 'warn')
    .sort((a, b) => b.severity * b.confidence - a.severity * a.confidence);
  for (const check of failing.slice(0, 5)) evidence.push(check.explanation);

  // 3. Without a witness there is evidence of a problem but no way to say
  //    whether the page or the extractor is responsible.
  if (input.reconciliation === undefined) {
    return {
      verdict: 'inconclusive',
      confidence: 0.3,
      affectedFields: [...new Set(failing.map((c) => c.field).filter((f) => f !== undefined))],
      evidence: [...evidence, 'no witness observation was available to explain the anomaly'],
      capturedInstead: {},
    };
  }

  const reconciliation = input.reconciliation;

  // 4. Did the two sensors actually look at the same thing? If a redirect,
  //    region or variant differs, any value difference is explained by that
  //    and blaming the extractor would rewrite a working collector.
  if (input.collectorContext !== undefined && input.witnessContext !== undefined) {
    const alignment = compareAcquisitionContexts(input.collectorContext, input.witnessContext);
    if (!alignment.aligned) {
      return {
        verdict: 'access_anomaly',
        confidence: 0.7,
        affectedFields: reconciliation.disagreed,
        evidence: [
          ...evidence,
          `collector and witness did not observe the same page: ${alignment.mismatches.join('; ')}`,
        ],
        capturedInstead: {},
      };
    }
  }

  // 5. Too little comparable evidence to convict either way.
  if (reconciliation.coverage < MIN_COVERAGE) {
    return {
      verdict: 'inconclusive',
      confidence: 0.35,
      affectedFields: reconciliation.disagreed,
      evidence: [
        ...evidence,
        `only ${Math.round(reconciliation.coverage * 100)}% of fields could be compared; the witness could not read ${reconciliation.incomparable.join(', ')}`,
      ],
      capturedInstead: {},
    };
  }

  // 6. The sensors agree with each other. The extraction is working and the
  //    underlying fact moved. This must not be healed.
  if (reconciliation.disagreed.length === 0) {
    const changed = input.departsFromBaseline === true;
    return {
      verdict: changed ? 'genuine_source_change' : 'healthy',
      confidence: 0.8,
      affectedFields: [...new Set(failing.map((c) => c.field).filter((f) => f !== undefined))],
      evidence: [
        ...evidence,
        'the independent witness reports the same values as the collector, so extraction is intact and the source itself changed',
      ],
      capturedInstead: {},
    };
  }

  // 7. The sensors disagree, but on evidence too weak to act on.
  if (reconciliation.weakestDisagreementConfidence < MIN_WITNESS_CONFIDENCE) {
    return {
      verdict: 'inconclusive',
      confidence: 0.4,
      affectedFields: reconciliation.disagreed,
      evidence: [
        ...evidence,
        `witness disagreed but its strongest evidence for the disputed field scored only ${reconciliation.weakestDisagreementConfidence.toFixed(2)}, which is not enough to convict the collector`,
      ],
      capturedInstead: {},
    };
  }

  // 8. Corroborated disagreement. The collector drifted.
  const capturedInstead: Record<string, string[]> = {};
  for (const path of reconciliation.disagreed) {
    const matches = findCrossFieldMatch(path, reconciliation);
    if (matches.length > 0) capturedInstead[path] = matches;
  }

  for (const comparison of reconciliation.comparisons) {
    if (comparison.agreement.kind !== 'disagree') continue;
    evidence.push(
      `"${comparison.path}": collector reported ${JSON.stringify(comparison.collectorValue)}, witness read ${JSON.stringify(comparison.witnessValue)} from "${comparison.evidence?.line ?? 'unknown line'}"`,
    );
    const captured = capturedInstead[comparison.path];
    if (captured !== undefined) {
      evidence.push(
        `"${comparison.path}" now matches the value the witness read for "${captured.join('", "')}", which is the signature of a moved selector rather than a changed price`,
      );
    }
  }

  return {
    verdict: 'extractor_drift',
    confidence: Math.min(0.95, reconciliation.weakestDisagreementConfidence * reconciliation.agreementRate + 0.5),
    affectedFields: reconciliation.disagreed,
    evidence,
    capturedInstead,
  };
}
