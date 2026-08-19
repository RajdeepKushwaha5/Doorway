/**
 * Contract with the NOTICE API.
 *
 * Mirrored rather than imported from the backend so the frontend can be
 * deployed and built entirely on its own. The cost is that these must be kept
 * in step by hand; `npm run check:contract` in the backend verifies every
 * shape this file claims.
 */

export type IncidentClassification =
  | 'healthy'
  | 'genuine_source_change'
  | 'extractor_drift'
  | 'access_anomaly'
  | 'inconclusive'
  | 'explicit_failure';

export type IncidentState =
  | 'observed'
  | 'validating'
  | 'healthy'
  | 'witness_pending'
  | 'classifying'
  | 'genuine_change'
  | 'access_retry'
  | 'inconclusive'
  | 'drift_confirmed'
  | 'healing'
  | 'awaiting_candidate'
  | 'verifying_candidate'
  | 'repair_rejected'
  | 'awaiting_approval'
  | 'approving'
  | 'verifying_production'
  | 'resolved'
  | 'rollback_or_escalate';

export interface CheckResult {
  checkId: string;
  field?: string;
  status: 'pass' | 'warn' | 'fail' | 'unknown';
  severity: number;
  confidence: number;
  expected?: unknown;
  observed?: unknown;
  explanation: string;
}

export interface EvidenceSpan {
  line: string;
  lineNumber: number;
  strategy: 'json-ld' | 'labelled-line' | 'table-row' | 'heading-adjacent' | 'bare-currency';
}

export interface WitnessValue {
  path: string;
  value: unknown;
  confidence: number;
  evidence: EvidenceSpan;
}

export interface WitnessObservation {
  url: string;
  fetchedAt: string;
  contentHash: string;
  excerpt: string;
  values: WitnessValue[];
  notFound: string[];
}

export interface TransitionRecord {
  from: IncidentState;
  to: IncidentState;
  at: string;
  actor: 'system' | 'user' | 'brightdata';
  reason: string;
  evidenceRefs: string[];
}

export interface GateCaseResult {
  url: string;
  label: string;
  passed: boolean;
  fields: { path: string; expected: unknown; observed: unknown; agreed: boolean; note: string }[];
  executionError: string | null;
}

export interface Incident {
  id: string;
  collectorId: string;
  runId: string;
  classification: IncidentClassification;
  confidence: number;
  affectedFields: string[];
  evidence: string[];
  witness: WitnessObservation | null;
  /** Id of a rendered capture of the page when the incident opened, if any. */
  screenshotId: string | null;
  repairPrompt: string | null;
  history: TransitionRecord[];
  gateResults: GateCaseResult[];
  quarantined: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CollectorSummary {
  id: string;
  brightDataCollectorId: string;
  name: string;
  targetDomain: string;
  status: 'active' | 'paused';
  watchUrls: string[];
  protectedFields: string[];
  /**
   * Whether a repair that passed the gate may promote itself.
   *
   * Surfaced because it is the single setting that decides whether this is a
   * dashboard or an automation, and an operator should never have to guess
   * which one they are looking at.
   */
  autoPromote: 'never' | 'on_gate_pass';
  openIncidents: number;
  contractVersion: number | null;
  contractConfidence: number;
  baselineRuns: number;
}

export interface HealthEnvelope {
  data: unknown;
  health: {
    status: 'verified' | 'quarantined' | 'stale' | 'unavailable';
    confidence: number;
    lastVerified: string | null;
    stale: boolean;
    fieldsDegraded: string[];
    incidentId: string | null;
    reason: string | null;
  };
}

export interface DealCandidate {
  collectorId: string;
  collectorName: string;
  url: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  health?: string;
  stale?: boolean;
}

export interface DealComparison {
  unguarded: { pick: DealCandidate | null; considered: DealCandidate[] };
  verified: { pick: DealCandidate | null; considered: DealCandidate[] };
  diverged: boolean;
  explanation: string[];
}

export interface JobRecord {
  id: string;
  kind: 'heal';
  incidentId: string;
  collectorId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  detail: string;
  outcome: 'approved' | 'rejected' | 'not_repairable' | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  claimedBy: string | null;
}

export interface RunRecord {
  id: string;
  collectorId: string;
  targetUrls: string[];
  rows: unknown[];
  checks: CheckResult[];
  durationMs: number;
  observedAt: string;
}

export interface CollectorContract {
  collectorId: string;
  version: number;
  sampleCount: number;
  confidence: number;
  requiredFields: string[];
  invariants: unknown[];
}

/** This month's monitoring spend against the account's free tier. */
export interface BudgetStatus {
  /** Page loads attributable to scheduled monitoring this calendar month. */
  spent: number;
  budget: number;
  remaining: number;
  /** True when the scheduler has paused until the month rolls over. */
  exhausted: boolean;
}

/** One value that never reached a consumer, and what was on the page instead. */
export interface WithheldValue {
  incidentId: string;
  collectorId: string;
  field: string;
  shipped: unknown;
  actual: unknown;
  evidence: string | null;
  silent: boolean;
  at: string;
}

/**
 * What the system prevented, as opposed to what it did.
 *
 * Mirrors `ImpactStats` in the backend. Kept as a structural copy rather than
 * imported across the workspace boundary, for the same reason as every other
 * type in this file: the dashboard must build without the backend present.
 */
export interface ImpactStats {
  runs: number;
  incidents: number;
  withheld: number;
  silent: number;
  restrained: number;
  quarantined: number;
  published: number;
  fields: string[];
  examples: WithheldValue[];
  firstAt: string | null;
  latestAt: string | null;
}
