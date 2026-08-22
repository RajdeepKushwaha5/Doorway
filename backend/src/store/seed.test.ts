import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  /**
   * The seed file is hand-edited JSON, parsed rather than validated, so a
   * setting left out of it is `undefined` however confidently the record type
   * says otherwise. That is not cosmetic: `autoPromote` decides whether a
   * collector repairs itself unattended, and a missing value silently disabled
   * the automation on every seeded source.
   */
  it('fills in settings the file leaves out, so a seeded record is complete', async () => {
    await seedCollectors(store, await seedFile([entry]));
    const [seeded] = await store.listCollectors();

    expect(seeded?.autoPromote).toBe('never');
    expect(seeded?.freshnessMinutes).toBeNull();
  });

  it('carries the settings through when the file does state them', async () => {
    await seedCollectors(
      store,
      await seedFile([{ ...entry, autoPromote: 'on_gate_pass', freshnessMinutes: 90 }]),
    );
    const [seeded] = await store.listCollectors();

    expect(seeded?.autoPromote).toBe('on_gate_pass');
    expect(seeded?.freshnessMinutes).toBe(90);
  });

  it('refuses an unrecognised automation setting instead of trusting the file', async () => {
    await seedCollectors(
      store,
      await seedFile([{ ...entry, autoPromote: 'always', freshnessMinutes: -5 }]),
    );
    const [seeded] = await store.listCollectors();

    expect(seeded?.autoPromote).toBe('never');
    expect(seeded?.freshnessMinutes).toBeNull();
  });
});

describe('repeat-safe runtime records', () => {
  it('updates a run with the same identity instead of duplicating it', async () => {
    const original = {
      id: 'stable-run',
      collectorId: 'collector',
      brightDataSnapshotId: null,
      targetUrls: ['https://example.com/original'],
      version: 'production' as const,
      rows: [{ title: 'Original' }],
      checks: [],
      durationMs: 0,
      observedAt: '2026-08-21T00:00:00.000Z',
    };

    await store.saveRun(original);
    await store.saveRun({
      ...original,
      targetUrls: ['https://example.com/corrected'],
      rows: [{ title: 'Corrected' }],
    });

    expect(await store.listRuns('collector')).toHaveLength(1);
    expect(await store.getRun('stable-run')).toMatchObject({
      targetUrls: ['https://example.com/corrected'],
      rows: [{ title: 'Corrected' }],
    });
  });
});

/**
 * A seed pointing at the wrong host is worse than no seed at all.
 *
 * The file used to hardcode the fixture's hostname. A fresh deploy came up
 * seeding collectors aimed at the previous deployment: they registered
 * cleanly, reported healthy, and watched a host that had nothing to do with
 * that instance. An empty dashboard announces itself. This does not.
 */
describe('seed file substitution', () => {
  it('fills host placeholders from the environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'notice-seed-env-'));
    const store = new FileStore(join(directory, 'store.json'));
    const file = join(directory, 'seed.json');

    await writeFile(
      file,
      JSON.stringify([
        {
          brightDataCollectorId: 'c_test',
          name: 'lab',
          targetDomain: '${TEST_LAB_HOST}',
          schedule: null,
          watchUrls: ['${TEST_LAB_URL}/opportunity/ai-fellowship'],
          witnessSpecs: [],
          invariants: [],
          protectedFields: [],
          goldenCases: [],
        },
      ]),
      'utf8',
    );

    process.env['TEST_LAB_URL'] = 'https://lab.example';
    process.env['TEST_LAB_HOST'] = 'lab.example';
    try {
      const result = await seedCollectors(store, file);
      expect(result.seeded).toBe(1);

      const [collector] = await store.listCollectors();
      expect(collector?.watchUrls[0]).toBe('https://lab.example/opportunity/ai-fellowship');
      expect(collector?.targetDomain).toBe('lab.example');
    } finally {
      delete process.env['TEST_LAB_URL'];
      delete process.env['TEST_LAB_HOST'];
      await rm(directory, { recursive: true, force: true });
    }
  });

  /*
   * An unset variable is left visible rather than blanked. A URL still showing
   * ${DOORWAY_LAB_URL} is obviously unconfigured; https:///opportunity/... looks
   * like a bug somewhere else entirely.
   */
  it('leaves an unset variable visible instead of blanking it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'notice-seed-env2-'));
    const store = new FileStore(join(directory, 'store.json'));
    const file = join(directory, 'seed.json');

    await writeFile(
      file,
      JSON.stringify([
        {
          brightDataCollectorId: 'c_test',
          name: 'lab',
          targetDomain: 'example.test',
          schedule: null,
          watchUrls: ['${DEFINITELY_NOT_SET_ANYWHERE}/page'],
          witnessSpecs: [],
          invariants: [],
          protectedFields: [],
          goldenCases: [],
        },
      ]),
      'utf8',
    );

    try {
      await seedCollectors(store, file);
      const [collector] = await store.listCollectors();
      expect(collector?.watchUrls[0]).toBe('${DEFINITELY_NOT_SET_ANYWHERE}/page');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
