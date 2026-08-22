'use server';

import { revalidatePath } from 'next/cache';
import { serverApiBase } from '@/lib/env';
import { api } from '@/lib/api';
import type { DoorwayProfile, DoorwayWorld } from '@/lib/types';

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
    const response = await fetch(`${BASE}/api/doorway/world`, {
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
    const response = await fetch(`${BASE}${path}`, {
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
  const fixture = (process.env['DRIFTMART_URL'] ?? 'https://driftmart-3ut8.onrender.com').replace(
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
    const response = await fetch(`${fixture}/api/admin/mode`, {
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
  const fixture = (process.env['DRIFTMART_URL'] ?? 'https://driftmart-3ut8.onrender.com').replace(
    /\/+$/,
    '',
  );
  try {
    const response = await fetch(`${fixture}/api/admin/mode`, { cache: 'no-store' });
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
    process.env['DRIFTMART_URL'] ?? 'https://driftmart-3ut8.onrender.com'
  ).replace(/\/+$/, '');

  try {
    const response = await fetch(`${fixtureUrl}/api/admin/mode`, { cache: 'no-store' });
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
export async function getProofOpportunityAction(): Promise<{
  collectorId: string;
  title: string;
  deadlineRaw: string | null;
  fundingLevel: string;
  applicationUrl: string;
  trustStatus: string;
  confirmedBy: string;
  fieldsDegraded: string[];
  lastVerifiedAt: string;
} | null> {
  try {
    const { opportunities } = await api.doorwayOpportunities();
    const first = opportunities[0];
    if (first === undefined) return null;
    return {
      // The walkthrough runs the collector behind the record it is showing.
      // Picking by fixture hostname instead looked equivalent and was not:
      // when the source sits behind a tunnel its host is not the fixture's,
      // so the page silently fell back to the first collector registered and
      // offered to run an unrelated one.
      collectorId: first.collectorId,
      title: first.title,
      deadlineRaw: first.deadlineRaw,
      fundingLevel: first.funding.level,
      applicationUrl: first.applicationUrl,
      trustStatus: first.trust.status,
      confirmedBy: first.trust.confirmedBy,
      fieldsDegraded: first.trust.fieldsDegraded,
      lastVerifiedAt: first.trust.lastVerifiedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Search the live web for one student, now.
 *
 * Returns an id rather than results. Four searches and a dozen page reads take
 * a minute or more, and a server action held open that long is one a platform
 * will cut out from under the user. The work is watched on the same event
 * stream the observation console uses.
 */
export interface DiscoveryDraft {
  sourceUrl: string;
  host: string;
  title: string;
  provider: string;
  type: string;
  summary: string;
  deadlineRaw: string | null;
  fundingLevel: string | null;
  eligibility: string | null;
  official: boolean;
  foundVia: string;
  missing: string[];
  readAt: string;
}

export async function startDiscoveryAction(
  profile: DoorwayProfile,
): Promise<ActionResult<{ discoveryId: string; remaining: number }>> {
  // Unauthenticated on purpose: this is the route a student uses, and neither
  // they nor a judge can be handed an admin token. The server rate limits it.
  try {
    const response = await fetch(`${serverApiBase()}/api/doorway/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
      cache: 'no-store',
    });

    const body = (await response.json()) as {
      discoveryId?: unknown;
      remaining?: unknown;
      error?: unknown;
    };

    if (!response.ok) {
      return {
        ok: false,
        error:
          typeof body.error === 'string'
            ? body.error
            : `the search could not be started (${String(response.status)})`,
      };
    }

    if (typeof body.discoveryId !== 'string') {
      return { ok: false, error: 'the server did not return a search to watch' };
    }

    return {
      ok: true,
      data: {
        discoveryId: body.discoveryId,
        remaining: typeof body.remaining === 'number' ? body.remaining : 0,
      },
    };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : 'the search service could not be reached',
    };
  }
}

/** Collect what a finished search found. */
export async function getDiscoveryAction(
  id: string,
): Promise<ActionResult<{ status: string; drafts: DiscoveryDraft[] }>> {
  try {
    const response = await fetch(
      `${serverApiBase()}/api/doorway/discoveries/${encodeURIComponent(id)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return { ok: false, error: 'that search is no longer available' };

    const body = (await response.json()) as { status?: unknown; drafts?: unknown };
    return {
      ok: true,
      data: {
        status: typeof body.status === 'string' ? body.status : 'unknown',
        drafts: Array.isArray(body.drafts) ? (body.drafts as DiscoveryDraft[]) : [],
      },
    };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : 'the search service could not be reached',
    };
  }
}
