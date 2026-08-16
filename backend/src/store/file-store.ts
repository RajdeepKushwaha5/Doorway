import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CollectorContract } from '../contracts/index.js';
import { redact } from '../shared/index.js';
import type {
  AuditEvent,
  CollectorRecord,
  IncidentRecord,
  JobRecord,
  RunRecord,
  Store,
  VerifiedSnapshot,
} from './types.js';

interface Snapshot {
  jobs: Record<string, JobRecord>;
  collectors: Record<string, CollectorRecord>;
  contracts: Record<string, CollectorContract>;
  runs: RunRecord[];
  incidents: Record<string, IncidentRecord>;
  verified: Record<string, VerifiedSnapshot>;
  audit: AuditEvent[];
}

const EMPTY: Snapshot = {
  jobs: {},
  collectors: {},
  contracts: {},
  runs: [],
  incidents: {},
  verified: {},
  audit: [],
};

/** Cap retained runs so a week of monitoring cannot grow without bound. */
const MAX_RUNS = 2000;

/**
 * File-backed store.
 *
 * Chosen over Postgres for the hackathon build because a judge cloning the
 * repository can run the whole system with `npm install` and nothing else. A
 * database that must be provisioned before anything works is a reproducibility
 * risk on a submission that is partly judged on being reproducible.
 *
 * Writes go through a temporary file and a rename, which is atomic on the
 * platforms this runs on. Without that, a crash mid-write during a long heal
 * would leave truncated JSON and lose the incident history that is the entire
 * evidence trail.
 */
export class FileStore implements Store {
  #path: string;
  #snapshot: Snapshot | null = null;
  /** mtime of the file the cached snapshot came from. */
  #loadedMtimeMs = -1;
  /** Serializes writes so concurrent saves cannot interleave. */
  #writeChain: Promise<void> = Promise.resolve();

  constructor(path = join(process.cwd(), 'data', 'notice.json')) {
    this.#path = path;
  }

  /**
   * Re-read the file when it has changed on disk.
   *
   * The API and the worker are separate processes. An earlier version cached
   * the snapshot on first load and never looked again, so the API could not
   * see incidents the worker had written, and either process could overwrite
   * the other's changes wholesale. Checking mtime keeps two local processes
   * consistent at the cost of one stat per operation.
   *
   * This does not make the file store safe across hosts. Two Render services
   * do not share a filesystem, and the `Store` interface exists so a shared
   * database can replace this without touching any orchestration code.
   */
  async #load(): Promise<Snapshot> {
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(this.#path)).mtimeMs;
    } catch {
      // Missing file. Fall through with mtime 0 and start from empty.
    }

    if (this.#snapshot !== null && mtimeMs === this.#loadedMtimeMs) {
      return this.#snapshot;
    }

    try {
      const raw = await readFile(this.#path, 'utf8');
      this.#snapshot = { ...EMPTY, ...(JSON.parse(raw) as Partial<Snapshot>) };
    } catch {
      this.#snapshot = structuredClone(EMPTY);
    }
    this.#loadedMtimeMs = mtimeMs;
    return this.#snapshot;
  }

  async #persist(): Promise<void> {
    const write = this.#writeChain.then(async () => {
      const snapshot = await this.#load();
      await mkdir(dirname(this.#path), { recursive: true });
      const temporary = `${this.#path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8');
      await rename(temporary, this.#path);
      try {
        this.#loadedMtimeMs = (await stat(this.#path)).mtimeMs;
      } catch {
        this.#loadedMtimeMs = -1;
      }
    });
    this.#writeChain = write.catch(() => undefined);
    return write;
  }

  async saveCollector(collector: CollectorRecord): Promise<void> {
    const snapshot = await this.#load();
    snapshot.collectors[collector.id] = collector;
    await this.#persist();
  }

  async getCollector(id: string): Promise<CollectorRecord | null> {
    return (await this.#load()).collectors[id] ?? null;
  }

  async listCollectors(): Promise<CollectorRecord[]> {
    return Object.values((await this.#load()).collectors);
  }

  async saveContract(contract: CollectorContract): Promise<void> {
    const snapshot = await this.#load();
    snapshot.contracts[contract.collectorId] = contract;
    await this.#persist();
  }

  async getContract(collectorId: string): Promise<CollectorContract | null> {
    return (await this.#load()).contracts[collectorId] ?? null;
  }

  async saveRun(run: RunRecord): Promise<void> {
    const snapshot = await this.#load();
    snapshot.runs.push(run);
    if (snapshot.runs.length > MAX_RUNS) {
      snapshot.runs = snapshot.runs.slice(-MAX_RUNS);
    }
    await this.#persist();
  }

  async listRuns(collectorId: string, limit = 50): Promise<RunRecord[]> {
    const snapshot = await this.#load();
    return snapshot.runs
      .filter((run) => run.collectorId === collectorId)
      .slice(-limit)
      .reverse();
  }

  async saveIncident(incident: IncidentRecord): Promise<void> {
    const snapshot = await this.#load();
    snapshot.incidents[incident.id] = incident;
    await this.#persist();
  }

  async getIncident(id: string): Promise<IncidentRecord | null> {
    return (await this.#load()).incidents[id] ?? null;
  }

  async listIncidents(collectorId?: string): Promise<IncidentRecord[]> {
    const all = Object.values((await this.#load()).incidents);
    const filtered =
      collectorId === undefined ? all : all.filter((i) => i.collectorId === collectorId);
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveVerifiedSnapshot(snapshotRecord: VerifiedSnapshot): Promise<void> {
    const snapshot = await this.#load();
    snapshot.verified[`${snapshotRecord.collectorId}::${snapshotRecord.url}`] = snapshotRecord;
    await this.#persist();
  }

  async getVerifiedSnapshot(collectorId: string, url: string): Promise<VerifiedSnapshot | null> {
    return (await this.#load()).verified[`${collectorId}::${url}`] ?? null;
  }

  async saveJob(job: JobRecord): Promise<void> {
    const snapshot = await this.#load();
    snapshot.jobs[job.id] = job;
    await this.#persist();
  }

  async getJob(id: string): Promise<JobRecord | null> {
    return (await this.#load()).jobs[id] ?? null;
  }

  async listJobs(incidentId?: string): Promise<JobRecord[]> {
    const all = Object.values((await this.#load()).jobs);
    const filtered = incidentId === undefined ? all : all.filter((j) => j.incidentId === incidentId);
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async claimNextJob(workerId: string): Promise<JobRecord | null> {
    const snapshot = await this.#load();
    const queued = Object.values(snapshot.jobs)
      .filter((job) => job.status === 'queued' && job.claimedBy === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const next = queued[0];
    if (next === undefined) return null;

    const claimed: JobRecord = {
      ...next,
      status: 'running',
      claimedBy: workerId,
      startedAt: new Date().toISOString(),
      detail: 'claimed by worker',
    };
    snapshot.jobs[claimed.id] = claimed;
    await this.#persist();
    return claimed;
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    const snapshot = await this.#load();
    // Redacted on the way in. Audit payloads carry raw Bright Data responses,
    // and this file is the one most likely to be opened, shared or committed
    // by accident.
    snapshot.audit.push({ ...event, payload: redact(event.payload) });
    await this.#persist();
  }

  async listAudit(entityId: string): Promise<AuditEvent[]> {
    return (await this.#load()).audit.filter((event) => event.entityId === entityId);
  }
}
