import type { RunRecord, Store } from '../store/index.js';

/**
 * Keep monitoring inside the account's free tier.
 *
 * Bright Data gives every account 5,000 page loads a month, renewed monthly,
 * and both the collector and the Web Unlocker witness draw from that one pool.
 * Monitoring is therefore not free by default: it is free until it is not, and
 * the point at which it stops being free is a number nobody watching a
 * dashboard would think to compute.
 *
 * The arithmetic is unforgiving in the wrong configuration. Every observation
 * costs two page loads, one per sensor, plus a third when an incident opens
 * and a screenshot is captured. Ten collectors on the default six-hour
 * interval spend about 2,400 a month, comfortably inside the tier. The same
 * ten at hourly intervals spend roughly 14,400, which is nearly three times
 * the allowance, and the only signal would be a bill.
 *
 * So the budget is enforced rather than documented. A hard stop that pauses
 * monitoring is recoverable and obvious; a surprise charge is neither.
 */

/** One collector run plus one witness fetch. */
export const PAGE_LOADS_PER_OBSERVATION = 2;

/**
 * Default ceiling, below the 5,000 the free tier grants.
 *
 * The headroom is deliberate. Manual runs, heal replays against the regression
 * corpus and incident screenshots all draw from the same pool without passing
 * through this counter, and a budget that only stops the scheduler after the
 * tier is already spent has stopped nothing.
 */
export const DEFAULT_MONTHLY_BUDGET = 4000;

export interface BudgetStatus {
  /** Page loads attributable to scheduled monitoring this calendar month. */
  spent: number;
  budget: number;
  remaining: number;
  /** True when the scheduler should stop observing until the month rolls. */
  exhausted: boolean;
}

/** Runs recorded in the same calendar month, in UTC, as `now`. */
function inCurrentMonth(run: RunRecord, now: Date): boolean {
  const observed = new Date(run.observedAt);
  return (
    observed.getUTCFullYear() === now.getUTCFullYear() &&
    observed.getUTCMonth() === now.getUTCMonth()
  );
}

/**
 * Estimate this month's monitoring spend from the runs already recorded.
 *
 * Derived from stored runs rather than a counter, deliberately. A counter is
 * one more piece of state to keep correct across restarts, and on a host
 * without a persistent disk it would reset on every deploy and quietly hand
 * back an allowance the account had already spent. Runs are the record of what
 * actually happened.
 *
 * @param now Injected so the month boundary is testable.
 */
export async function monitoringSpend(
  store: Store,
  budget: number = DEFAULT_MONTHLY_BUDGET,
  now: Date = new Date(),
): Promise<BudgetStatus> {
  const collectors = await store.listCollectors();

  let runs = 0;
  for (const collector of collectors) {
    // Generous limit: a month of six-hourly runs on one collector is about
    // 120, and reading too many is cheaper than undercounting the spend.
    const recent = await store.listRuns(collector.id, 500);
    runs += recent.filter((run) => inCurrentMonth(run, now)).length;
  }

  const spent = runs * PAGE_LOADS_PER_OBSERVATION;
  return {
    spent,
    budget,
    remaining: Math.max(budget - spent, 0),
    exhausted: spent >= budget,
  };
}
