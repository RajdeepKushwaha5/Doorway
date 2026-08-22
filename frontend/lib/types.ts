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

/**
 * Whether the witness read the page under observation.
 *
 * Mirrors `ShapeComparison` in the backend. `similarity` is supporting
 * evidence, not the decision: `samePage` is the decision, and `reason` says
 * why in one sentence.
 */
export interface PageIdentity {
  similarity: number;
  parts: { labels: number; headings: number; density: number; media: number };
  notes: string[];
  samePage: boolean;
  reason: string;
}

/** The conditions one sensor observed a page under. */
export interface AcquisitionContext {
  requestedUrl: string;
  resolvedUrl?: string;
  /** ISO 3166-1 alpha-2 exit country, when the fetch path could pin one. */
  country?: string;
  locale?: string;
  currency?: string;
  deviceType: 'desktop' | 'mobile' | 'unknown';
  variantMarkers: string[];
  observedAt: string;
}

/** How closely two sensors' conditions matched. */
export interface ContextAlignment {
  aligned: boolean;
  mismatches: string[];
  observationGapSeconds: number;
}

export interface IncidentAcquisition {
  collector: AcquisitionContext;
  witness: AcquisitionContext;
  alignment: ContextAlignment;
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
  /**
   * The conditions each sensor observed the page under.
   *
   * Null on incidents recorded before this was persisted, and on the paths
   * that open an incident without ever reaching a comparison.
   */
  acquisition: IncidentAcquisition | null;
  /**
   * Whether the witness read the page under observation.
   *
   * Null when this URL had never been verified, so there was nothing to
   * compare against, and on the path where the witness never read at all.
   */
  pageIdentity: PageIdentity | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** How the witness was told to read one field. Declared, never inferred. */
export interface WitnessFieldSpec {
  path: string;
  meaning: string;
  labels: string[];
  excludeLabels: string[];
  kind: 'money' | 'number' | 'text' | 'enum';
  allowed: string[];
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
   * The fields somebody declared this collector is for.
   *
   * Present on the detail route, which returns the whole record. Optional here
   * because the fleet listing is the same type and does not need it.
   */
  witnessSpecs?: WitnessFieldSpec[];
  /** How this collector came to exist, when anybody recorded it. */
  provenance?: CollectorProvenance;
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
    /**
     * How this value was actually confirmed.
     *
     * `two_sensors` is the project's headline claim. `contract_only` means the
     * witness was skipped because a baseline existed and every contract check
     * passed, which is a real but weaker statement and must not be displayed as
     * the stronger one.
     */
    confirmedBy: 'two_sensors' | 'contract_only' | 'none';
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

/**
 * One durable record of something the system did.
 *
 * Distinct from a `TransitionRecord`, which says how an incident moved between
 * states. These are the events themselves, with the actor that caused them:
 * a run ingested, a heal queued, a repair rejected by Bright Data. The backend
 * has always written and returned them; nothing displayed them until now.
 */
export interface AuditEvent {
  id: string;
  actor: 'system' | 'user' | 'brightdata';
  eventType: string;
  entityId: string;
  payload: unknown;
  at: string;
}

export type OpportunityType =
  | 'scholarship'
  | 'fellowship'
  | 'internship'
  | 'grant'
  | 'hackathon'
  | 'research-program';

export interface DoorwayProfile {
  country: string;
  educationLevel: string;
  interests: string[];
  skills: string[];
  opportunityTypes: OpportunityType[];
  fundingRequirement: 'full' | 'partial' | 'any';
  locations: string[];
}

export interface DoorwayOpportunity {
  id: string;
  collectorId: string;
  sourceUrl: string;
  title: string;
  provider: string;
  type: OpportunityType;
  summary: string;
  eligibility: string[];
  interests: string[];
  funding: {
    amount: number | null;
    currency: string | null;
    coverage: string[];
    level: 'full' | 'partial' | 'unspecified';
  };
  deadline: string | null;
  deadlineRaw: string | null;
  applicationStatus: 'open' | 'rolling' | 'closed' | 'unknown';
  statusReason: string | null;
  locations: string[];
  remote: boolean | null;
  requiredDocuments: string[];
  applicationUrl: string;
  trust: {
    status: 'verified' | 'partially_verified' | 'stale' | 'quarantined' | 'discovered';
    confirmedBy: 'two_sensors' | 'contract_only' | 'single_sensor';
    lastVerifiedAt: string;
    incidentId: string | null;
    fieldsDegraded: string[];
    /** What the open incident concluded, when one is open. Null when none is. */
    verdict: string | null;
  };
}

export interface DoorwayMatch {
  opportunity: DoorwayOpportunity;
  score: number;
  eligible: true | false | 'unknown';
  matchedRequirements: string[];
  unmetRequirements: string[];
  unknownRequirements: string[];
  explanation: string[];
}

export interface DoorwayWorld {
  generatedAt: string;
  profile: DoorwayProfile;
  matches: DoorwayMatch[];
  stats: {
    sources: number;
    opportunities: number;
    verified: number;
    closingSoon: number;
  };
}

/**
 * What a verified opportunity asks a student to actually do.
 *
 * Mirrors the backend shape exactly and is never re-derived here. The rules
 * about what counts as ready, what blocks an application and what a disputed
 * requirement means live in one place, on the server, for the same reason the
 * funding label does: two renderings of one rule is the arrangement that
 * silently drifts apart.
 */
export interface MissionDocument {
  name: string;
  status: 'held' | 'missing' | 'disputed';
}

export interface Mission {
  opportunityId: string;
  title: string;
  provider: string;
  applicationUrl: string;
  state: 'discovered' | 'verified' | 'eligible' | 'application_ready' | 'blocked' | 'submitted';
  stateReason: string;
  documents: MissionDocument[];
  readiness: { held: number; total: number; percent: number };
  deadline: {
    raw: string | null;
    at: number | null;
    safety: number | null;
    daysRemaining: number | null;
  };
  blockers: string[];
  disputed: string[];
  confirmedBy: string;
  lastVerifiedAt: string;
}

/**
 * How a collector came to exist.
 *
 * The `c_*` id is a receipt. The brief a coding agent turned into a working
 * scraper is the design, and until now nothing kept it.
 */
export interface CollectorProvenance {
  sourceUrl: string;
  description: string;
  observations: string[];
  protectedBecause: Record<string, string>;
  createdBy: 'coding_agent' | 'operator';
  createdAt: string;
  generationSeconds?: number;
}
