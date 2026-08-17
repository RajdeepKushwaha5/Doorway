import { BrightDataClient } from '../brightdata/index.js';
import { DEFAULT_MONTHLY_BUDGET, monitoringSpend } from './budget.js';
import { attemptRepair, promoteRepair } from '../pipeline/index.js';
import { observeOnce } from '../pipeline/index.js';
import {
  FileStore,
  type CollectorRecord,
  type IncidentRecord,
  type JobRecord,
  type Store,
} from '../store/index.js';

/**
 * The monitoring worker.
 *
 * Runs as its own long-lived process rather than inside an API route. A
 * Self-Healing job took roughly 102 seconds on a real collector and can take
 * considerably longer, which is well past what a serverless function will
 * tolerate, and a run that dies halfway leaves an incident stranded between
 * states.
 */

export interface WorkerConfig {
  store: Store;
  client: BrightDataClient;
  /** How often to look for collectors that are due. */
  tickIntervalMs: number;
  /** Minimum gap between runs of the same collector. */
  minIntervalMs: number;
  /** Ceiling on collectors observed per tick, to bound credit burn. */
  maxPerTick: number;
  /**
   * Monthly page-load ceiling for scheduled monitoring.
   *
   * Both sensors draw from the account's 5,000-a-month free tier, so an
   * aggressive interval spends it without anything visibly going wrong.
   */
  monthlyBudget?: number;
  /** Identifies this worker when claiming jobs. */
  workerId: string;
  /** How a pending candidate is executed. Injected so tests need no network. */
  runCandidate: (collectorId: string, url: string) => Promise<unknown[]>;
  /** Independent witness acquisition, so a deploy needs no CLI. */
  fetchMarkdown?: (
    url: string,
  ) => Promise<{ markdown: string; fetchedAt: string; country?: string }>;
  /** Announces an incident found by the scheduler. */
  notifyIncident?: (incident: IncidentRecord, collectorName: string) => Promise<unknown>;
  log?: (message: string) => void;
}

const lastRunAt = new Map<string, number>();

/**
 * Per-collector lock.
 *
 * Two overlapping runs of the same collector would open duplicate incidents
 * for one fault and could trigger two concurrent repairs on the same
 * collector, which is how a repair races another repair.
 */
const inFlight = new Set<string>();

function isDue(collector: CollectorRecord, minIntervalMs: number): boolean {
  if (collector.status !== 'active') return false;
  if (collector.schedule === null) return false;
  const last = lastRunAt.get(collector.id);
  return last === undefined || Date.now() - last >= minIntervalMs;
}

/**
 * Drain queued repair jobs.
 *
 * This is the half of the worker that makes `POST /heal` able to return
 * immediately. One job per tick, deliberately: a heal takes minutes and
 * running several at once against one account invites rate limiting for no
 * benefit.
 *
 * @returns The job that ran, or null when the queue was empty.
 */
export async function drainJobs(config: WorkerConfig): Promise<JobRecord | null> {
  const log = config.log ?? ((message: string): void => void process.stdout.write(`${message}\n`));
  const job = await config.store.claimNextJob(config.workerId);
  if (job === null) return null;

  const finish = async (patch: Partial<JobRecord>): Promise<JobRecord> => {
    const done: JobRecord = {
      ...job,
      finishedAt: new Date().toISOString(),
      ...patch,
    };
    await config.store.saveJob(done);
    return done;
  };

  try {
    const incident = await config.store.getIncident(job.incidentId);
    const collector = await config.store.getCollector(job.collectorId);
    if (incident === null || collector === null) {
      return finish({ status: 'failed', error: 'incident or collector no longer exists' });
    }

    await config.store.saveJob({
      ...job,
      detail: 'sending the incident to Self-Healing and waiting at the approval gate',
    });

    const outcome = await attemptRepair(collector, incident, {
      client: config.client,
      store: config.store,
      runCandidate: config.runCandidate,
    });

    log(`${new Date().toISOString()} job ${job.id.slice(0, 8)}: ${outcome.kind}`);

    // Close the loop, when the collector's policy allows it.
    //
    // This is the whole difference between a monitor and an automation tool,
    // and it is only defensible because of what has already happened by this
    // point: the candidate was replayed against the page that failed and the
    // pages that were working, and every case passed. promoteRepair then
    // re-verifies production against the full contract afterwards and
    // escalates instead of claiming success when production is still wrong,
    // which is exactly the case Bright Data's own `success: true` missed.
    //
    // Default is `never`. A collector earns automation by being understood,
    // not by being registered.
    if (outcome.kind === 'approved' && collector.autoPromote === 'on_gate_pass') {
      await config.store.saveJob({
        ...job,
        detail: 'gate passed, promoting without waiting for a human',
      });

      try {
        const promoted = await promoteRepair(
          collector,
          outcome.incident,
          { client: config.client, store: config.store, runCandidate: config.runCandidate },
          'system',
        );

        const state = promoted.history.at(-1)?.to;
        const recovered = state === 'resolved';
        log(
          `${new Date().toISOString()} job ${job.id.slice(0, 8)}: auto-promoted, production ${
            recovered ? 'recovered' : 'STILL WRONG'
          }`,
        );

        // A promotion that did not fix production is worth waking someone for.
        // It is the failure mode that looks most like success.
        if (!recovered && config.notifyIncident !== undefined) {
          await config.notifyIncident(promoted, collector.name).catch(() => undefined);
        }

        return finish({
          status: 'succeeded',
          outcome: 'approved',
          detail: recovered
            ? 'repaired, promoted and production re-verified'
            : 'promoted, but production is still wrong and the incident was escalated',
        });
      } catch (caught) {
        // A refused promotion is the guard doing its job, not a failed job.
        const message = caught instanceof Error ? caught.message : String(caught);
        log(`${new Date().toISOString()} job ${job.id.slice(0, 8)}: promotion refused: ${message}`);
        return finish({
          status: 'succeeded',
          outcome: 'approved',
          detail: `candidate passed the gate but promotion was refused: ${message}`,
        });
      }
    }

    return finish({
      status: 'succeeded',
      outcome: outcome.kind,
      detail:
        outcome.kind === 'approved'
          ? 'candidate passed the gate and is waiting for a human to promote it'
          : outcome.kind === 'rejected'
            ? 'candidate was blocked and rejected on Bright Data; production unchanged'
            : 'nothing to repair',
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    log(`${new Date().toISOString()} job ${job.id.slice(0, 8)} failed: ${message}`);
    return finish({ status: 'failed', error: message, detail: 'the repair job did not complete' });
  }
}

/** Observe every due collector once. Returns how many were run. */
export async function tick(config: WorkerConfig): Promise<number> {
  const log = config.log ?? ((message: string): void => void process.stdout.write(`${message}\n`));
  const collectors = await config.store.listCollectors();

  // Stop before the account's free tier is gone, not after. A paused
  // scheduler is recoverable and obvious; a surprise bill is neither.
  const budget = await monitoringSpend(
    config.store,
    config.monthlyBudget ?? DEFAULT_MONTHLY_BUDGET,
  );
  if (budget.exhausted) {
    log(
      `monitoring paused: ${String(budget.spent)} of ${String(budget.budget)} page loads used this month. ` +
        'Raise NOTICE_MONTHLY_PAGE_LOAD_BUDGET, lengthen NOTICE_MIN_INTERVAL_S, or wait for the month to roll.',
    );
    return 0;
  }

  const due = collectors
    .filter((collector) => isDue(collector, config.minIntervalMs))
    .filter((collector) => !inFlight.has(collector.id))
    // Never start more observations than the remaining allowance can pay for.
    .slice(0, Math.min(config.maxPerTick, Math.floor(budget.remaining / 2)));

  let observed = 0;

  for (const collector of due) {
    inFlight.add(collector.id);
    lastRunAt.set(collector.id, Date.now());
    try {
      for (const url of collector.watchUrls) {
        const result = await observeOnce(collector, url, {
          client: config.client,
          store: config.store,
          ...(config.fetchMarkdown === undefined ? {} : { fetchMarkdown: config.fetchMarkdown }),
          ...(config.notifyIncident === undefined ? {} : { notifyIncident: config.notifyIncident }),
        });
        observed += 1;

        if (result.incident !== null) {
          log(
            `${new Date().toISOString()} ${collector.name}: ${result.incident.classification} on ${url} (confidence ${result.incident.confidence.toFixed(2)})`,
          );
        }
      }
    } catch (caught) {
      // One failing collector must not stop the fleet. A target that is down,
      // rate limiting, or newly blocking is an ordinary condition here.
      log(
        `${new Date().toISOString()} ${collector.name}: run failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      inFlight.delete(collector.id);
    }
  }

  return observed;
}

/**
 * Run the observe-and-drain loop until the process exits.
 *
 * Exported so the API can host it when the deployment cannot give the worker
 * its own service with shared storage.
 */
export function startWorkerLoop(config: WorkerConfig): Promise<void> {
  const loop = async (): Promise<void> => {
    for (;;) {
      try {
        // Jobs first: a queued repair is something a person is waiting on.
        await drainJobs(config);
        await tick(config);
      } catch (caught) {
        process.stderr.write(
          `worker tick failed: ${caught instanceof Error ? caught.message : String(caught)}
`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, config.tickIntervalMs));
    }
  };
  return loop();
}

function main(): void {
  const apiKey = process.env['BRIGHTDATA_API_KEY'];
  if (apiKey === undefined || apiKey.trim() === '') {
    process.stderr.write('BRIGHTDATA_API_KEY is not set\n');
    process.exit(1);
  }

  const client = new BrightDataClient({ apiKey });

  const config: WorkerConfig = {
    store: new FileStore(process.env['NOTICE_DATA_FILE']),
    client,
    workerId: `${process.pid}@${process.env['RENDER_INSTANCE_ID'] ?? 'local'}`,
    runCandidate: async (collectorId, url) => {
      // The HTTP API, never the `bdata` CLI. A worker runs on a host with no
      // CLI installed, so shelling out would fail every gate replay.
      const { rows } = await client.runCollector(collectorId, [url], {
        version: 'dev',
        timeoutMs: 600_000,
      });
      return rows;
    },
    tickIntervalMs: Number(process.env['NOTICE_SCHEDULER_INTERVAL_S'] ?? 60) * 1000,
    // Six hours by default. Monitoring is about catching a redesign, which
    // happens on a scale of days, and polling harder mostly burns credits.
    minIntervalMs: Number(process.env['NOTICE_MIN_INTERVAL_S'] ?? 21_600) * 1000,
    maxPerTick: Number(process.env['NOTICE_MAX_PER_TICK'] ?? 5),
    monthlyBudget: Number(
      process.env['NOTICE_MONTHLY_PAGE_LOAD_BUDGET'] ?? DEFAULT_MONTHLY_BUDGET,
    ),
  };

  process.stdout.write(
    `NOTICE worker started. Tick ${config.tickIntervalMs / 1000}s, min interval ${config.minIntervalMs / 1000}s.\n`,
  );

  let stopping = false;
  const loop = async (): Promise<void> => {
    while (!stopping) {
      try {
        // Jobs first. A queued repair is something a human is waiting on,
        // whereas scheduled observation can wait another minute.
        await drainJobs(config);
        await tick(config);
      } catch (caught) {
        process.stderr.write(
          `worker tick failed: ${caught instanceof Error ? caught.message : String(caught)}\n`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, config.tickIntervalMs));
    }
  };

  const shutdown = (signal: string): void => {
    process.stdout.write(`\n${signal} received, finishing current run then exiting\n`);
    stopping = true;
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  void loop();
}

// Only start the loop when executed directly, so `tick` stays importable.
if (process.argv[1]?.includes('worker') === true) main();
