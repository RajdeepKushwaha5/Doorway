import type { CollectorProvenance } from './provenance.js';
import type {
  AcquisitionContext,
  ContextAlignment,
  CheckResult,
  HealthEnvelope,
  IncidentClassification,
} from '../shared/index.js';
import type { CollectorContract, Invariant } from '../contracts/index.js';
import type {
  PageShape,
  ShapeComparison,
  WitnessFieldSpec,
  WitnessObservation,
} from '../witness/index.js';
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
   * How this collector came to exist, when anybody recorded it.
   *
   * Optional because most of these predate it, and a collector without a
   * birth certificate is shown as having none rather than being given a
   * plausible one after the fact.
   */
  provenance?: CollectorProvenance | undefined;
  /**
   * Specs we know we want, before we know what the scraper calls those fields.
   *
   * A freshly generated scraper is not runnable for a minute or two, so the
   * schema it produces cannot be read at the moment it is created. Blocking
   * manufacture until it can be would mean waiting on something that may never
   * answer; guessing the field names produced a collector whose second sensor
   * looked for fields that did not exist and whose record was published as
   * confirmed by two sensors anyway.
   *
   * So the intent is kept here, and the first run that returns rows promotes
   * these into real specs keyed to the schema that exists. The system
   * converges instead of blocking, and until it does the collector is honestly
   * unwatched rather than falsely watched.
   */
  pendingWitnessSpecs?: WitnessFieldSpec[] | undefined;
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
  /**
   * How many minutes a verified value stays verified for this source.
   *
   * Decay is a property of the subject, not of the system. Bright Data's own
   * analysis puts a retail or finance page at roughly thirty days of useful
   * life and a social page at under one, so a price watcher and a follower
   * count cannot share a threshold. Null takes the default of 24 hours.
   */
  freshnessMinutes: number | null;
  /**
   * ISO 4217 code for the currency this source prices in, such as `USD`.
   *
   * Declared rather than inferred. `$` is used by more than twenty currencies,
   * so `normalizeMoney` refuses to resolve it and asks callers who know to say
   * so. Nobody was saying so, which is why a page reading `$249` produced a
   * value with no currency at all and rendered as a bare `249`.
   *
   * Null means the source did not say and nobody declared it. That is a real
   * state and is shown as such, because a price without a currency is exactly
   * the kind of technically-valid, practically-useless value this system is
   * built to surface rather than paper over.
   */
  currency: string | null;
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
  /**
   * The conditions each sensor observed the page under.
   *
   * Computed on every classification since the beginning and thrown away
   * immediately afterwards, which made `access_anomaly` the one verdict a
   * reader had to take on faith. The classifier was saying "these two sensors
   * were not looking at the same thing" and the interface could not show what
   * differed, so the most restrained verdict in the system looked like the
   * least substantiated one.
   *
   * Null on incidents recorded before this was persisted, and on the paths
   * that open an incident without ever reaching a comparison.
   */
  acquisition: {
    collector: AcquisitionContext;
    witness: AcquisitionContext;
    alignment: ContextAlignment;
  } | null;
  /**
   * Whether the witness read the page under observation, and how sure of that.
   *
   * The second sensor was the one thing in this system taken on faith. It is
   * now asked to prove the document it read is the one that was verified
   * before, and the answer is kept whichever way it went: a passing check is
   * the reason a disagreement is worth acting on, not a formality.
   *
   * Null when there was no verified reading of this URL to compare against,
   * and on the path where the witness never read at all.
   */
  pageIdentity: ShapeComparison | null;
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
  /**
   * The structure of the page as the witness last read it and was believed.
   *
   * Recorded only here, on the record written when two sensors agreed, so the
   * reference for "is this the same page" can never be learned from a reading
   * nobody trusted. That is the same rule the statistical baseline follows,
   * applied to the second sensor.
   *
   * Null when the run was healthy enough that no witness was fetched, and on
   * snapshots written before this existed.
   */
  shape: PageShape | null;
  /**
   * Whether a witness actually read this value, or only the contracts passed.
   *
   * Written so the feed can stop claiming two-sensor confirmation for a value
   * no second sensor ever saw. Absent on snapshots stored before this existed,
   * which are treated as the weaker claim rather than the stronger one.
   */
  confirmedBy?: 'two_sensors' | 'contract_only';
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
  /**
   * One run by id.
   *
   * Added so an incident can be shown beside the rows that caused it. Runs
   * were only reachable by collector, which meant the one record that says
   * what the collector actually returned was unavailable on the page arguing
   * about what the collector actually returned.
   */
  getRun(id: string): Promise<RunRecord | null>;

  saveIncident(incident: IncidentRecord): Promise<void>;
  getIncident(id: string): Promise<IncidentRecord | null>;
  listIncidents(collectorId?: string): Promise<IncidentRecord[]>;

  saveVerifiedSnapshot(snapshot: VerifiedSnapshot): Promise<void>;
  getVerifiedSnapshot(collectorId: string, url: string): Promise<VerifiedSnapshot | null>;
  listVerifiedSnapshots(): Promise<VerifiedSnapshot[]>;

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
