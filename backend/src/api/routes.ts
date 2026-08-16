import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BrightDataClient } from '../brightdata/index.js';
import { learnContract, type BaselineRun } from '../contracts/index.js';
import { invariantSchema } from '../contracts/index.js';
import {
  attemptRepair,
  buildFeed,
  compareBestDeal,
  observeOnce,
  promoteRepair,
} from '../pipeline/index.js';
import type { CollectorRecord, JobRecord, ScreenshotStore, Store } from '../store/index.js';
import { currentState, transition } from '../incident/index.js';
import { witnessFieldSpecSchema } from '../witness/index.js';
import { assertAdmin, binary, HttpError, Router } from './http.js';

/**
 * Ceiling on a candidate replay.
 *
 * Matches the observation path in observe.ts. A gate run triggers the same
 * collector against the same page, so it has no reason to be quicker, and a
 * shorter limit would fail the repair for being slow rather than wrong.
 */
const CANDIDATE_RUN_TIMEOUT_MS = 600_000;

const registerCollectorSchema = z.object({
  brightDataCollectorId: z.string().regex(/^c_[a-z0-9]+$/i, 'expected a c_... collector id'),
  name: z.string().min(1),
  targetDomain: z.string().min(1),
  watchUrls: z.array(z.string().url()).min(1),
  witnessSpecs: z.array(witnessFieldSpecSchema).min(1),
  invariants: z.array(invariantSchema).default([]),
  protectedFields: z.array(z.string()).default([]),
  goldenCases: z
    .array(z.object({ url: z.string().url(), expected: z.record(z.unknown()), label: z.string() }))
    .default([]),
  schedule: z.string().nullable().default(null),
});

export interface ApiDeps {
  store: Store;
  client: BrightDataClient;
  /** Reads rendered page captures. Absent means the feature is simply off. */
  screenshots?: ScreenshotStore;
  /** Captures a page and returns its id. Absent means no capture is attempted. */
  captureScreenshot?: (url: string) => Promise<string>;
  /** Independent witness acquisition. Injected so deploys need no CLI. */
  fetchMarkdown?: (url: string) => Promise<{ markdown: string; fetchedAt: string }>;
}

/** Build the HTTP surface. */
export function buildRouter(deps: ApiDeps): Router {
  const router = new Router();
  const { store, client } = deps;
  const witnessDeps = {
    ...(deps.fetchMarkdown === undefined ? {} : { fetchMarkdown: deps.fetchMarkdown }),
    ...(deps.captureScreenshot === undefined ? {} : { captureScreenshot: deps.captureScreenshot }),
  };

  router.get('/api/health', async () => ({ status: 'ok', at: new Date().toISOString() }));

  router.get('/api/collectors', async () => {
    const collectors = await store.listCollectors();
    return Promise.all(
      collectors.map(async (collector) => {
        const incidents = await store.listIncidents(collector.id);
        const open = incidents.filter((incident) => incident.resolvedAt === null && incident.quarantined);
        const contract = await store.getContract(collector.id);
        return {
          ...collector,
          openIncidents: open.length,
          contractVersion: contract?.version ?? null,
          contractConfidence: contract?.confidence ?? 0,
          baselineRuns: contract?.sampleCount ?? 0,
        };
      }),
    );
  });

  router.post('/api/collectors', async ({ body, request }) => {
    assertAdmin(request);
    const parsed = registerCollectorSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'invalid body');

    const collector: CollectorRecord = {
      id: randomUUID(),
      ...parsed.data,
      status: 'active',
      acquisitionContext: {},
      createdAt: new Date().toISOString(),
    };
    await store.saveCollector(collector);
    return collector;
  });

  router.get('/api/collectors/:id', async ({ params }) => {
    const collector = await requireCollector(store, params['id']);
    const [contract, runs, incidents] = await Promise.all([
      store.getContract(collector.id),
      store.listRuns(collector.id, 25),
      store.listIncidents(collector.id),
    ]);
    return { collector, contract, runs, incidents };
  });

  router.post('/api/collectors/:id/run', async ({ params, body, request }) => {
    assertAdmin(request);
    const collector = await requireCollector(store, params['id']);
    const url =
      typeof (body as { url?: unknown } | null)?.url === 'string'
        ? (body as { url: string }).url
        : collector.watchUrls[0];
    if (url === undefined) throw new HttpError(400, 'no URL to run against');

    return observeOnce(collector, url, { client, store, ...witnessDeps });
  });

  /**
   * Learn or relearn a baseline from runs the caller explicitly accepts.
   *
   * The caller must name the run ids. Learning from "whatever passed the
   * automated checks" would be circular: the checks are derived from the
   * baseline, so a slow corruption that never trips a hard invariant would be
   * absorbed into the profile and the detector would go quiet on it.
   *
   * Body: { "runIds": ["..."] }
   * Pass `?preview=1` to see which runs are eligible without committing.
   */
  router.post('/api/collectors/:id/baseline', async ({ params, body, query, request }) => {
    assertAdmin(request);
    const collector = await requireCollector(store, params['id']);
    const runs = await store.listRuns(collector.id, 100);

    if (query.get('preview') === '1') {
      return runs.map((run) => ({
        runId: run.id,
        observedAt: run.observedAt,
        rowCount: run.rows.length,
        hardFailures: run.checks.filter((check) => check.status === 'fail').length,
        warnings: run.checks.filter((check) => check.status === 'warn').length,
        sample: run.rows[0] ?? null,
      }));
    }

    const requested = (body as { runIds?: unknown } | null)?.runIds;
    if (!Array.isArray(requested) || requested.length === 0) {
      throw new HttpError(
        400,
        'body must be {"runIds": [...]}. Call ?preview=1 first to see eligible runs and their sample output.',
      );
    }

    const selected = runs.filter((run) => requested.includes(run.id));
    if (selected.length !== requested.length) {
      throw new HttpError(404, 'one or more run ids were not found for this collector');
    }

    // A run with a hard failure is never acceptable baseline material, even if
    // a human asks for it. That is not a judgement call.
    const broken = selected.find((run) => run.checks.some((check) => check.status === 'fail'));
    if (broken !== undefined) {
      throw new HttpError(409, `run ${broken.id} has a hard invariant failure and cannot be a baseline`);
    }

    const accepted: BaselineRun[] = selected.map((run) => ({
      rows: run.rows,
      observedAt: run.observedAt,
    }));

    const contract = learnContract(collector.id, accepted, collector.invariants);
    await store.saveContract(contract);
    return contract;
  });

  router.get('/api/incidents', async ({ query }) => {
    const collectorId = query.get('collectorId') ?? undefined;
    return store.listIncidents(collectorId);
  });

  router.get('/api/incidents/:id', async ({ params }) => {
    const incident = await store.getIncident(params['id'] ?? '');
    if (incident === null) throw new HttpError(404, 'incident not found');
    const audit = await store.listAudit(incident.id);
    return { incident, audit };
  });

  /**
   * Queue an evidence-backed repair.
   *
   * Returns immediately with a job id. The work itself belongs to the worker:
   * a heal polls Bright Data for up to fifteen minutes, and holding an HTTP
   * request open for that long means a browser tab, a proxy timeout or a
   * deploy can abandon a repair that is already in flight on their side.
   *
   * Poll `GET /api/jobs/:id` for progress.
   */
  router.post('/api/incidents/:id/heal', async ({ params, request }) => {
    assertAdmin(request);
    const incident = await store.getIncident(params['id'] ?? '');
    if (incident === null) throw new HttpError(404, 'incident not found');

    if (incident.classification !== 'extractor_drift' && incident.classification !== 'explicit_failure') {
      throw new HttpError(
        409,
        `classification "${incident.classification}" must not be repaired; the collector is working`,
      );
    }

    // Refuse a second job for the same incident while one is live. Two
    // concurrent heals on one collector race each other at Bright Data's gate.
    const existing = await store.listJobs(incident.id);
    const live = existing.find((job) => job.status === 'queued' || job.status === 'running');
    if (live !== undefined) {
      throw new HttpError(409, `a repair job is already ${live.status} for this incident: ${live.id}`);
    }

    const job: JobRecord = {
      id: randomUUID(),
      kind: 'heal',
      incidentId: incident.id,
      collectorId: incident.collectorId,
      status: 'queued',
      detail: 'queued, waiting for a worker',
      outcome: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      claimedBy: null,
    };
    await store.saveJob(job);
    return { accepted: true, job };
  });

  /** Progress of a queued or running job. */
  router.get('/api/jobs/:id', async ({ params }) => {
    const job = await store.getJob(params['id'] ?? '');
    if (job === null) throw new HttpError(404, 'job not found');
    return job;
  });

  router.get('/api/jobs', async ({ query }) => {
    return store.listJobs(query.get('incidentId') ?? undefined);
  });

  /**
   * Reject a proposed repair explicitly.
   *
   * Bright Data's gate stays open until answered, so an unanswered candidate
   * blocks every later heal on that collector. This is how a human clears one.
   */
  router.post('/api/incidents/:id/reject', async ({ params, request }) => {
    assertAdmin(request);
    const incident = await store.getIncident(params['id'] ?? '');
    if (incident === null) throw new HttpError(404, 'incident not found');
    const collector = await requireCollector(store, incident.collectorId);

    await client.rejectRepair(collector.brightDataCollectorId);

    const state = currentState(incident.history);
    const history =
      state === 'awaiting_approval' || state === 'verifying_candidate'
        ? [
            ...incident.history,
            transition(state, 'repair_rejected', {
              actor: 'user',
              reason: 'rejected by a human reviewer',
            }),
          ]
        : incident.history;

    const updated = { ...incident, history };
    await store.saveIncident(updated);
    return updated;
  });

  /**
   * Retry witness acquisition for an inconclusive incident.
   *
   * A witness fetch can fail for ordinary reasons: the target was blocking,
   * the request timed out, the zone was misconfigured. Re-observing is the
   * cheapest way to turn an inconclusive back into a decision.
   */
  router.post('/api/incidents/:id/retry-witness', async ({ params, request }) => {
    assertAdmin(request);
    const incident = await store.getIncident(params['id'] ?? '');
    if (incident === null) throw new HttpError(404, 'incident not found');
    const collector = await requireCollector(store, incident.collectorId);

    const url = incident.witness?.url ?? collector.watchUrls[0];
    if (url === undefined) throw new HttpError(400, 'no URL recorded for this incident');

    return observeOnce(collector, url, { client, store, ...witnessDeps });
  });

  /**
   * Promote a repair.
   *
   * The state machine refuses any incident that has not reached
   * `awaiting_approval`, so an unverified candidate cannot be promoted even by
   * calling this endpoint directly.
   */
  router.post('/api/incidents/:id/approve', async ({ params, request }) => {
    assertAdmin(request);
    const incident = await store.getIncident(params['id'] ?? '');
    if (incident === null) throw new HttpError(404, 'incident not found');
    const collector = await requireCollector(store, incident.collectorId);

    try {
      return await promoteRepair(
        collector,
        incident,
        {
          client,
          store,
          runCandidate: async (collectorId, url) => {
            // The HTTP API, not the `bdata` CLI. A deployed host has no CLI
            // binary, so shelling out here made the gate unreachable in
            // production while working perfectly on a laptop.
            const { rows } = await client.runCollector(collectorId, [url], {
              version: 'dev',
              timeoutMs: CANDIDATE_RUN_TIMEOUT_MS,
            });
            return rows;
          },
        },
        'user',
      );
    } catch (caught) {
      throw new HttpError(
        409,
        caught instanceof Error ? caught.message : 'repair is not eligible for promotion',
      );
    }
  });

  /**
   * The downstream consumer, run twice over the same data.
   *
   * Once on the raw latest rows the way an ordinary pipeline would, and once
   * on the verified feed. When the two disagree, the difference is the whole
   * point of the project expressed as a decision rather than a status.
   */
  /**
   * The rendered page as it looked when the incident opened.
   *
   * Unauthenticated on purpose. It is an image of a page the collector was
   * already fetching publicly, it carries no account data, and requiring a
   * bearer token would mean the dashboard could not put it in an `img` tag
   * without proxying it. The id is a random uuid, so it cannot be guessed or
   * enumerated from an incident id.
   */
  router.get('/api/incidents/:id/screenshot', async ({ params }) => {
    const incident = await store.getIncident(params['id'] ?? '');
    if (incident === null) throw new HttpError(404, 'incident not found');
    if (incident.screenshotId === null) {
      throw new HttpError(404, 'no capture was recorded for this incident');
    }

    const png = await deps.screenshots?.read(incident.screenshotId) ?? null;
    if (png === null) {
      // Expected on a host without a persistent disk: the record outlives the
      // file after a redeploy. Say so plainly rather than returning a broken
      // image, which reads as a bug in the dashboard.
      throw new HttpError(410, 'the capture is no longer stored on this instance');
    }

    // Immutable: a capture is a fact about a moment, and its id never points
    // at different bytes.
    return binary('image/png', png, 'public, max-age=31536000, immutable');
  });

  router.get('/api/consumer/best-deal', async () => compareBestDeal(store));

  /** What a downstream consumer sees, including quarantine and staleness. */
  router.get('/api/feed/:collectorId', async ({ params, query }) => {
    const collector = await requireCollector(store, params['collectorId']);
    const url = query.get('url') ?? collector.watchUrls[0];
    if (url === undefined) throw new HttpError(400, 'no URL specified');
    return { collectorId: collector.id, url, ...(await buildFeed(store, collector.id, url)) };
  });

  return router;
}

async function requireCollector(store: Store, id: string | undefined): Promise<CollectorRecord> {
  if (id === undefined) throw new HttpError(400, 'collector id required');
  const collector = await store.getCollector(id);
  if (collector === null) throw new HttpError(404, 'collector not found');
  return collector;
}
