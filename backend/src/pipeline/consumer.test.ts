import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareBestDeal } from './consumer.js';
import { FileStore, type CollectorRecord } from '../store/index.js';

/**
 * The consumer answers "which of these is the best deal?", which is the only
 * place in the system where values from different sources are ranked against
 * each other. Ranking is where a unit mismatch becomes a wrong answer that
 * still looks like an answer, so the rule that matters is the one about
 * refusing rather than the one about picking.
 */

let directory: string;
let store: FileStore;

function collector(
  id: string,
  name: string,
  url: string,
  currency: string | null = null,
): CollectorRecord {
  return {
    id,
    brightDataCollectorId: `c_${id}`,
    name,
    targetDomain: new URL(url).hostname,
    status: 'active',
    schedule: null,
    watchUrls: [url],
    witnessSpecs: [],
    invariants: [],
    protectedFields: [],
    goldenCases: [],
    acquisitionContext: {},
    autoPromote: 'never',
    freshnessMinutes: null,
    currency,
    createdAt: new Date().toISOString(),
  };
}

async function record(
  id: string,
  price: number,
  currency: string | null,
  title: string,
): Promise<void> {
  const url = (await store.getCollector(id))?.watchUrls[0] ?? '';
  // A bare number when the row states no currency, which is what a collector
  // described as returning "the price as a number" actually produces.
  const row = { title, price: currency === null ? price : { value: price, currency } };
  // A valid RunRecord. This fixture predated a refactor and still carried
  // `url`, `startedAt`, `status` and `error`, none of which are fields of the
  // record any more. It passed only because nothing read `targetUrls`, which is
  // exactly the field the per-URL pairing now depends on.
  await store.saveRun({
    id: `run-${id}`,
    collectorId: id,
    brightDataSnapshotId: null,
    targetUrls: [url],
    version: 'production',
    rows: [row],
    checks: [],
    durationMs: 10,
    observedAt: new Date().toISOString(),
  });
  await store.saveVerifiedSnapshot({
    collectorId: id,
    url,
    data: row,
    verifiedAt: new Date().toISOString(),
    runId: `run-${id}`,
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'notice-consumer-'));
  store = new FileStore(join(directory, 'store.json'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('ranking candidates for a downstream decision', () => {
  it('picks the lowest price when every candidate shares a currency', async () => {
    await store.saveCollector(collector('a', 'Store A', 'https://a.test/p'));
    await store.saveCollector(collector('b', 'Store B', 'https://b.test/p'));
    await record('a', 249, 'USD', 'Nova Headphones');
    await record('b', 199, 'USD', 'Orbit Headphones');

    const result = await compareBestDeal(store);

    expect(result.verified.pick?.price).toBe(199);
    expect(result.verified.pick?.currency).toBe('USD');
  });

  /**
   * The case this test exists for: 25 USD is a smaller number than 51.77 GBP
   * and is not a cheaper product. Answering it anyway would be inventing a fact,
   * which is the failure the rest of the system is built to prevent.
   */
  it('refuses to rank across currencies rather than comparing the bare numbers', async () => {
    await store.saveCollector(collector('a', 'DriftMart', 'https://a.test/p'));
    await store.saveCollector(collector('b', 'Books', 'https://b.test/p'));
    await record('a', 25, 'USD', 'Nova Headphones');
    await record('b', 51.77, 'GBP', 'A Light in the Attic');

    const result = await compareBestDeal(store);

    expect(result.verified.pick).toBeNull();
    expect(result.explanation.join(' ')).toMatch(/cannot be ranked without an exchange rate/);
  });

  it('names both currencies so the refusal can be acted on', async () => {
    await store.saveCollector(collector('a', 'DriftMart', 'https://a.test/p'));
    await store.saveCollector(collector('b', 'Books', 'https://b.test/p'));
    await record('a', 25, 'USD', 'Nova Headphones');
    await record('b', 51.77, 'GBP', 'A Light in the Attic');

    const joined = (await compareBestDeal(store)).explanation.join(' ');

    expect(joined).toContain('USD');
    expect(joined).toContain('GBP');
  });

  /**
   * The unguarded side must stay naive. It stands in for the ordinary query a
   * team would already have written, and softening it would make the comparison
   * flattering rather than useful.
   */
  it('still lets the unguarded pipeline pick the smaller number across currencies', async () => {
    await store.saveCollector(collector('a', 'DriftMart', 'https://a.test/p'));
    await store.saveCollector(collector('b', 'Books', 'https://b.test/p'));
    await record('a', 25, 'USD', 'Nova Headphones');
    await record('b', 51.77, 'GBP', 'A Light in the Attic');

    const result = await compareBestDeal(store);

    expect(result.unguarded.pick?.price).toBe(25);
    expect(result.diverged).toBe(true);
  });
  /**
   * `normalizeMoney` refuses to resolve `$`, because more than twenty
   * currencies use it and guessing USD is the silent wrong answer this project
   * exists to catch. It asks callers who know to pass a hint. Nobody was, so a
   * page reading $249 produced a value with no currency and rendered as a bare
   * 249 next to a properly formatted £51.77.
   */
  it('applies the currency a collector declares when the row states none', async () => {
    await store.saveCollector(collector('a', 'DriftMart', 'https://a.test/p', 'USD'));
    await record('a', 249, null, 'Nova Headphones');

    const result = await compareBestDeal(store);

    expect(result.verified.pick?.currency).toBe('USD');
  });

  it('leaves the currency null when nobody declared one, rather than assuming', async () => {
    await store.saveCollector(collector('a', 'DriftMart', 'https://a.test/p'));
    await record('a', 249, null, 'Nova Headphones');

    const result = await compareBestDeal(store);

    expect(result.verified.pick?.price).toBe(249);
    expect(result.verified.pick?.currency).toBeNull();
  });
});

describe('a collector that watches several pages', () => {
  /**
   * The comparison loaded `listRuns(collector.id, 1)` inside the per-URL loop,
   * which returns the single newest run for the whole collector. A collector
   * watching three pages therefore showed the newest page's row against all
   * three, so the product page and both fixtures displayed the same number
   * while their verified snapshots correctly differed. The screen built to
   * demonstrate the value of verification was itself built on a wrong pairing.
   */
  it('pairs each URL with the run that actually read it', async () => {
    await store.saveCollector({
      id: 'multi',
      brightDataCollectorId: 'c_multi',
      name: 'Multi page',
      targetDomain: 'example.test',
      status: 'active',
      schedule: null,
      watchUrls: ['https://example.test/a', 'https://example.test/b'],
      witnessSpecs: [
        {
          path: 'price',
          meaning: 'The purchase price.',
          labels: ['price'],
          excludeLabels: [],
          kind: 'money',
          allowed: [],
        },
      ],
      invariants: [],
      protectedFields: [],
      goldenCases: [],
      acquisitionContext: {},
      autoPromote: 'never',
      freshnessMinutes: null,
      currency: 'USD',
      createdAt: new Date().toISOString(),
    });

    const saveRun = async (id: string, url: string, price: number, at: string): Promise<void> => {
      await store.saveRun({
        id,
        collectorId: 'multi',
        brightDataSnapshotId: null,
        targetUrls: [url],
        version: 'production',
        rows: [{ title: 'Thing', price: { value: price, currency: 'USD' } }],
        checks: [],
        durationMs: 5,
        observedAt: at,
      });
    };

    await saveRun('run-a', 'https://example.test/a', 100, '2026-08-20T10:00:00.000Z');
    // Newer, and for a different page. This is the row that used to be shown
    // against both URLs.
    await saveRun('run-b', 'https://example.test/b', 200, '2026-08-20T11:00:00.000Z');

    const comparison = await compareBestDeal(store);
    const byUrl = new Map(comparison.unguarded.considered.map((c) => [c.url, c.price]));

    expect(byUrl.get('https://example.test/a')).toBe(100);
    expect(byUrl.get('https://example.test/b')).toBe(200);
  });

  it('reads the price and title a collector actually declares, not hardcoded names', async () => {
    await store.saveCollector({
      id: 'books',
      brightDataCollectorId: 'c_books',
      name: 'Books',
      targetDomain: 'books.test',
      status: 'active',
      schedule: null,
      watchUrls: ['https://books.test/one'],
      witnessSpecs: [
        {
          path: 'price_excl_tax',
          meaning: 'The price excluding tax.',
          labels: ['price excl tax'],
          excludeLabels: [],
          kind: 'money',
          allowed: [],
        },
        {
          path: 'book_title',
          meaning: 'The title of the book.',
          labels: ['title'],
          excludeLabels: [],
          kind: 'text',
          allowed: [],
        },
      ],
      invariants: [],
      protectedFields: [],
      goldenCases: [],
      acquisitionContext: {},
      autoPromote: 'never',
      freshnessMinutes: null,
      currency: 'GBP',
      createdAt: new Date().toISOString(),
    });

    await store.saveRun({
      id: 'run-books',
      collectorId: 'books',
      brightDataSnapshotId: null,
      targetUrls: ['https://books.test/one'],
      version: 'production',
      rows: [{ book_title: 'A Light in the Attic', price_excl_tax: 51.77 }],
      checks: [],
      durationMs: 5,
      observedAt: new Date().toISOString(),
    });

    const comparison = await compareBestDeal(store);
    const book = comparison.unguarded.considered.find((c) => c.collectorId === 'books');

    // Previously both of these were null, because the fields were hardcoded to
    // `price` and `title`, and this source publishes neither.
    expect(book?.price).toBe(51.77);
    expect(book?.title).toBe('A Light in the Attic');
  });
});
