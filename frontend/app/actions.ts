'use server';

import { fundingLabel } from '@/lib/funding';
import { revalidatePath } from 'next/cache';
import { serverApiBase } from '@/lib/env';
import { api } from '@/lib/api';
import type { DoorwayProfile, DoorwayWorld, Mission } from '@/lib/types';
import { wakeFetch } from '@/lib/wake';

/**
 * Server actions: the only place the admin token exists.
 *
 * The backend requires a bearer token on every mutating route. Putting that
 * token in the browser would defeat the point, and it cannot be sent from the
 * browser anyway because the API's CORS policy does not allow an
 * `authorization` header. So mutations run here, on the Next.js server, and
 * the browser only ever calls a server action by name.
 *
 * Every action returns a discriminated result rather than throwing, so a
 * failure renders as a message next to the button instead of an error page in
 * the middle of a demo.
 */

const BASE = serverApiBase();

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function buildDoorwayWorldAction(
  profile: DoorwayProfile,
): Promise<ActionResult<DoorwayWorld>> {
  try {
    const response = await wakeFetch(`${BASE}/api/doorway/world`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
      cache: 'no-store',
    });
    const payload = (await response.json().catch(() => null)) as
      | DoorwayWorld
      | { error?: string }
      | null;
    if (!response.ok) {
      return {
        ok: false,
        error:
          payload !== null && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : `request failed with ${String(response.status)}`,
      };
    }
    return { ok: true, data: payload as DoorwayWorld };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : 'the Doorway engine could not be reached',
    };
  }
}

async function mutate<T>(
  path: string,
  body?: unknown,
  method: 'POST' | 'PUT' = 'POST',
): Promise<ActionResult<T>> {
  const token = process.env['NOTICE_ADMIN_TOKEN'];
  if (token === undefined || token.trim() === '') {
    return {
      ok: false,
      error:
        'NOTICE_ADMIN_TOKEN is not set on the dashboard server, so no action can be authorized.',
    };
  }

  try {
    const response = await wakeFetch(`${BASE}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      return { ok: false, error: payload?.error ?? `request failed with ${String(response.status)}` };
    }
    return { ok: true, data: payload as T };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : 'the backend could not be reached',
    };
  }
}

/**
 * Break the fixture on purpose, from the dashboard.
 *
 * DriftMart's mode switch is guarded by its own token, not the NOTICE one,
 * because it is a different service with a different threat model: its admin
 * route has to be publicly reachable so Bright Data can fetch the pages, and
 * without a guard a passer-by could flip the layout mid-run.
 *
 * This exists so a demonstration never needs a terminal. Causing the fault and
 * catching it in the same interface is the difference between describing the
 * system and operating it.
 */
export async function setFixtureModeAction(mode: string): Promise<ActionResult> {
  const token = process.env['DRIFTMART_ADMIN_TOKEN'];
  const fixture = (process.env['DRIFTMART_URL'] ?? 'https://doorway-lab.onrender.com').replace(
    /\/+$/,
    '',
  );

  if (token === undefined || token.trim() === '') {
    return {
      ok: false,
      error: 'DRIFTMART_ADMIN_TOKEN is not set on the dashboard server, so the fixture is locked.',
    };
  }

  try {
    const response = await wakeFetch(`${fixture}/api/admin/mode`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify({ mode }),
      cache: 'no-store',
    });

    if (!response.ok) {
      return { ok: false, error: `the fixture refused the switch (${String(response.status)})` };
    }
    revalidatePath('/');
    return { ok: true, data: { mode } };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : 'the fixture could not be reached',
    };
  }
}

/**
 * Which controls this deployment can actually operate.
 *
 * Both tokens live only on the dashboard server, so the browser cannot know
 * whether they are configured and every control rendered as though it worked.
 * You learned otherwise by pressing it and reading a server error, which is a
 * button that looks fine right up until you act on it. Reporting the state
 * before the click is the same standard this project holds data to.
 *
 * Returns booleans and never the tokens themselves.
 */
export async function getConsoleCapabilitiesAction(): Promise<{
  canRunCollector: boolean;
  canSwitchFixture: boolean;
}> {
  const present = (value: string | undefined): boolean =>
    value !== undefined && value.trim() !== '';
  return {
    canRunCollector: present(process.env['NOTICE_ADMIN_TOKEN']),
    canSwitchFixture: present(process.env['DRIFTMART_ADMIN_TOKEN']),
  };
}

/**
 * Read which mode the fixture is actually serving.
 *
 * The console used to open on a hardcoded `baseline` and print it as fact.
 * Anything that switched the fixture from outside the page, a CLI run, the
 * blindspot script, another tab, left the panel asserting one mode while the
 * page underneath served another. A dashboard displaying a value it never
 * checked is the exact failure this project exists to argue against, and it
 * was doing it on its own front page.
 *
 * Unauthenticated on the fixture's side because the current mode reveals
 * nothing sensitive. Read here rather than from the browser because the
 * fixture sets no CORS headers.
 */
export async function getFixtureModeAction(): Promise<string | null> {
  const fixture = (process.env['DRIFTMART_URL'] ?? 'https://doorway-lab.onrender.com').replace(
    /\/+$/,
    '',
  );
  try {
    const response = await wakeFetch(`${fixture}/api/admin/mode`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { mode?: unknown };
    return typeof body.mode === 'string' ? body.mode : null;
  } catch {
    // Unreachable is a real answer and is shown as one. Guessing "baseline"
    // here is how the panel started lying in the first place.
    return null;
  }
}

/**
 * Start an observation and hand back somewhere to watch it.
 *
 * `runCollectorAction` waits for the verdict, which is right for a script and
 * wrong for a person: a real Scraper Studio run takes about thirty seconds and
 * the interesting part is what happens during them. This returns as soon as the
 * work is queued so the browser can open the stream.
 */
export async function startObservationAction(
  collectorId: string,
  url?: string,
): Promise<ActionResult<{ observationId: string }>> {
  return mutate<{ observationId: string }>(
    `/api/collectors/${encodeURIComponent(collectorId)}/observe`,
    url === undefined ? {} : { url },
  );
}

/**
 * Build a sensor for a page nobody has watched.
 *
 * The slowest thing this product does that a person waits through, so it
 * returns an observation id rather than a result. Generation took 97 seconds
 * against a simple page and Bright Data's own documentation allows up to
 * twenty five minutes for a complex one, which is the difference between a
 * button and a job.
 */
export async function manufactureCollectorAction(
  url: string,
): Promise<ActionResult<{ observationId: string; url: string }>> {
  return mutate<{ observationId: string; url: string }>('/api/collectors/manufacture', { url });
}

/**
 * Correct a registered collector in place.
 *
 * The route behind this was written after a witness spec used "result" as a
 * label against a page whose header reads "1 result": the witness matched the
 * count line, disagreed with the collector, and reported drift on a page where
 * nothing was wrong. A wrong label does not produce an obvious error, it
 * produces a confident wrong verdict, which makes it the setting most in need
 * of being fixable without a store reset.
 *
 * It has been reachable over HTTP since the day it was written and reachable
 * from the interface since none, which is the gap this closes.
 */
export async function updateCollectorAction(
  collectorId: string,
  patch: unknown,
): Promise<ActionResult> {
  const result = await mutate(
    `/api/collectors/${encodeURIComponent(collectorId)}`,
    patch,
    'PUT',
  );
  revalidatePath(`/collectors/${collectorId}`);
  revalidatePath('/');
  return result;
}

/** Observe a collector once, right now. */
export async function runCollectorAction(collectorId: string, url?: string): Promise<ActionResult> {
  const result = await mutate(`/api/collectors/${encodeURIComponent(collectorId)}/run`, url === undefined ? {} : { url });
  revalidatePath('/');
  revalidatePath(`/collectors/${collectorId}`);
  return result;
}

/**
 * Queue a repair.
 *
 * Returns a job, not a result. The heal itself takes minutes and belongs to
 * the worker, so the UI polls the job rather than holding a request open.
 */
export async function healAction(incidentId: string): Promise<ActionResult<{ job: { id: string } }>> {
  const result = await mutate<{ job: { id: string } }>(`/api/incidents/${encodeURIComponent(incidentId)}/heal`);
  revalidatePath(`/incidents/${incidentId}`);
  return result;
}

/**
 * Promote a repair that passed the gate.
 *
 * The backend refuses unless the incident is genuinely at `awaiting_approval`
 * with a passing gate recorded, so a mis-click here is rejected rather than
 * acted on.
 */
export async function approveAction(incidentId: string): Promise<ActionResult> {
  const result = await mutate(`/api/incidents/${encodeURIComponent(incidentId)}/approve`);
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/');
  return result;
}

/** Reject a proposed repair, clearing Bright Data's gate. */
export async function rejectAction(incidentId: string): Promise<ActionResult> {
  const result = await mutate(`/api/incidents/${encodeURIComponent(incidentId)}/reject`);
  revalidatePath(`/incidents/${incidentId}`);
  return result;
}

/** Re-observe after a witness fetch failed. */
export async function retryWitnessAction(incidentId: string): Promise<ActionResult> {
  const result = await mutate(`/api/incidents/${encodeURIComponent(incidentId)}/retry-witness`);
  revalidatePath(`/incidents/${incidentId}`);
  return result;
}

/** Accept specific runs as the baseline for a collector. */
export async function acceptBaselineAction(
  collectorId: string,
  runIds: string[],
): Promise<ActionResult> {
  const result = await mutate(`/api/collectors/${encodeURIComponent(collectorId)}/baseline`, {
    runIds,
  });
  revalidatePath(`/collectors/${collectorId}`);
  revalidatePath('/');
  return result;
}

/** Register a collector already built in Scraper Studio. */
export async function registerCollectorAction(input: unknown): Promise<ActionResult> {
  const result = await mutate('/api/collectors', input);
  revalidatePath('/');
  return result;
}

/**
 * What the fixture can currently be made to do, in its own words.
 *
 * Read from the fixture rather than restated here so the two cannot disagree.
 * A dashboard carrying its own copy of the list will eventually offer a fault
 * the fixture cannot serve, and the button fails in front of whoever is being
 * shown the demonstration.
 *
 * Returns an empty list rather than throwing when the fixture is unreachable,
 * because "cannot reach the source page" is a state the walkthrough shows and
 * explains rather than a crash.
 */
export interface ProofScenario {
  id: string;
  label: string;
  plain: string;
  /** What a correct system should decide, in plain words. */
  decision: string;
  /** The verdicts that satisfy that decision. Observed, not predicted. */
  verdicts: string[];
  consequence: string;
  semanticChange: boolean;
}

export async function getProofScenariosAction(): Promise<{
  mode: string | null;
  scenarios: ProofScenario[];
  fixtureUrl: string;
}> {
  const fixtureUrl = (
    process.env['DRIFTMART_URL'] ?? 'https://doorway-lab.onrender.com'
  ).replace(/\/+$/, '');

  try {
    const response = await wakeFetch(`${fixtureUrl}/api/admin/mode`, { cache: 'no-store' });
    if (!response.ok) return { mode: null, scenarios: [], fixtureUrl };

    const body = (await response.json()) as {
      mode?: unknown;
      opportunityScenarios?: unknown;
    };

    const scenarios = Array.isArray(body.opportunityScenarios)
      ? (body.opportunityScenarios as ProofScenario[])
      : [];

    return {
      mode: typeof body.mode === 'string' ? body.mode : null,
      scenarios,
      fixtureUrl,
    };
  } catch {
    return { mode: null, scenarios: [], fixtureUrl };
  }
}

/**
 * The opportunity as a student would see it right now, plus its basis.
 *
 * The walkthrough needs the before and after of a single record, and asking
 * for the whole world to show one row would make the page slower for no
 * reason. Returns null when nothing is served yet, which is itself a state the
 * page explains.
 */
export interface ProofOpportunity {
  collectorId: string;
  title: string;
  deadlineRaw: string | null;
  fundingLevel: string;
  applicationUrl: string;
  trustStatus: string;
  confirmedBy: string;
  fieldsDegraded: string[];
  lastVerifiedAt: string;
}

/**
 * What is served, or why nothing is.
 *
 * This returned a bare null for both "the world is empty" and "the call
 * failed", and the page then explained the absence to the visitor as the
 * honest empty state Doorway deliberately ships. On a cold start that
 * sentence was reassuring the reader about a swallowed network error. The two
 * causes are now distinguishable, because a page whose argument is that this
 * system does not report what it has not checked cannot do that about itself.
 */
export type ProofOpportunityResult =
  | { state: 'ok'; opportunity: ProofOpportunity }
  | { state: 'empty' }
  | { state: 'unreachable'; detail: string };

export async function getProofOpportunityAction(): Promise<ProofOpportunityResult> {
  try {
    /*
     * The walkthrough needs the fixture specifically, not whatever is first.
     *
     * It asks for the lab to be included, and the list then holds real
     * fellowships too. Taking the first would hand the fault switch a page at
     * research.adobe.com, which we cannot break and should not try to: the
     * switch would fail and the demonstration would look broken rather than
     * honest.
     */
    const { opportunities } = await api.doorwayOpportunities({ includeLab: true });

    const fixture = (process.env['DRIFTMART_URL'] ?? '').replace(/\/+$/, '');
    let fixtureHost = '';
    try {
      fixtureHost = fixture === '' ? '' : new URL(fixture).host;
    } catch {
      fixtureHost = '';
    }

    const hostOf = (url: string): string => {
      try {
        return new URL(url).host;
      } catch {
        return '';
      }
    };

    const first =
      (fixtureHost === ''
        ? undefined
        : opportunities.find((entry) => hostOf(entry.sourceUrl) === fixtureHost)) ??
      opportunities[0];
    if (first === undefined) return { state: 'empty' };
    return {
      state: 'ok',
      opportunity: {
      // The walkthrough runs the collector behind the record it is showing.
      // Picking by fixture hostname instead looked equivalent and was not:
      // when the source sits behind a tunnel its host is not the fixture's,
      // so the page silently fell back to the first collector registered and
      // offered to run an unrelated one.
      collectorId: first.collectorId,
      title: first.title,
      deadlineRaw: first.deadlineRaw,
      fundingLevel: fundingLabel(first.funding),
      applicationUrl: first.applicationUrl,
      trustStatus: first.trust.status,
      confirmedBy: first.trust.confirmedBy,
      fieldsDegraded: first.trust.fieldsDegraded,
      lastVerifiedAt: first.trust.lastVerifiedAt,
      },
    };
  } catch (err) {
    return {
      state: 'unreachable',
      detail: err instanceof Error ? err.message : 'the backend did not answer',
    };
  }
}

/**
 * Everything we can find for this student, watched and live, in one answer.
 *
 * Replaces the two-step the page used to ask of people: build a world from
 * sources under observation, then notice a separate button further down and
 * press that to search the web. Only a handful of sources are watched, so the
 * first step alone showed a nearly empty map, and most visitors never reached
 * the second.
 *
 * Slower than the old world call, because it really does go and search. The
 * caller shows the reasoning while it runs rather than a spinner.
 */
export interface FoundWorld extends DoorwayWorld {
  /** Whether the live search actually ran. */
  live: boolean;
  /** How many pages were opened and considered. */
  searched: number;
  /** Why the live half did not run, when it did not. */
  liveMessage?: string;
  /** The stream to watch, when a search was started. */
  discoveryId?: string;
}

export async function startFindAction(
  profile: DoorwayProfile,
): Promise<ActionResult<{ findId: string; live: boolean }>> {
  try {
    const response = await wakeFetch(`${serverApiBase()}/api/doorway/find`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => null)) as {
      findId?: unknown;
      live?: unknown;
      error?: unknown;
    } | null;

    if (body !== null && typeof body.error === 'string') {
      return { ok: false, error: body.error };
    }

    /*
     * A success that is not the success we asked for.
     *
     * Reporting "the search could not be started (200)" is a contradiction: 200
     * is the server saying it worked. What actually happened is that it
     * answered in a shape this page does not recognise, which in practice means
     * the API is running an older build than the dashboard. Saying so points at
     * the thing that needs fixing instead of at an HTTP code that is fine.
     */
    if (response.ok && (body === null || typeof body.findId !== 'string')) {
      return {
        ok: false,
        error:
          'The search service answered, but not in a shape this page understands. That usually means the API is running an older build than this dashboard. Redeploy the API and try again.',
      };
    }

    if (!response.ok || body === null || typeof body.findId !== 'string') {
      return {
        ok: false,
        error: `The search service refused the request (${String(response.status)}).`,
      };
    }
    return { ok: true, data: { findId: body.findId, live: body.live === true } };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : 'the service could not be reached',
    };
  }
}

/** Collect a finished search. Reports "running" rather than guessing. */
export async function collectFindAction(
  id: string,
): Promise<ActionResult<{ status: string; world: FoundWorld | null }>> {
  try {
    const response = await wakeFetch(
      `${serverApiBase()}/api/doorway/find/${encodeURIComponent(id)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return { ok: false, error: 'that search is no longer available' };

    const body = (await response.json()) as { status?: unknown; world?: unknown };
    return {
      ok: true,
      data: {
        status: typeof body.status === 'string' ? body.status : 'unknown',
        world: (body.world as FoundWorld | undefined) ?? null,
      },
    };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : 'the service could not be reached',
    };
  }
}


/**
 * What the index actually holds, for the hero to say something true.
 *
 * The strip above the form used to show `c_fellowship.json 200 OK`,
 * `witness_extract.md PROVED` and `sha256.cert`. None of those files exist,
 * nothing returned that status, and nothing was proved. It was decorative
 * telemetry on a product whose entire argument is that a system should never
 * assert what it has not checked.
 *
 * These numbers are the real ones, and they are more impressive than the
 * invented ones were.
 */
export async function getIndexStatsAction(): Promise<{
  total: number;
  hosts: number;
  withDeadline: number;
  /** How far the last crawl reached, when one has finished. */
  reach: { pagesRead: number; hostsReached: number } | null;
} | null> {
  try {
    const response = await wakeFetch(`${serverApiBase()}/api/crawl`, { cache: 'no-store' });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      total?: unknown;
      hosts?: unknown;
      withDeadline?: unknown;
      reach?: { pagesRead?: unknown; hostsReached?: unknown } | null;
    };
    const count = (value: unknown): number => (typeof value === 'number' ? value : 0);

    return {
      total: count(body.total),
      hosts: count(body.hosts),
      withDeadline: count(body.withDeadline),
      reach:
        body.reach === null || body.reach === undefined
          ? null
          : { pagesRead: count(body.reach.pagesRead), hostsReached: count(body.reach.hostsReached) },
    };
  } catch {
    // Unreachable is a real answer. The hero shows nothing rather than a
    // plausible-looking number, which is the whole point of this change.
    return null;
  }
}

/**
 * The plan for one opportunity, for one student.
 *
 * The held list is sent rather than stored, and the answer is computed on the
 * server rather than in the browser. Readiness looks trivial enough to work
 * out here, and the moment it is, the rules about disputed requirements and
 * what blocks an application exist in two places and start to disagree.
 */
export async function getMissionAction(
  id: string,
  held: readonly string[],
): Promise<{ ok: true; mission: Mission } | { ok: false; error: string }> {
  try {
    return { ok: true, mission: await api.mission(id, held) };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'The plan could not be built for this opportunity.',
    };
  }
}
