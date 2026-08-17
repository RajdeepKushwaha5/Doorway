import { serverApiBase } from './env';
import type {
  BudgetStatus,
  CollectorContract,
  CollectorSummary,
  DealComparison,
  HealthEnvelope,
  Incident,
  JobRecord,
  RunRecord,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiError(503, err instanceof Error ? err.message : 'network error');
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

  getIncident: (id: string): Promise<{ incident: Incident }> =>
    request(`/api/incidents/${encodeURIComponent(id)}`),

  budget: (): Promise<BudgetStatus> => request('/api/budget'),

  bestDeal: (): Promise<DealComparison> => request('/api/consumer/best-deal'),

  feed: (collectorId: string, url?: string): Promise<HealthEnvelope> =>
    request(
      `/api/feed/${encodeURIComponent(collectorId)}${url === undefined ? '' : `?url=${encodeURIComponent(url)}`}`,
    ),
};
