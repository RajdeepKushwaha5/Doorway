import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from '../store/index.js';
import type { CollectorRecord, RunRecord } from '../store/index.js';
import { monitoringSpend, PAGE_LOADS_PER_OBSERVATION } from './budget.js';

/**
 * Bright Data gives every account 5,000 page loads a month, and both sensors
 * draw from that one pool. Ten collectors at the default six-hour interval
 * cost about 2,400. The same ten at hourly intervals cost roughly 14,400, and
 * the only signal would be a bill, which is a bad way to learn about a default.
 */

let store: FileStore;

const NOW = new Date('2026-08-16T12:00:00.000Z');

function collector(id: string): CollectorRecord {
  return {
    id,
    brightDataCollectorId: `c_${id}`,
    name: id,
    targetDomain: 'example.com',
    status: 'active',
    schedule: '@daily',
    watchUrls: ['https://example.com/p'],
    witnessSpecs: [],
    invariants: [],
    protectedFields: [],
    goldenCases: [],
    acquisitionContext: {},
    createdAt: NOW.toISOString(),
  };
}

function run(collectorId: string, observedAt: string): RunRecord {
  return {
    id: `${collectorId}-${observedAt}`,
    collectorId,
    url: 'https://example.com/p',
    snapshotId: 'snap',
    rows: [],
    checks: [],
    observedAt,
    durationMs: 10,
  };
}

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notice-budget-'));
  store = new FileStore(join(directory, 'notice.json'));
});

describe('monitoring budget', () => {
  it('reports nothing spent when nothing has run', async () => {
    const status = await monitoringSpend(store, 4000, NOW);
    expect(status.spent).toBe(0);
    expect(status.exhausted).toBe(false);
  });

  it('charges two page loads per observation, one per sensor', async () => {
    await store.saveCollector(collector('a'));
    await store.saveRun(run('a', '2026-08-02T00:00:00.000Z'));
    await store.saveRun(run('a', '2026-08-03T00:00:00.000Z'));

    const status = await monitoringSpend(store, 4000, NOW);
    expect(status.spent).toBe(2 * PAGE_LOADS_PER_OBSERVATION);
    expect(status.remaining).toBe(4000 - 4);
  });

  it('ignores runs from a previous month, since the tier renews', async () => {
    await store.saveCollector(collector('a'));
    await store.saveRun(run('a', '2026-07-31T23:59:59.000Z'));
    await store.saveRun(run('a', '2026-08-01T00:00:00.000Z'));

    expect((await monitoringSpend(store, 4000, NOW)).spent).toBe(PAGE_LOADS_PER_OBSERVATION);
  });

  it('sums across every collector, because the pool is per account', async () => {
    await store.saveCollector(collector('a'));
    await store.saveCollector(collector('b'));
    await store.saveRun(run('a', '2026-08-05T00:00:00.000Z'));
    await store.saveRun(run('b', '2026-08-06T00:00:00.000Z'));

    expect((await monitoringSpend(store, 4000, NOW)).spent).toBe(2 * PAGE_LOADS_PER_OBSERVATION);
  });

  it('reports exhaustion once the ceiling is reached', async () => {
    await store.saveCollector(collector('a'));
    for (let i = 1; i <= 3; i++) {
      await store.saveRun(run('a', `2026-08-0${String(i)}T00:00:00.000Z`));
    }

    // Budget of 6 against 3 observations at 2 each.
    const status = await monitoringSpend(store, 6, NOW);
    expect(status.spent).toBe(6);
    expect(status.remaining).toBe(0);
    expect(status.exhausted).toBe(true);
  });

  it('never reports negative headroom', async () => {
    await store.saveCollector(collector('a'));
    for (let i = 1; i <= 5; i++) {
      await store.saveRun(run('a', `2026-08-0${String(i)}T00:00:00.000Z`));
    }

    expect((await monitoringSpend(store, 2, NOW)).remaining).toBe(0);
  });
});
