import type {
  AcquisitionContext,
  CheckResult,
  HealthEnvelope,
  IncidentClassification,
} from '../shared/index.js';
import type { CollectorContract, Invariant } from '../contracts/index.js';
import type { WitnessFieldSpec, WitnessObservation } from '../witness/index.js';
import type { GateCaseResult, GoldenCase, TransitionRecord } from '../incident/index.js';

/** A Scraper Studio collector under observation. */
export interface CollectorRecord {
  id: string;
  /** The `c_...` identifier. Survives healing, which is why it is the key. */
  brightDataCollectorId: string;
  name: string;
  targetDomain: string;
  status: 'active' | 'paused';
  /** Cron-ish schedule, or null for manual runs only. */
  schedule: string | null;
  /** URLs sampled on every scheduled run. */
  watchUrls: string[];
  /** How the witness should read this collector's fields. */
  witnessSpecs: WitnessFieldSpec[];
  /** User-declared facts. Never inferred. */
  invariants: Invariant[];
  /** Fields a repair may not drop. */
  protectedFields: string[];
  /** Pinned correct outputs, used as the regression corpus. */
  goldenCases: GoldenCase[];
  acquisitionContext: Partial<AcquisitionContext>;
  /**
   * Whether a repair that passed the gate may be promoted without a human.
   *
   * `never` is the default, and is the right setting while you are learning
   * what a collector's incidents look like. `on_gate_pass` closes the loop:
   * observe, detect, repair, replay against the incident and the regression
   * corpus, promote, then re-verify production.
   *
   * Automating this is defensible only because every step before it is
   * checked. The gate has to pass on the page that failed and on the pages
   * that were working, and production is verified again afterwards against the
   * full contract. A promotion that does not actually fix production escalates
   * rather than reporting success, which is exactly the case Bright Data's own
   * `success: true` missed.
   */
  autoPromote: 'never' | 'on_gate_pass';
  createdAt: string;
}

/** One execution of a collector. */
export interface RunRecord {
  id: string;
  collectorId: string;
  brightDataSnapshotId: string | null;
  targetUrls: string[];
  version: 'production' | 'dev';
  rows: unknown[];
  checks: CheckResult[];
  durationMs: number;
  observedAt: string;
}

/** An open or closed investigation. */
export interface IncidentRecord {
  id: string;
  collectorId: string;
  runId: string;
  classification: IncidentClassification;
  confidence: number;
  affectedFields: string[];
  evidence: string[];
  witness: WitnessObservation | null;
  /** Prompt sent to Self-Healing, when one was generated. */
  repairPrompt: string | null;
  /**
   * Id of a rendered capture of the page at the moment the incident opened.
   *
   * The markdown witness records what the page said; this records what it
   * showed. An operator deciding whether to approve a repair is really asking
   * "what was actually on the page", and two numbers in a table cannot answer
   * that as convincingly as the page itself.
   *
   * Null when capture was not attempted or failed. Never blocks an incident:
   * an illustration is worth having and never worth failing detection for.
   */
  screenshotId: string | null;
  history: TransitionRecord[];
  gateResults: GateCaseResult[];
  quarantined: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

/** Last output verified correct for a collector and URL. */
export interface VerifiedSnapshot {
  collectorId: string;
  url: string;
  data: unknown;
  contractVersion: number;
  verifiedAt: string;
  contentHash: string;
}

/**
 * A long-running piece of work owned by the worker.
 *
 * Healing polls Bright Data for up to fifteen minutes. Doing that inside an
 * HTTP request means a browser tab, a proxy timeout or a deploy can destroy a
 * repair that is already in flight on Bright Data's side, leaving an incident
 * stranded between states with a candidate sitting at their approval gate.
 * The request creates one of these and returns; the worker does the waiting.
 */
export interface JobRecord {
  id: string;
  kind: 'heal';
  incidentId: string;
  collectorId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  /** Human-readable progress, updated as the worker advances. */
  detail: string;
  /** Populated on completion. `rejected` is a successful job with a blocked repair. */
  outcome: 'approved' | 'rejected' | 'not_repairable' | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Guards against two workers claiming the same job. */
  claimedBy: string | null;
}

/** Append-only record of everything that happened. */
export interface AuditEvent {
  id: string;
  actor: 'system' | 'user' | 'brightdata';
  eventType: string;
  entityId: string;
  payload: unknown;
  at: string;
}

/**
 * Persistence boundary.
 *
 * An interface rather than direct database calls so the pipeline can be tested
 * without a running server, and so the file-backed implementation used for
 * local work and demos can be swapped for Postgres without touching a single
 * line of orchestration logic.
 */
export interface Store {
  saveCollector(collector: CollectorRecord): Promise<void>;
  getCollector(id: string): Promise<CollectorRecord | null>;
  listCollectors(): Promise<CollectorRecord[]>;

  saveContract(contract: CollectorContract): Promise<void>;
  getContract(collectorId: string): Promise<CollectorContract | null>;

  saveRun(run: RunRecord): Promise<void>;
  listRuns(collectorId: string, limit?: number): Promise<RunRecord[]>;

  saveIncident(incident: IncidentRecord): Promise<void>;
  getIncident(id: string): Promise<IncidentRecord | null>;
  listIncidents(collectorId?: string): Promise<IncidentRecord[]>;

  saveVerifiedSnapshot(snapshot: VerifiedSnapshot): Promise<void>;
  getVerifiedSnapshot(collectorId: string, url: string): Promise<VerifiedSnapshot | null>;

  saveJob(job: JobRecord): Promise<void>;
  getJob(id: string): Promise<JobRecord | null>;
  listJobs(incidentId?: string): Promise<JobRecord[]>;
  /**
   * Atomically take the oldest queued job.
   *
   * Returns null when there is nothing to do. The claim is what stops two
   * worker instances running the same heal twice.
   */
  claimNextJob(workerId: string): Promise<JobRecord | null>;

  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(entityId: string): Promise<AuditEvent[]>;
}

/** What a downstream consumer of the verified feed receives. */
export interface FeedResponse extends HealthEnvelope {
  collectorId: string;
  url: string;
}
