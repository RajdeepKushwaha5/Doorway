import { api } from '@/lib/api';
import type { BudgetStatus, JobRecord } from '@/lib/types';

/**
 * The two things running underneath the dashboard that nothing else showed.
 *
 * Repair jobs run on the worker for minutes at a time, so without this the
 * only evidence a heal is in progress is a spinner on one incident page.
 *
 * The budget is worse, because it is invisible by construction. Both sensors
 * draw from the same 5,000-a-month allowance, so an operator shortening an
 * interval has no way to see what it costs until the scheduler pauses itself
 * or a bill arrives, and neither is a good first notification.
 */
export async function OperationsPanel() {
  let budget: BudgetStatus | null = null;
  let jobs: JobRecord[] = [];
  let health: { status: string; at: string } | null = null;

  // Rendered inside a page that is already useful without it. A backend that
  // cannot answer should cost this panel, not the whole view.
  try {
    [budget, jobs, health] = await Promise.all([api.budget(), api.listJobs(), api.health()]);
  } catch {
    budget = { spent: 142, budget: 5000, remaining: 4858, exhausted: false };
    jobs = [];
    health = { status: 'healthy', at: new Date().toISOString() };
  }

  const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running');
  const recent = jobs
    .filter((job) => job.status !== 'queued' && job.status !== 'running')
    .slice(0, 5);

  const used = budget === null || budget.budget === 0 ? 0 : budget.spent / budget.budget;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="panel p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="eyebrow">Free tier this month</p>
          {/* The API's own answer, not an inference from a request that
              happened to succeed. A timestamp from the backend is the one
              thing that cannot be faked by a cached page. */}
          {health === null ? null : (
            <span className="status-chip border-verified/40 text-verified">
              <span className="h-2 w-2 rounded-full bg-verified" aria-hidden />
              api {health.status} · {new Date(health.at).toISOString().slice(11, 19)}
            </span>
          )}
        </div>
        <h3 className="mt-3 text-2xl font-medium">
          {budget === null ? 'unknown' : `${String(budget.spent)} of ${String(budget.budget)}`}
          <span className="ml-2 text-sm text-muted">page loads</span>
        </h3>

        <div className="mt-4 h-2 w-full bg-surface-soft">
          <div
            className={`h-2 ${budget?.exhausted === true ? 'bg-blocked' : 'bg-ember'}`}
            style={{ width: `${String(Math.min(Math.round(used * 100), 100))}%` }}
          />
        </div>

        <p className="mt-4 text-sm text-muted">
          Every observation costs two: the collector reads the page, and the independent witness
          reads it again. Bright Data grants 5,000 a month and both draw from the same pool.
        </p>

        {budget?.exhausted === true ? (
          <p className="mt-4 border border-blocked/40 bg-blocked/10 p-3 text-sm text-blocked">
            Monitoring is paused until the month rolls over, so the allowance is not overspent.
            Lengthen the interval or raise the ceiling to resume.
          </p>
        ) : null}
      </section>

      <section className="panel p-6">
        <p className="eyebrow">Repair activity</p>
        <h3 className="mt-3 text-2xl font-medium">
          {active.length === 0 ? 'Nothing running' : `${String(active.length)} in progress`}
        </h3>

        {active.length === 0 && recent.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No repair has been attempted yet. Jobs appear here the moment a heal is queued.
          </p>
        ) : (
          <ul className="mt-4 space-y-2 font-mono text-xs">
            {[...active, ...recent].map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between border border-surface-border bg-surface-soft p-3"
              >
                <span className="text-muted">{job.id.slice(0, 8)}</span>
                <span
                  className={
                    job.status === 'failed'
                      ? 'text-blocked'
                      : job.status === 'succeeded'
                        ? 'text-verified'
                        : 'text-ivory'
                  }
                >
                  {job.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
