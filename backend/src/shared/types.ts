import { z } from 'zod';

/**
 * Result of a single validator against a single collector run.
 *
 * `unknown` is distinct from `fail` on purpose. A check that could not be
 * evaluated, because the baseline is too small or the witness returned
 * nothing, must not contribute to a failure score. Conflating the two is how a
 * monitoring tool starts rewriting collectors that were never broken.
 */
export const checkResultSchema = z.object({
  checkId: z.string(),
  /** Dotted path into the normalized output, such as `price.value`. */
  field: z.string().optional(),
  status: z.enum(['pass', 'warn', 'fail', 'unknown']),
  /** How bad this is if it is real. 0 is cosmetic, 1 is a hard invariant break. */
  severity: z.number().min(0).max(1),
  /** How sure we are the observation is correct, independent of severity. */
  confidence: z.number().min(0).max(1),
  expected: z.unknown().optional(),
  observed: z.unknown().optional(),
  /** Plain-language reason, shown in the UI and fed into repair prompts. */
  explanation: z.string(),
});

export type CheckResult = z.infer<typeof checkResultSchema>;

/**
 * What NOTICE concluded about a suspicious run.
 *
 * The two outcomes that make this more than a health monitor are
 * `genuine_source_change` and `access_anomaly`: both look like failures to a
 * naive check and neither should trigger a repair.
 */
export const incidentClassificationSchema = z.enum([
  /** Output matches contracts and current evidence. */
  'healthy',
  /** Collector and witness agree with each other but differ from history. */
  'genuine_source_change',
  /** Collector disagrees with corroborated witness evidence. */
  'extractor_drift',
  /** Sensors likely observed different page variants, regions or sessions. */
  'access_anomaly',
  /** Evidence is insufficient or self-contradictory. */
  'inconclusive',
  /** Error, empty result, or structurally invalid output. */
  'explicit_failure',
]);

export type IncidentClassification = z.infer<typeof incidentClassificationSchema>;

/** Whether a classification should ever reach the repair workflow. */
export function shouldAttemptRepair(classification: IncidentClassification): boolean {
  return classification === 'extractor_drift' || classification === 'explicit_failure';
}

/** Lifecycle of an incident. Transitions are recorded with actor and reason. */
export const incidentStateSchema = z.enum([
  'observed',
  'validating',
  'healthy',
  'witness_pending',
  'classifying',
  'genuine_change',
  'access_retry',
  'inconclusive',
  'drift_confirmed',
  'healing',
  'awaiting_candidate',
  'verifying_candidate',
  'repair_rejected',
  'awaiting_approval',
  'approving',
  'verifying_production',
  'resolved',
  'rollback_or_escalate',
]);

export type IncidentState = z.infer<typeof incidentStateSchema>;

/**
 * What a downstream consumer receives.
 *
 * Staleness is never hidden. `last_known_good` is a resilience mechanism, not
 * permission to present old data as live, so `stale` and `last_verified` are
 * required whenever data is served from quarantine.
 */
export const healthEnvelopeSchema = z.object({
  data: z.unknown().nullable(),
  health: z.object({
    status: z.enum(['verified', 'quarantined', 'stale', 'unavailable']),
    /** Aggregate confidence in the payload, 0 to 1. */
    confidence: z.number().min(0).max(1),
    /** When this payload was last confirmed correct. */
    lastVerified: z.string().datetime().nullable(),
    /** True when the payload predates the most recent collection attempt. */
    stale: z.boolean(),
    /** Field paths whose values are suspect or withheld. */
    fieldsDegraded: z.array(z.string()),
    incidentId: z.string().nullable(),
    /** Machine-readable cause, such as `collector_witness_disagreement`. */
    reason: z.string().nullable(),
  }),
});

export type HealthEnvelope = z.infer<typeof healthEnvelopeSchema>;

/**
 * Aggregate check results into a single explainable score.
 *
 * `unknown` results are excluded from both numerator and denominator rather
 * than counted as passes, so a run where most checks could not be evaluated
 * reports low coverage instead of false health.
 *
 * @returns Weighted failure in 0..1, and the coverage the score is based on.
 */
export function aggregateChecks(
  checks: readonly CheckResult[],
  weights: Readonly<Record<string, number>> = {},
): { weightedFailure: number; coverage: number; evaluated: number; total: number } {
  const evaluable = checks.filter((c) => c.status !== 'unknown');
  if (evaluable.length === 0) {
    return { weightedFailure: 0, coverage: 0, evaluated: 0, total: checks.length };
  }

  let numerator = 0;
  let denominator = 0;
  for (const check of evaluable) {
    const weight = weights[check.checkId] ?? 1;
    denominator += weight;
    if (check.status === 'fail' || check.status === 'warn') {
      numerator += check.severity * check.confidence * weight;
    }
  }

  return {
    weightedFailure: denominator === 0 ? 0 : numerator / denominator,
    coverage: evaluable.length / checks.length,
    evaluated: evaluable.length,
    total: checks.length,
  };
}
