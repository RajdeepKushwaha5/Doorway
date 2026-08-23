import { BrightDataBalanceError } from '../brightdata/index.js';
import { randomUUID } from 'node:crypto';
import { checkWatchUrls } from '../acquire/robots.js';
import { z } from 'zod';
import type { BrightDataClient } from '../brightdata/index.js';
import { learnContract, type BaselineRun } from '../contracts/index.js';
import { invariantSchema } from '../contracts/index.js';
import { buildCertificate } from '../incident/certificate.js';
import { ObservationBroker, type ObserveEvent } from '../pipeline/events.js';
import {
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
import { collectorProvenanceSchema } from '../store/index.js';
import { assertAdmin, binary, HttpError, Router, stream } from './http.js';
import { DEFAULT_MONTHLY_BUDGET, monitoringSpend } from '../worker/budget.js';
import {
  buildMission,
  buildWorld,
  draftToOpportunity,
  isPublishableDraft,
  opportunitiesFromSnapshots,
  profileSchema,
  type DoorwayWorld,
} from '../doorway/index.js';
import { discover, type OpportunityDraft } from '../acquire/index.js';
import { composeBrief } from '../acquire/compose.js';
import { manufactureCollector } from '../pipeline/manufacture.js';
import { DiscoveryBudget } from '../acquire/budget.js';
import { crawl } from '../crawl/crawler.js';
import { OpportunityIndex } from '../crawl/index-store.js';

/**
 * Ceiling on a candidate replay.
 *
 * Matches the observation path in observe.ts. A gate run triggers the same
 * collector against the same page, so it has no reason to be quicker, and a
 * shorter limit would fail the repair for being slow rather than wrong.
 */
const CANDIDATE_RUN_TIMEOUT_MS = 600_000;

const collectorFieldsSchema = z
  .object({
  brightDataCollectorId: z.string().regex(/^c_[a-z0-9]+$/i, 'expected a c_... collector id'),
  name: z.string().min(1),
  targetDomain: z.string().min(1),
  watchUrls: z.array(z.string().url()).min(1),
  witnessSpecs: z.array(witnessFieldSpecSchema).min(1),
  invariants: z.array(invariantSchema).default([]),
  protectedFields: z.array(z.string()).default([]),
  /**
   * How this collector came to exist.
   *
   * Optional, because a collector can be registered by hand and because the
   * ones already running predate it. What is not optional is honesty about
   * the difference: a collector with no provenance is shown as having none.
   */
  provenance: collectorProvenanceSchema.optional(),
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

/**
 * Fields nobody but a single sensor would read.
 *
 * Returned rather than thrown so both the register and the update route can
 * ask the same question, the second about the record it is about to save
 * rather than about the patch it received.
 */
export function unwitnessedProtectedFields(collector: {
  witnessSpecs: readonly { path: string }[];
  protectedFields: readonly string[];
}): string[] {
  const witnessed = new Set(collector.witnessSpecs.map((spec) => spec.path));
  return collector.protectedFields.filter((field) => !witnessed.has(field));
}

export const registerCollectorSchema = collectorFieldsSchema.superRefine((collector, ctx) => {
    /*
     * A protected field must be witnessed by somebody.
     *
     * These two lists were declared independently and never checked against
     * each other, and the gap was invisible because both were populated and
     * neither was wrong on its own. The fixture protected `application_url`
     * and gave it a required invariant, but left it out of the witness specs,
     * so no second sensor ever looked at it. `reconcile` iterates the specs,
     * which meant the field nobody could compare was the field whose loss
     * makes a listing useless: the collector kept reporting an application URL
     * for a page that had stopped offering one, every witnessed field agreed,
     * and the run came back healthy.
     *
     * Protecting a field is a statement that publishing it wrong does harm.
     * A field that matters that much cannot be one only a single sensor reads.
     */
  for (const field of unwitnessedProtectedFields(collector)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['protectedFields'],
      message:
        `"${field}" is protected but has no witness spec, so only one sensor would ever read it. ` +
        'Add a witnessSpecs entry for it, or stop protecting it.',
    });
  }
});

/**
 * A world, plus how it was arrived at.
 *
 * The extra fields let the page account for a short list: whether the live
 * search ran, how many pages it opened, and why it did not when it did not.
 */
interface FoundWorld extends DoorwayWorld {
  live: boolean;
  searched: number;
  liveMessage?: string;
}

/**
 * Crawl steps, said in the vocabulary the console already speaks.
 *
 * The stream is shared with observations and discovery, so a crawl reuses those
 * names rather than adding a third set for a viewer to learn.
 */
const CRAWL_STEPS: Record<string, 'searching' | 'searched' | 'reading' | 'read' | 'done' | 'error'> = {
  seeding: 'searching',
  seeded: 'searched',
  fetching: 'reading',
  progress: 'read',
  kept: 'read',
  harvested: 'read',
  dropped: 'read',
  done: 'done',
  error: 'error',
};

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
  /**
   * Credentials for searching the live web.
   *
   * Absent means discovery is off and the route says so, rather than failing
   * at the moment a student presses the button.
   */
  discovery?: { apiKey: string; zone: string; country?: string };
  /**
   * Reads a robots.txt, or resolves null when it cannot be read.
   *
   * Injected so registration can be tested without a network, and so a
   * deployment can decide its own timeout. Absent means the default fetcher.
   */
  fetchRobots?: (robotsUrl: string) => Promise<string | null>;
}

/**
 * Read a robots.txt over HTTP, briefly.
 *
 * Every failure resolves to null rather than throwing. A registration must not
 * fall over because a host was slow, and "could not read it" is a different
 * answer from "it said no": the first permits, the second refuses.
 */
async function defaultFetchRobots(robotsUrl: string): Promise<string | null> {
  try {
    const response = await fetch(robotsUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(5_000),
      headers: { accept: 'text/plain' },
    });
    // A 404 is the common case and means no rules, not a failure.
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** Build the HTTP surface. */
export function buildRouter(deps: ApiDeps): Router {
  const router = new Router();
  // One per server. Holds only recent observations, and only in memory: the
  // durable record of any of this is the run and the incident in the store.
  const broker = deps.broker ?? new ObservationBroker();
  // Public and paid, so capped. See DiscoveryBudget for why the global ceiling
  // is the limit that actually matters.
  const budget = new DiscoveryBudget();
  // Finished discoveries, so a client that missed the stream can still read
  // what was found. Bounded, and never the durable record of anything.
  const discoveries = new Map<string, OpportunityDraft[]>();
  // Finished searches, so a client that missed the stream still gets an answer.
  const finds = new Map<string, FoundWorld>();
  /*
   * What every crawl has ever found, kept between requests.
   *
   * This is what turns a crawl from a very expensive way to answer one question
   * into the thing the product is made of. A student's search reads this rather
   * than the live web, so it returns in milliseconds across everything every
   * previous crawl reached.
   */
  const index = new OpportunityIndex(process.env['DOORWAY_INDEX_FILE']);
  const crawls = new Map<string, Record<string, unknown>>();
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
    dashboard: 'https://doorway-frontend-snowy.vercel.app',
    fixture: 'https://doorway-lab.onrender.com',
    repository: 'https://github.com/RajdeepKushwaha5/Doorway',
    /*
     * What is actually running here.
     *
     * Twice in one day a fix was reported as live when the host was serving an
     * older build, and the only way to tell was to probe for a behaviour the
     * new code has. A deployment that cannot say which commit it is has to be
     * interrogated instead of asked.
     *
     * Render sets RENDER_GIT_COMMIT on every deploy. Absent locally, where the
     * honest answer is that this is a working tree rather than a build.
     */
    build: process.env['RENDER_GIT_COMMIT']?.slice(0, 7) ?? 'local working tree',
    read: {
      health: '/api/health',
      collectors: '/api/collectors',
      incidents: '/api/incidents',
      impact: '/api/stats/impact',
      budget: '/api/budget',
      verifiedFeed: '/api/feed/{collectorId}',
      opportunities: '/api/doorway/opportunities',
      mission: '/api/doorway/opportunities/{id}/mission?held=Resume,Transcript',
      opportunityWorld: 'POST /api/doorway/world',
      find: 'POST /api/doorway/find',
      manufacture: 'POST /api/collectors/manufacture',
      crawl: 'POST /api/crawl',
      index: '/api/crawl',
      discover: 'POST /api/doorway/discover',
      discovery: '/api/doorway/discoveries/{id}',
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

    /*
     * Ask the site before agreeing to read it on a schedule.
     *
     * A collector is a standing instruction, so the moment to find out that a
     * path is disallowed is now, not after it has run and its output is in a
     * feed. One site was rejected by hand on these grounds during development,
     * and doing it by hand is how it gets skipped when somebody is in a hurry.
     *
     * Refusal quotes the directive, because a caller who disagrees should be
     * able to go and read the same line rather than take this on trust.
     */
    const robots = await checkWatchUrls(
      parsed.data.watchUrls,
      deps.fetchRobots ?? defaultFetchRobots,
    );
    const refused = robots.filter((check) => !check.allowed);
    if (refused.length > 0) {
      throw new HttpError(
        403,
        `robots.txt refuses this watch. ${refused
          .map((check) => `${check.url}: ${check.detail}`)
          .join('; ')}`,
      );
    }

    const collector: CollectorRecord = {
      id: randomUUID(),
      ...parsed.data,
      status: 'active',
      acquisitionContext: {},
      ...(parsed.data.provenance === undefined ? {} : { provenance: parsed.data.provenance }),
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

    const parsed = collectorFieldsSchema
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

    /*
     * Checked on the result, not on the patch.
     *
     * A partial update can create the gap without ever mentioning it: send
     * witnessSpecs without the application_url entry, leave protectedFields
     * alone, and the record now protects a field no second sensor reads. The
     * register route rejects that arrangement, so the update route has to
     * reject arriving at it.
     */
    const unwitnessed = unwitnessedProtectedFields(updated);
    if (unwitnessed.length > 0) {
      throw new HttpError(
        400,
        `"${unwitnessed[0]}" is protected but has no witness spec, so only one sensor would ever ` +
          'read it. Add a witnessSpecs entry for it, or stop protecting it.',
      );
    }

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
  router.get('/api/doorway/opportunities', async ({ query }) => {
    const [collectors, snapshots, incidents] = await Promise.all([
      store.listCollectors(),
      store.listVerifiedSnapshots(),
      store.listIncidents(),
    ]);
    // The proof walkthrough asks for the fixture by name, because breaking it
    // is the whole point of that page. Nothing a student sees passes this.
    const includeLab = query.get('includeLab') === '1';
    const opportunities = opportunitiesFromSnapshots(
      snapshots,
      collectors,
      incidents,
      Date.now(),
      includeLab,
    );
    return {
      opportunities,
      generatedAt: new Date().toISOString(),
      sources: new Set(opportunities.map((opportunity) => opportunity.collectorId)).size,
    };
  });

  router.get('/api/doorway/opportunities/:id', async ({ params }) => {
    const [collectors, snapshots, incidents, indexed] = await Promise.all([
      store.listCollectors(),
      store.listVerifiedSnapshots(),
      store.listIncidents(),
      index.all(),
    ]);
    const opportunity = [
      /*
       * Looking one up by id is not browsing.
       *
       * The fixture is kept out of listings because a student scrolling a page
       * of opportunities must never be shown a fabricated one. Being handed its
       * id is different: the proof walkthrough links straight to it, and the
       * evidence page for the record that page is built around answered 404.
       */
      ...opportunitiesFromSnapshots(snapshots, collectors, incidents, Date.now(), true),
      ...indexed.filter(isPublishableDraft).map(draftToOpportunity),
    ].find((candidate) => candidate.id === params['id']);
    if (opportunity === undefined) throw new HttpError(404, 'opportunity not found');
    return opportunity;
  });

  /*
   * What this opportunity asks a student to actually do.
   *
   * Separate from the record because they answer different questions. The
   * record is what the source says. The mission is what that means for one
   * person holding some documents and not others, and it is the only place
   * verification becomes a consequence rather than a badge.
   *
   * `held` arrives as a query parameter rather than as stored state, because a
   * student who has signed up for nothing should still get a real plan, and
   * because a list of documents somebody owns is not worth holding.
   */
  router.get('/api/doorway/opportunities/:id/mission', async ({ params, query }) => {
    const [collectors, snapshots, incidents, indexed] = await Promise.all([
      store.listCollectors(),
      store.listVerifiedSnapshots(),
      store.listIncidents(),
      index.all(),
    ]);
    const opportunity = [
      /*
       * Looking one up by id is not browsing.
       *
       * The fixture is kept out of listings because a student scrolling a page
       * of opportunities must never be shown a fabricated one. Being handed its
       * id is different: the proof walkthrough links straight to it, and the
       * evidence page for the record that page is built around answered 404.
       */
      ...opportunitiesFromSnapshots(snapshots, collectors, incidents, Date.now(), true),
      ...indexed.filter(isPublishableDraft).map(draftToOpportunity),
    ].find((candidate) => candidate.id === params['id']);
    if (opportunity === undefined) throw new HttpError(404, 'opportunity not found');

    const held = (query.get('held') ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');

    return buildMission({ opportunity, held });
  });

  /*
   * Find opportunities for one student, from the live web, now.
   *
   * Public on purpose, and rate limited for the same reason. Every other route
   * that spends money is behind the admin token, but this is the one a student
   * uses and neither they nor a judge can be handed a token. Public and paid is
   * a combination that ends one way if left alone, so `DiscoveryBudget` caps it
   * per caller and, more importantly, globally.
   *
   * Returns an id immediately rather than the results. Four searches and a
   * dozen page reads take a minute or more, and a request held open that long
   * is one a proxy will cut. The work is watched on the same event stream the
   * observation console uses.
   */
  router.post('/api/doorway/discover', async ({ body, request }) => {
    if (deps.discovery === undefined) {
      throw new HttpError(
        503,
        'live discovery is not configured on this server, so nothing can be searched for',
      );
    }

    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(400, issue?.message ?? 'invalid student profile');
    }

    // Behind a proxy the socket address is the proxy. The first hop in
    // x-forwarded-for is the closest thing to the caller available here.
    const forwarded = request.headers['x-forwarded-for'];
    const caller =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ??
      request.socket.remoteAddress ??
      'unknown';

    const decision = budget.take(caller);
    if (!decision.allowed) {
      throw new HttpError(429, decision.reason ?? 'too many live searches');
    }

    const profile = parsed.data;
    const observationId = broker.start('discovery', profile.interests.join(', '));
    const emit = broker.emitterFor(observationId);

    void discover(deps.discovery, profile, {
      maxPages: 12,
      maxTypes: 3,
      onEvent: (event) => {
        emit({ step: event.step, line: event.line, ...(event.detail === undefined ? {} : { detail: event.detail }) });
      },
    })
      .then((result) => {
        discoveries.set(observationId, result.drafts);
        // Bounded: this is a demonstration surface, not a store.
        if (discoveries.size > 50) {
          const oldest = discoveries.keys().next().value;
          if (oldest !== undefined) discoveries.delete(oldest);
        }
      })
      .catch((error: unknown) => {
        emit({
          step: 'error',
          line: `failed           ${error instanceof Error ? error.message : String(error)}`,
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
      })
      .finally(() => {
        broker.finish(observationId);
      });

    return { discoveryId: observationId, remaining: decision.remaining };
  });

  /**
   * Collect the results of a finished discovery.
   *
   * Separate from the stream because the stream is a log and these are records.
   * A client that missed the stream entirely can still read what was found.
   */
  router.get('/api/doorway/discoveries/:id', async ({ params }) => {
    const id = params['id'] ?? '';
    const drafts = discoveries.get(id);
    if (drafts === undefined) {
      // Still running is not the same as never existed, and a client polling
      // needs to tell them apart.
      if (broker.has(id)) return { id, status: 'running' as const, drafts: [] };
      throw new HttpError(404, 'no such discovery');
    }
    return { id, status: 'done' as const, drafts };
  });

  /*
   * One question, one answer: everything we can find for this student.
   *
   * The world used to be built only from sources under continuous observation,
   * and live finds went into a separate list further down the page behind a
   * button. Since only a handful of sources are watched, a student whose
   * interest was not among them arrived to a nearly empty map and reasonably
   * concluded the product had no data, while a live search would have found
   * them a dozen fellowships in under a minute.
   *
   * So this does both and returns one world. Verified records and live finds
   * sit together, each carrying its own standing, because the honest thing is
   * not to hide the weaker ones but to say which is which.
   *
   * Discovery is best-effort. If the search fails, the watched sources still
   * come back, because half an answer beats an error page.
   */
  /*
   * Start looking, and hand back somewhere to watch.
   *
   * This used to hold the request open for the whole search and return the
   * finished world, which meant the stream id arrived only once there was
   * nothing left to watch. The page filled the minute with a fixed list of four
   * sentences that were true in general and connected to nothing in particular.
   *
   * Returning immediately lets the browser follow the actual work: the queries
   * that went out, each host as it is opened, and each page that turned out to
   * be a listing rather than an opportunity. That is a better answer to "why is
   * this taking a minute" than any animation, because it is the reason.
   */
  /*
   * Crawl, and keep what is found.
   *
   * Admin-gated, unlike the student-facing search. A crawl spends hundreds of
   * page loads in one go, which is the right amount for an operator filling an
   * index and far too much to hand an anonymous visitor.
   *
   * Returns immediately with somewhere to watch, because a few hundred pages
   * takes minutes and a request held open that long is one a proxy will cut.
   */
  router.post('/api/crawl', async ({ body, request }) => {
    assertAdmin(request);
    if (deps.discovery === undefined) {
      throw new HttpError(503, 'crawling is not configured on this server');
    }

    const parsed = profileSchema.safeParse((body as { profile?: unknown } | null)?.profile ?? body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(400, issue?.message ?? 'invalid student profile');
    }

    const asNumber = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const input = (body ?? {}) as Record<string, unknown>;

    const id = randomUUID();
    broker.start('crawl', parsed.data.interests.join(', '), id);
    const emit = broker.emitterFor(id);

    void crawl(deps.discovery, parsed.data, {
      limits: {
        maxFetches: Math.min(2000, Math.max(10, asNumber(input['maxFetches'], 200))),
        maxPerHost: Math.min(200, Math.max(1, asNumber(input['maxPerHost'], 30))),
        maxDepth: Math.min(4, Math.max(0, asNumber(input['maxDepth'], 2))),
      },
      concurrency: Math.min(100, Math.max(1, asNumber(input['concurrency'], 60))),
      onEvent: (event) => {
        // Per-page chatter is noise at this volume; the milestones carry the
        // shape of the run.
        if (event.step === 'kept' || event.step === 'dropped') return;
        emit({
          step: CRAWL_STEPS[event.step] ?? 'read',
          line: event.line,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        });
      },
    })
      .then(async (result) => {
        const merged = await index.merge(result.drafts);
        // Kept, because it is the only number that says whether this reaches
        // past the handful of sources under continuous watch.
        await index.recordReach(result.fetched, result.hosts);
        crawls.set(id, {
          status: 'done',
          fetched: result.fetched,
          hosts: result.hosts,
          harvested: result.harvested,
          found: result.drafts.length,
          ...merged,
        });
        emit({
          step: 'done',
          line: `indexed          ${String(merged.added)} new, ${String(merged.refreshed)} refreshed`,
          detail: merged,
        });
      })
      .catch((error: unknown) => {
        emit({
          step: 'error',
          line: `failed           ${error instanceof Error ? error.message : String(error)}`,
        });
        crawls.set(id, { status: 'failed' });
      })
      .finally(() => {
        broker.finish(id);
      });

    return { crawlId: id };
  });

  /** How a crawl went, once it is over. */
  router.get('/api/crawl/:id', async ({ params }) => {
    const id = params['id'] ?? '';
    const done = crawls.get(id);
    if (done !== undefined) return done;
    if (broker.has(id)) return { status: 'running' as const };
    throw new HttpError(404, 'no such crawl');
  });

  /** What the index holds, which is what a search can answer from. */
  router.get('/api/crawl', async () => index.stats());

  /*
   * Build a sensor for a page nobody has watched.
   *
   * Returns as soon as the job has somewhere to be watched, because generation
   * runs to minutes and a request that waits for it would time out long before
   * it finished. The observation id is the handle: the same stream the observe
   * and discovery paths use, so a viewer learns one vocabulary rather than
   * three.
   *
   * Admin-gated. Every call creates a real Scraper Studio collector against a
   * real account, and a public route that manufactures scrapers on demand ends
   * exactly one way.
   */
  /*
   * Reconstruct how an existing collector reads its page.
   *
   * The collectors built before provenance was kept had their briefs typed
   * into a terminal, and Bright Data does not expose them for reading back, so
   * the original sentence is gone. Inventing a plausible one would be
   * manufacturing the exact kind of confident, unverified claim this project
   * exists to catch.
   *
   * What can honestly be recorded is what the page shows now and what the
   * collector is configured to protect. That is real evidence, it is checkable
   * against the page, and it is not the same as knowing what its author meant,
   * so it is stored marked as a reconstruction with no brief attached.
   */
  router.post('/api/collectors/:id/provenance/reconstruct', async ({ params, request }) => {
    assertAdmin(request);
    const collector = await requireCollector(store, params['id']);

    if (deps.fetchMarkdown === undefined) {
      throw new HttpError(503, 'no Web Unlocker is configured, so the page cannot be read');
    }
    const url = collector.watchUrls[0];
    if (url === undefined) {
      throw new HttpError(400, 'this collector watches no URL, so there is no page to read');
    }

    const { markdown } = await deps.fetchMarkdown(url);
    const brief = composeBrief(markdown, url);

    /*
     * Reasons are kept only for fields this collector actually protects.
     * Explaining the protection of something it does not protect would
     * describe a different collector.
     */
    const protectedBecause: Record<string, string> = {};
    for (const [field, reason] of Object.entries(brief.protectedBecause)) {
      if (collector.protectedFields.includes(field)) protectedBecause[field] = reason;
    }

    const updated: CollectorRecord = {
      ...collector,
      provenance: {
        sourceUrl: url,
        reconstructed: true,
        observations: brief.observations,
        protectedBecause,
        createdBy: 'operator',
        createdAt: collector.createdAt,
      },
    };
    await store.saveCollector(updated);
    return updated;
  });

  router.post('/api/collectors/manufacture', async ({ body, request }) => {
    assertAdmin(request);

    const url = (body as { url?: unknown } | null)?.url;
    if (typeof url !== 'string' || url.trim() === '') {
      throw new HttpError(400, 'a url is required');
    }
    let target: URL;
    try {
      target = new URL(url.trim());
    } catch {
      throw new HttpError(400, `not a URL: ${url}`);
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new HttpError(400, 'only http and https pages can be read');
    }

    if (deps.fetchMarkdown === undefined) {
      throw new HttpError(
        503,
        'no Web Unlocker is configured, so the page cannot be read and no brief could be written from it',
      );
    }
    const readPage = deps.fetchMarkdown;

    const observationId = broker.start('manufacture', target.toString());
    const emit = broker.emitterFor(observationId);

    void manufactureCollector({
      url: target.toString(),
      client,
      store,
      readPage: async (pageUrl) => readPage(pageUrl),
      emit,
    })
      .then((result) => {
        emit({
          step: 'done',
          line: `done  ${result.brightDataCollectorId} is registered and ready to run`,
          detail: {
            collectorId: result.collector.id,
            brightDataCollectorId: result.brightDataCollectorId,
          },
        });
      })
      .catch((error: unknown) => {
        emit({
          step: 'error',
          line: `failed  ${error instanceof Error ? error.message : String(error)}`,
          detail: {},
        });
      })
      .finally(() => {
        broker.finish(observationId);
      });

    return { observationId, url: target.toString() };
  });

  router.post('/api/doorway/find', async ({ body, request }) => {
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(400, issue?.message ?? 'invalid student profile');
    }
    const profile = parsed.data;

    const [collectors, snapshots, incidents] = await Promise.all([
      store.listCollectors(),
      store.listVerifiedSnapshots(),
      store.listIncidents(),
    ]);
    const watched = opportunitiesFromSnapshots(snapshots, collectors, incidents);

    /*
     * Answer out of what is already known, before touching the web.
     *
     * This is the whole point of keeping the crawl. A search used to mean a
     * live search: a minute of waiting, a dozen pages, and results that varied
     * wildly run to run because a search engine returns different things each
     * time you ask. Reading the index instead answers in milliseconds, from
     * everything every previous crawl reached, and the same question gets the
     * same answer twice.
     *
     * The live search does not go away. It becomes the thing that tops the
     * index up rather than the thing that produces results.
     */
    const indexed = await index.search(profile.interests, profile.opportunityTypes, 80);
    const fromIndex = indexed.filter(isPublishableDraft).map(draftToOpportunity);

    const id = randomUUID();

    const settle = (world: FoundWorld): void => {
      finds.set(id, world);
      // Bounded: a demonstration surface, never the record of anything.
      if (finds.size > 50) {
        const oldest = finds.keys().next().value;
        if (oldest !== undefined) finds.delete(oldest);
      }
    };

    if (deps.discovery === undefined) {
      settle({ ...buildWorld(profile, [...watched, ...fromIndex]), live: false, searched: 0 });
      return { findId: id, live: false };
    }

    const forwarded = request.headers['x-forwarded-for'];
    const caller =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ??
      request.socket.remoteAddress ??
      'unknown';

    const decision = budget.take(caller);
    if (!decision.allowed) {
      // Over the cap is not an error. The watched sources are still worth
      // returning, and the world says the live half did not run.
      settle({
        ...buildWorld(profile, [...watched, ...fromIndex]),
        live: false,
        searched: 0,
        ...(decision.reason === null ? {} : { liveMessage: decision.reason }),
      });
      return { findId: id, live: false };
    }

    /*
     * Answer now, improve later.
     *
     * The index result was being held until the live search finished, which
     * meant a student waited a minute to see records that were already sitting
     * on disk. Settling immediately makes the answer available on the first
     * poll, and the live search overwrites it with a fuller one when it lands.
     *
     * The world is therefore written twice for one request. That is the point:
     * the first write is what the crawl already knew, the second is what this
     * search added to it.
     */
    settle({
      ...buildWorld(profile, [...watched, ...fromIndex]),
      live: true,
      searched: 0,
    });

    // The stream is keyed by the same id, so the browser can open it the moment
    // this response lands.
    broker.start('live search', profile.interests.join(', '), id);
    const emit = broker.emitterFor(id);

    void discover(deps.discovery, profile, {
      maxPages: 18,
      // A selected type is a filter, not a suggestion. The old cap silently
      // dropped Hackathons when it was the fifth selected button.
      maxTypes: Math.min(6, profile.opportunityTypes.length),
      onEvent: (event) => {
        emit({
          step: event.step,
          line: event.line,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        });
      },
    })
      .then(async (found) => {
        // Everything the live search turned up joins the index, so the next
        // student gets it for free.
        await index.merge(found.drafts);
        const live = found.drafts.map(draftToOpportunity);
        // Watched first: a record two sensors agreed on outranks one read once,
        // and ordering says so before any badge is read.
        /*
         * Index first, then what the live search just added.
         *
         * Both are unverified finds and both say so. Ordering matters only in
         * that a record seen by several crawls has been seen more than once,
         * which is the closest thing this half of the system has to
         * corroboration.
         */
        settle({
          ...buildWorld(profile, [...watched, ...fromIndex, ...live]),
          live: true,
          searched: found.considered,
        });
      })
      .catch((error: unknown) => {
        emit({
          step: 'error',
          line: `failed           ${error instanceof Error ? error.message : String(error)}`,
        });
        settle({
          ...buildWorld(profile, [...watched, ...fromIndex]),
          live: false,
          searched: 0,
          liveMessage:
            error instanceof BrightDataBalanceError
              ? 'The live search did not run because the Bright Data account has no available balance. ' +
                'This shows what was already verified rather than nothing, and none of it is guessed. ' +
                'Live results resume the moment the account is funded.'
              : 'The live search could not be completed, so this shows what was already known rather than nothing.',
        });
      })
      .finally(() => {
        broker.finish(id);
      });

    return { findId: id, live: true };
  });

  /**
   * Collect a finished search.
   *
   * Separate from the stream because the stream is a log and this is the
   * answer. A client that missed the stream entirely still gets the world.
   */
  router.get('/api/doorway/find/:id', async ({ params }) => {
    const id = params['id'] ?? '';
    if (broker.isRunning(id)) return { status: 'running' as const };
    const world = finds.get(id);
    if (world !== undefined) return { status: 'done' as const, world };
    throw new HttpError(404, 'no such search');
  });

  router.post('/api/doorway/world', async ({ body }) => {
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(400, issue?.message ?? 'invalid student profile');
    }
    const [collectors, snapshots, incidents, indexed] = await Promise.all([
      store.listCollectors(),
      store.listVerifiedSnapshots(),
      store.listIncidents(),
      index.search(parsed.data.interests, parsed.data.opportunityTypes, 80),
    ]);
    const opportunities = [
      ...opportunitiesFromSnapshots(snapshots, collectors, incidents),
      ...indexed.filter(isPublishableDraft).map(draftToOpportunity),
    ];
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
