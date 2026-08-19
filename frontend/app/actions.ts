'use server';

import { revalidatePath } from 'next/cache';
import { serverApiBase } from '@/lib/env';

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

async function mutate<T>(path: string, body?: unknown): Promise<ActionResult<T>> {
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
      method: 'POST',
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
