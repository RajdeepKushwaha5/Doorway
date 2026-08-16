import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from './file-store.js';
import { seedCollectors } from './seed.js';
import type { CollectorRecord } from './types.js';

/**
 * Free hosting tiers have no persistent disk, so the store resets on every
 * restart and every wake from idle. An empty dashboard is indistinguishable
 * from a broken product to whoever opens the link, so the fleet restores
 * itself. The two things that matter are that it never overwrites a curated
 * fleet, and that it never stops the server booting.
 */

let store: FileStore;
let directory: string;

const entry = {
  brightDataCollectorId: 'c_seeded',
  name: 'Seeded source',
  targetDomain: 'example.com',
  schedule: 'every 6 hours',
  watchUrls: ['https://example.com/p'],
  witnessSpecs: [],
  invariants: [],
  protectedFields: [],
  goldenCases: [],
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'notice-seed-'));
  store = new FileStore(join(directory, 'notice.json'));
});

async function seedFile(contents: unknown): Promise<string> {
  const path = join(directory, 'seed.json');
  await writeFile(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return path;
}

describe('seeding an empty store', () => {
  it('registers the fleet when nothing is there', async () => {
    const result = await seedCollectors(store, await seedFile([entry]));
    expect(result).toMatchObject({ seeded: 1, reason: 'seeded' });

    const [collector] = await store.listCollectors();
    expect(collector?.brightDataCollectorId).toBe('c_seeded');
    expect(collector?.status).toBe('active');
    // Non-null, or the scheduler's isDue check skips it and autonomous
    // monitoring silently never happens.
    expect(collector?.schedule).not.toBeNull();
  });

  it('never overwrites a fleet somebody curated', async () => {
    await store.saveCollector({
      ...entry,
      id: 'existing',
      brightDataCollectorId: 'c_mine',
      status: 'active',
      acquisitionContext: {},
      createdAt: new Date().toISOString(),
    } as CollectorRecord);

    const result = await seedCollectors(store, await seedFile([entry]));
    expect(result.reason).toBe('store-not-empty');
    expect((await store.listCollectors()).map((c) => c.brightDataCollectorId)).toEqual(['c_mine']);
  });

  it('does nothing when no seed file is configured', async () => {
    expect(await seedCollectors(store, undefined)).toMatchObject({ reason: 'no-seed-file' });
    expect(await seedCollectors(store, '   ')).toMatchObject({ reason: 'no-seed-file' });
  });

  it('survives a missing file, because an API must not refuse to boot over demo data', async () => {
    const result = await seedCollectors(store, join(directory, 'absent.json'));
    expect(result).toMatchObject({ seeded: 0, reason: 'unreadable' });
  });

  it('survives a malformed file', async () => {
    expect(await seedCollectors(store, await seedFile('{not json'))).toMatchObject({
      reason: 'unreadable',
    });
    expect(await seedCollectors(store, await seedFile({ not: 'an array' }))).toMatchObject({
      reason: 'unreadable',
    });
  });

  it('skips entries with no collector id rather than failing the whole seed', async () => {
    const result = await seedCollectors(store, await seedFile([{ name: 'broken' }, entry]));
    expect(result.seeded).toBe(1);
  });
});
