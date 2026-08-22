import { serverApiBase } from './env';
import type {
  AuditEvent,
  BudgetStatus,
  CollectorContract,
  CollectorSummary,
  DealComparison,
  HealthEnvelope,
  ImpactStats,
  Incident,
  JobRecord,
  RunRecord,
  DoorwayProfile,
  DoorwayWorld,
  DoorwayOpportunity,
} from './types';

/**
 * Thin API client, for reads only.
 *
 * Mutations are absent on purpose. Every write requires the admin bearer
 * token, which must never reach a browser bundle, and the API's CORS policy
 * does not allow an `authorization` header from one anyway. Writes therefore
 * live in `app/actions.ts`, where they run on the Next.js server.
 *
 * This file previously carried `runCollector`, `heal` and `approve` as well.
 * Nothing called them, and anything that had would have received a 401 for
 * reasons that look nothing like the cause. Removed rather than left as a
 * trap for whoever reaches for the obvious method next.
 *
 * No Bright Data credential ever reaches this layer. The browser talks only to
 * the NOTICE backend, which holds the key server-side, so nothing here can
 * leak one into a bundle or a screen recording.
 */

/**
 * Resolved per request, not once at module load.
 *
 * Every caller of this client is a server component, so `NOTICE_API_BASE` is
 * readable at request time. `NEXT_PUBLIC_NOTICE_API_BASE` is not: Next inlines
 * it into the bundle at build time, so changing it on the host does nothing
 * until a rebuild, and a dashboard that was deployed before the backend URL
 * existed keeps pointing at localhost with no visible reason why.
 *
 * Preferring the runtime variable means setting it takes effect on the next
 * request. The build-time value remains the fallback.
 */
const base = (): string => serverApiBase();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * How long to wait, and how many times, when the backend is asleep.
 *
 * The API runs on a free plan that suspends after fifteen minutes idle, and
 * the first request afterwards is what wakes it. That request routinely takes
 * longer than a browser is willing to wait, and it fails.
 *
 * This is not a theoretical edge. The proof page issues three reads at once,
 * then a fourth after them. Opened cold, the first three hit a sleeping
 * service and failed while the fourth arrived to a woken one and succeeded, so
 * the page rendered with no record, no collector, and no error to show for it.
 * A visitor following a link cold is the normal case, not the unlucky one.
 */
const WAKE_TIMEOUT_MS = 20_000;
const WAKE_ATTEMPTS = 3;

/** Retry is safe only for reads. A repeated POST can spend money twice. */
function isRead(init?: RequestInit): boolean {
  const method = (init?.method ?? 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const attempts = isRead(init) ? WAKE_ATTEMPTS : 1;
  let lastError = 'network error';

  for (let attempt = 1; ; attempt += 1) {
    try {
      response = await fetch(`${base()}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
        cache: 'no-store',
        signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      });
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'network error';
      if (attempt >= attempts) {
        throw new ApiError(
          503,
          attempts > 1
            ? `${lastError} (after ${attempts} attempts, ${WAKE_TIMEOUT_MS / 1000}s each)`
            : lastError,
        );
      }
      // A woken service answers the next one. No backoff worth the name is
      // needed, and the caller is a page render that somebody is waiting on.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const text = await response.text();
  let payload: { error?: string } | null = null;
  if (text && text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? response.statusText ?? 'request failed');
  }
  if (payload === null) {
    throw new ApiError(500, 'empty or invalid JSON response from backend');
  }
  return payload as T;
}

export const api = {
  health: (): Promise<{ status: string; at: string }> => request('/api/health'),

  listCollectors: (): Promise<CollectorSummary[]> => request('/api/collectors'),

  getCollector: (
    id: string,
  ): Promise<{
    collector: CollectorSummary;
    contract: CollectorContract | null;
    runs: RunRecord[];
    incidents: Incident[];
  }> => request(`/api/collectors/${encodeURIComponent(id)}`),

  listJobs: (incidentId?: string): Promise<JobRecord[]> =>
    request(`/api/jobs${incidentId === undefined ? '' : `?incidentId=${incidentId}`}`),

  listIncidents: (collectorId?: string): Promise<Incident[]> =>
    request(`/api/incidents${collectorId === undefined ? '' : `?collectorId=${collectorId}`}`),

  getIncident: (
    id: string,
  ): Promise<{ incident: Incident; run: RunRecord | null; audit: AuditEvent[] }> =>
    request(`/api/incidents/${encodeURIComponent(id)}`),

  budget: (): Promise<BudgetStatus> => request('/api/budget'),

  /** What was withheld, and how much of it nothing else would have caught. */
  impact: (): Promise<ImpactStats> => request('/api/stats/impact'),

  bestDeal: (): Promise<DealComparison> => request('/api/consumer/best-deal'),

  feed: (collectorId: string, url?: string): Promise<HealthEnvelope> =>
    request(
      `/api/feed/${encodeURIComponent(collectorId)}${url === undefined ? '' : `?url=${encodeURIComponent(url)}`}`,
    ),

  /**
   * What is being served.
   *
   * `includeLab` opts into the controlled fixture, which is otherwise kept out
   * of everything a student sees. Only the proof walkthrough passes it, because
   * breaking that page is the whole subject of it.
   */
  doorwayOpportunities: (
    options: { includeLab?: boolean } = {},
  ): Promise<{
    opportunities: DoorwayOpportunity[];
    generatedAt: string;
    sources: number;
  }> =>
    request(
      options.includeLab === true
        ? '/api/doorway/opportunities?includeLab=1'
        : '/api/doorway/opportunities',
    ),

  doorwayWorld: (profile: DoorwayProfile): Promise<DoorwayWorld> =>
    request('/api/doorway/world', { method: 'POST', body: JSON.stringify(profile) }),

  /** One opportunity, with everything known about where its values came from. */
  doorwayOpportunity: (id: string): Promise<DoorwayOpportunity> =>
    request(`/api/doorway/opportunities/${encodeURIComponent(id)}`),
};
