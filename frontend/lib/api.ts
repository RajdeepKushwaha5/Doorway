import { serverApiBase } from './env';
import type {
  CollectorContract,
  CollectorSummary,
  DealComparison,
  HealthEnvelope,
  Incident,
  JobRecord,
  RunRecord,
} from './types';

/**
 * Thin API client.
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
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    // Monitoring data is only useful when current. A cached incident list is
    // worse than a slow one.
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new ApiError(response.status, body.error ?? 'request failed');
  }
  return (await response.json()) as T;
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

  getJob: (id: string): Promise<JobRecord> => request(`/api/jobs/${encodeURIComponent(id)}`),

  listJobs: (incidentId?: string): Promise<JobRecord[]> =>
    request(`/api/jobs${incidentId === undefined ? '' : `?incidentId=${incidentId}`}`),

  runCollector: (id: string, url?: string): Promise<unknown> =>
    request(`/api/collectors/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      body: JSON.stringify(url === undefined ? {} : { url }),
    }),

  listIncidents: (collectorId?: string): Promise<Incident[]> =>
    request(`/api/incidents${collectorId === undefined ? '' : `?collectorId=${collectorId}`}`),

  getIncident: (id: string): Promise<{ incident: Incident }> =>
    request(`/api/incidents/${encodeURIComponent(id)}`),

  heal: (id: string): Promise<unknown> =>
    request(`/api/incidents/${encodeURIComponent(id)}/heal`, { method: 'POST' }),

  approve: (id: string): Promise<Incident> =>
    request(`/api/incidents/${encodeURIComponent(id)}/approve`, { method: 'POST' }),

  bestDeal: (): Promise<DealComparison> => request('/api/consumer/best-deal'),

  feed: (collectorId: string, url?: string): Promise<HealthEnvelope> =>
    request(
      `/api/feed/${encodeURIComponent(collectorId)}${url === undefined ? '' : `?url=${encodeURIComponent(url)}`}`,
    ),
};
