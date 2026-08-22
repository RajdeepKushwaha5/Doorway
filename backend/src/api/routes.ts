import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BrightDataClient } from '../brightdata/index.js';
import { learnContract, type BaselineRun } from '../contracts/index.js';
import { invariantSchema } from '../contracts/index.js';
import { buildCertificate } from '../incident/certificate.js';
import { ObservationBroker, type ObserveEvent } from '../pipeline/events.js';
import {
  attemptRepair,
  buildFeed,
  compareBestDeal,
  computeImpact,
  observeOnce,
  promoteRepair,
} from '../pipeline/index.js';
import type {
  CollectorRecord,
  IncidentRecord,
  JobRecord,
  ScreenshotStore,
  Store,
} from '../store/index.js';
import { currentState, transition } from '../incident/index.js';
import { witnessFieldSpecSchema } from '../witness/index.js';
import { assertAdmin, binary, HttpError, Router, stream } from './http.js';
import { DEFAULT_MONTHLY_BUDGET, monitoringSpend } from '../worker/budget.js';
import { buildWorld, opportunitiesFromSnapshots, profileSchema } from '../doorway/index.js';

/**
 * Ceiling on a candidate replay.
 *
 * Matches the observation path in observe.ts. A gate run triggers the same
 * collector against the same page, so it has no reason to be quicker, and a
 * shorter limit would fail the repair for being slow rather than wrong.
 */
const CANDIDATE_RUN_TIMEOUT_MS = 600_000;

export const registerCollectorSchema = z.object({
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
  /** Default is never: a new collector asks before changing production. */
  autoPromote: z.enum(['never', 'on_gate_pass']).default('never'),
  /** Minutes a verified value stays verified. Null takes the 24h default. */
  freshnessMinutes: z.number().int().positive().nullable().default(null),
  /**
   * ISO 4217 code this source prices in. Declared, never guessed from `$`.
   * Uppercased so `usd` and `USD` register the same collector.
   */
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((code) => code.toUpperCase())
    .nullable()
    .default(null),
});

export interface ApiDeps {
  store: Store;
  client: BrightDataClient;
  /** Injected so a test can watch a stream without a socket. */
  broker?: ObservationBroker;
  /** Reads rendered page captures. Absent means the feature is simply off. */
  screenshots?: ScreenshotStore;
  /** Captures a page and returns its id. Absent means no capture is attempted. */
  captureScreenshot?: (url: string) => Promise<string>;
  /** Announces an incident. Absent means notification is off. */
  notifyIncident?: (incident: IncidentRecord, collectorName: string) => Promise<unknown>;
  /** Independent witness acquisition. Injected so deploys need no CLI. */
  fetchMarkdown?: (url: string) => Promise<{ markdown: string; fetchedAt: string }>;
}

/** Build the HTTP surface. */
export function buildRouter(deps: ApiDeps): Router {
  const router = new Router();
  // One per server. Holds only recent observations, and only in memory: the
  // durable record of any of this is the run and the incident in the store.
  const broker = deps.broker ?? new ObservationBroker();
  const { store, client } = deps;
  const witnessDeps = {
    ...(deps.fetchMarkdown === undefined ? {} : { fetchMarkdown: deps.fetchMarkdown }),
    ...(deps.captureScreenshot === undefined ? {} : { captureScreenshot: deps.captureScreenshot }),
    ...(deps.notifyIncident === undefined ? {} : { notifyIncident: deps.notifyIncident }),
  };

  /**
   * An index, because people paste the bare host into a browser.
   *
   * Every endpoint lives under `/api/`, so the router answered `/` with a 404.
   * That is literally correct and reads as a broken service to anyone who
   * trimmed the URL, which is exactly what a reviewer following a link in the
   * README is likely to do. Answering with what this is and where to look
   * costs nothing and removes the wrong first impression.
   *
   * Read-only routes only. The mutating ones need a bearer token and listing
   * them here would invite attempts that can only end in 401.
   */
  router.get('/', async () => ({
    service: 'Doorway',
    what: 'Builds a verified opportunity world from Bright Data Scraper Studio collectors, with an independent Trust Engine that catches silent extraction drift.',
    status: 'ok',
    at: new Date().toISOString(),
    dashboard: 'https://notice-frontend-bay.vercel.app',
    fixture: 'https://driftmart-3ut8.onrender.com',
    repository: 'https://github.com/RajdeepKushwaha5/Doorway',
    read: {
      health: '/api/health',
      collectors: '/api/collectors',
      incidents: '/api/incidents',
      impact: '/api/stats/impact',
      budget: '/api/budget',
      verifiedFeed: '/api/feed/{collectorId}',
      opportunities: '/api/doorway/opportunities',
      opportunityWorld: 'POST /api/doorway/world',
      certificate: '/api/incidents/{id}/certificate',
    },
    note: 'Writes require a bearer token and are not listed. Verdicts are exportable as certificates you can re-derive offline.',
  }));

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
    if (!parsed.success) {
      // Name the field. "Required" on its own tells a caller nothing about
      // which of a dozen fields they left out.
      const issue = parsed.error.issues[0];
      const where = issue?.path.join('.') ?? '';
      throw new HttpError(
        400,
        issue === undefined
          ? 'invalid body'
          : where === ''
            ? issue.message
            : `${where}: ${issue.message}`,
      );
    }

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

  /**
   * Correct a registered collector in place.
   *
   * Registration was a one-way door: a witness spec that turned out to be wrong
   * could only be fixed by resetting the store. That is a bad property for the
   * one field most likely to need correcting, because a loose `labels` entry
   * produces a *confident wrong verdict* rather than an obvious error.
   *
   * This was written after exactly that happened here. A spec used "result" as
   * a label against a page whose results header reads "1 result", so the
   * witness matched the count line, disagreed with the collector, and reported
   * drift on a page where nothing was wrong.
   *
   * Deliberately narrow. `brightDataCollectorId` cannot be changed, because the
   * incidents, runs and verified snapshots already recorded against it are only
   * meaningful for the collector that produced them.
   */
  router.put('/api/collectors/:id', async ({ params, body, request }) => {
    assertAdmin(request);
    const collector = await requireCollector(store, params['id']);

    const parsed = registerCollectorSchema
      .partial()
      .omit({ brightDataCollectorId: true })
      .safeParse(body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? 'invalid body');
    }

    // Undefined means "leave alone", so a caller correcting one spec does not
    // have to resend the whole record and risk flattening the rest of it.
    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    );

    const updated: CollectorRecord = { ...collector, ...patch };
    await store.saveCollector(updated);
    return updated;
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
   * Start an observation and return immediately with somewhere to watch it.
   *
   * The existing `/run` route stays exactly as it was, because the CLI, the
   * worker and the MCP server all want the finished result and nothing else.
   * This one is for a person: it hands back an id and gets out of the way, so
   * the thirty seconds a real Scraper Studio run takes can be watched instead
   * of waited out.
   *
   * Failures are delivered on the stream rather than thrown. By the time
   * anything can go wrong the HTTP response is long gone, and a viewer who
   * sees the log stop dead learns nothing about why.
   */
  router.post('/api/collectors/:id/observe', async ({ params, body, request }) => {
    assertAdmin(request);
    const collector = await requireCollector(store, params['id']);
    const url =
      typeof (body as { url?: unknown } | null)?.url === 'string'
        ? (body as { url: string }).url
        : collector.watchUrls[0];
    if (url === undefined) throw new HttpError(400, 'no URL to run against');

    const observationId = broker.start(collector.id, url);

    void observeOnce(collector, url, {
      client,
      store,
      ...witnessDeps,
      onEvent: broker.emitterFor(observationId),
    })
      .catch((error: unknown) => {
        broker.emitterFor(observationId)({
          step: 'error',
          line: `failed          ${error instanceof Error ? error.message : String(error)}`,
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
      })
      .finally(() => {
        broker.finish(observationId);
      });

    return { observationId, collectorId: collector.id, url };
  });

  /**
   * Watch an observation as it reasons.
   *
   * Unauthenticated, and that is deliberate rather than an oversight. An
   * `EventSource` cannot send headers, so a token here would have to travel in
   * the query string and end up in logs and screen recordings. Everything on
   * this stream is already public on the incident page a moment later, and
   * starting an observation, which is the part that spends money, still
   * requires the admin token on the route above.
   */
  router.get('/api/observations/:id/events', async ({ params }) => {
    const id = params['id'] ?? '';
    if (!broker.has(id)) throw new HttpError(404, 'no such observation');

    return stream((response, request) => {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Render and most proxies buffer responses by default, which would
        // hold every line back until the run finished and defeat the point.
        'x-accel-buffering': 'no',
        'access-control-allow-origin': process.env['NOTICE_CORS_ORIGIN'] ?? '*',
      });

      const send = (event: ObserveEvent | null): void => {
        if (event === null) {
          response.write('event: done\ndata: {}\n\n');
          response.end();
          return;
        }
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // A comment line immediately, so a proxy that waits for first output
      // flushes its headers and the browser reports the stream as open.
      response.write(': open\n\n');

      const unsubscribe = broker.subscribe(id, send);
      request.on('close', unsubscribe);
    });
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

    // Version off the contract already stored, not the default of 1.
    //
    // Every acceptance produced "v1", so a second baseline was indistinguishable
    // from the first and a verified snapshot's `contractVersion` could not say
    // which profile actually verified it. The number is displayed and recorded,
    // so it has to move when the thing it describes moves.
    const existing = await store.getContract(collector.id);
    const version = existing === null ? 1 : existing.version + 1;

    const contract = learnContract(collector.id, accepted, collector.invariants, version);
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
    // The run carries the rows the collector actually returned when it broke.
    // Without it the incident page can show what a repair produces and what
    // the page says, but not what was wrong in the first place, which is the
    // half a reader is there for.
    const [audit, run] = await Promise.all([
      store.listAudit(incident.id),
      store.getRun(incident.runId),
    ]);
    return { incident, audit, run };
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

    // Check first, then call. Rejecting used to hit Bright Data before asking
    // whether there was anything to reject, so declining an incident with no
    // pending candidate produced a 404 from their API and surfaced here as a
    // 500. That reads as "we broke" when the truth is "you asked for something
    // that does not apply", and it is the same class of mistake `approve`
    // already guards against one route below.
    const state = currentState(incident.history);
    if (state !== 'awaiting_approval' && state !== 'verifying_candidate') {
      throw new HttpError(
        409,
        `incident is in state "${state}", not "awaiting_approval"; there is no proposed repair to reject`,
      );
    }

    await client.rejectRepair(collector.brightDataCollectorId);

    const history = [
      ...incident.history,
      transition(state, 'repair_rejected', {
        actor: 'user',
        reason: 'rejected by a human reviewer',
      }),
    ];

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
  /**
   * Export an incident as a certificate anyone can re-check offline.
   *
   * Unauthenticated on purpose. A proof only its author can fetch is not a
   * proof, and every value in the document is already on the public incident
   * page; the digest adds the ability to detect editing, not secrecy.
   */
  router.get('/api/incidents/:id/certificate', async ({ params }) => {
    const incident = await store.getIncident(params['id'] ?? '');
    if (incident === null) throw new HttpError(404, 'incident not found');
    const collector = await store.getCollector(incident.collectorId);
    if (collector === null) throw new HttpError(404, 'collector not found');
    return buildCertificate(incident, collector);
  });

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

  /**
   * This month's monitoring spend against the account's free tier.
   *
   * Surfaced because the constraint is invisible otherwise. Both sensors draw
   * from the same 5,000-a-month pool, so an operator tightening an interval
   * has no way to see what it costs until the scheduler pauses or a bill
   * arrives, and neither is a good first notification.
   */
  /**
   * What this system prevented, rather than what it did.
   *
   * Read-only and unauthenticated like the rest of the reporting surface. The
   * counts come straight from stored runs and incidents, so anyone doubting
   * the headline can recompute it from `/api/incidents` by hand.
   */
  router.get('/api/stats/impact', async () => {
    const collectors = await store.listCollectors();
    const runs = (
      await Promise.all(collectors.map(async (collector) => store.listRuns(collector.id, 500)))
    ).flat();
    const incidents = await store.listIncidents();
    return computeImpact(runs, incidents);
  });

  router.get('/api/budget', async () =>
    monitoringSpend(
      store,
      Number(process.env['NOTICE_MONTHLY_PAGE_LOAD_BUDGET'] ?? DEFAULT_MONTHLY_BUDGET),
    ),
  );

  /**
   * Doorway's public catalog is a projection of verified collector snapshots.
   * It never reads raw runs, so a quarantined value cannot accidentally enter
   * the student-facing world through a second code path.
   */
  router.get('/api/doorway/opportunities', async () => {
    const [collectors, snapshots, incidents] = await Promise.all([
      store.listCollectors(),
      store.listVerifiedSnapshots(),
      store.listIncidents(),
    ]);
    const opportunities = opportunitiesFromSnapshots(snapshots, collectors, incidents);
    return {
      opportunities,
      generatedAt: new Date().toISOString(),
      sources: new Set(opportunities.map((opportunity) => opportunity.collectorId)).size,
    };
  });

  router.get('/api/doorway/opportunities/:id', async ({ params }) => {
    const [collectors, snapshots, incidents] = await Promise.all([
      store.listCollectors(),
      store.listVerifiedSnapshots(),
      store.listIncidents(),
    ]);
    const opportunity = opportunitiesFromSnapshots(snapshots, collectors, incidents).find(
      (candidate) => candidate.id === params['id'],
    );
    if (opportunity === undefined) throw new HttpError(404, 'opportunity not found');
    return opportunity;
  });

  router.post('/api/doorway/world', async ({ body }) => {
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(400, issue?.message ?? 'invalid student profile');
    }
    const [collectors, snapshots, incidents] = await Promise.all([
      store.listCollectors(),
      store.listVerifiedSnapshots(),
      store.listIncidents(),
    ]);
    const opportunities = opportunitiesFromSnapshots(snapshots, collectors, incidents);
    return buildWorld(parsed.data, opportunities);
  });

  router.get('/api/consumer/best-deal', async () => compareBestDeal(store));

  /** What a downstream consumer sees, including quarantine and staleness. */
  router.get('/api/feed/:collectorId', async ({ params, query }) => {
    const collector = await requireCollector(store, params['collectorId']);
    const url = query.get('url') ?? collector.watchUrls[0];
    if (url === undefined) throw new HttpError(400, 'no URL specified');
    // Freshness is a property of the source, so the collector's own policy
    // decides when a verified value has aged out.
    return {
      collectorId: collector.id,
      url,
      ...(await buildFeed(store, collector.id, url, {
        ...(collector.freshnessMinutes === null
          ? {}
          : { maxAgeMs: collector.freshnessMinutes * 60_000 }),
      })),
    };
  });

  return router;
}

async function requireCollector(store: Store, id: string | undefined): Promise<CollectorRecord> {
  if (id === undefined) throw new HttpError(400, 'collector id required');
  const collector = await store.getCollector(id);
  if (collector === null) throw new HttpError(404, 'collector not found');
  return collector;
}
