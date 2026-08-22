import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpportunityIndex, seedIndex } from './index-store.js';
import type { OpportunityDraft } from '../acquire/read.js';

/**
 * Without this a crawl is a very expensive way to answer one question.
 *
 * Six hundred page loads produce a list, the request ends, and the next student
 * pays for the same six hundred fetches. Nothing accumulates and the system is
 * permanently as ignorant as it was on its first day.
 */
describe('the opportunity index', () => {
  let directory: string;
  let index: OpportunityIndex;

  const draft = (over: Partial<OpportunityDraft> = {}): OpportunityDraft => ({
    sourceUrl: 'https://a.test/fellowship',
    host: 'a.test',
    title: 'AI Research Fellowship',
    provider: 'A',
    type: 'fellowship',
    summary: 'A fellowship in artificial intelligence',
    deadlineRaw: '18 September 2026',
    fundingLevel: 'Fully funded',
    eligibility: null,
    official: true,
    foundVia: 'crawl',
    missing: [],
    sensorCount: 1,
    readAt: new Date().toISOString(),
    ...over,
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'doorway-index-'));
    index = new OpportunityIndex(join(directory, 'index.json'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps what a crawl found across restarts', async () => {
    await index.merge([draft()]);
    const reopened = new OpportunityIndex(join(directory, 'index.json'));
    expect(await reopened.all()).toHaveLength(1);
  });

  /*
   * The same programme is reachable at several URLs and a student would call
   * all of them the same thing.
   */
  it('merges the same opportunity reached by another route', async () => {
    await index.merge([draft()]);
    const second = await index.merge([draft({ sourceUrl: 'https://a.test/fellowship?ref=x' })]);

    expect(second.added).toBe(0);
    expect(second.refreshed).toBe(1);
    expect(await index.all()).toHaveLength(1);
  });

  it('remembers how often it has been seen and when it first appeared', async () => {
    await index.merge([draft()]);
    await index.merge([draft()]);
    const [record] = await index.all();

    expect(record?.timesSeen).toBe(2);
    // The newer read wins on content; only these two survive from before.
    expect(record?.firstSeenAt).toBeDefined();
    expect(record?.lastSeenAt).toBeDefined();
  });

  it('answers a search out of what it holds', async () => {
    await index.merge([
      draft(),
      draft({ sourceUrl: 'https://b.test/x', host: 'b.test', title: 'Climate Grant', type: 'grant', summary: 'climate' }),
    ]);

    const ai = await index.search(['artificial intelligence'], ['fellowship']);
    expect(ai).toHaveLength(1);
    expect(ai[0]?.title).toBe('AI Research Fellowship');

    // Asking for a type nothing matches returns nothing rather than everything.
    expect(await index.search(['artificial intelligence'], ['hackathon'])).toHaveLength(0);
  });

  it('prefers records a student can act on', async () => {
    await index.merge([
      draft({ sourceUrl: 'https://c.test/vague', host: 'c.test', title: 'AI Fellowship Vague', deadlineRaw: null, fundingLevel: null, official: false }),
      draft({ sourceUrl: 'https://d.test/full', host: 'd.test', title: 'AI Fellowship Full' }),
    ]);
    const results = await index.search(['artificial intelligence'], []);
    // A stated deadline and amount are what somebody can act on.
    expect(results[0]?.title).toBe('AI Fellowship Full');
  });

  it('reports what it holds', async () => {
    await index.merge([draft(), draft({ sourceUrl: 'https://b.test/y', host: 'b.test', title: 'Other' })]);
    const stats = await index.stats();
    expect(stats.total).toBe(2);
    expect(stats.hosts).toBe(2);
    expect(stats.withDeadline).toBe(2);
  });

  it('treats a missing index as an empty one rather than an error', async () => {
    const missing = new OpportunityIndex(join(directory, 'nope', 'index.json'));
    expect(await missing.all()).toEqual([]);
    expect((await missing.stats()).total).toBe(0);
  });
});

/**
 * The index has to survive a deploy.
 *
 * The target has no persistent disk, so every restart begins empty and the
 * first student of the day gets the product at its worst. Crawling on boot
 * would fix that and spend hundreds of paid requests each time the instance
 * wakes, which on a free tier is often.
 */
describe('shipping the index with the code', () => {
  let directory: string;

  const record = (title: string): OpportunityDraft => ({
    sourceUrl: `https://a.test/${title}`,
    host: 'a.test',
    title,
    provider: 'A',
    type: 'fellowship',
    summary: '',
    deadlineRaw: null,
    fundingLevel: null,
    eligibility: null,
    official: true,
    foundVia: 'crawl',
    missing: [],
    sensorCount: 1,
    corroboration: 'text_only',
    structuredDeadline: null,
    readAt: new Date().toISOString(),
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'doorway-seed-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('fills an empty index from a shipped file', async () => {
    const seedPath = join(directory, 'seed.json');
    await writeFile(seedPath, JSON.stringify([record('One'), record('Two')]), 'utf8');

    const index = new OpportunityIndex(join(directory, 'live.json'));
    const result = await seedIndex(index, seedPath);

    expect(result.reason).toBe('seeded');
    expect(result.seeded).toBe(2);
    expect(await index.all()).toHaveLength(2);
  });

  /*
   * The shipped copy is a cache, and a cache must never overwrite the thing it
   * caches. A live crawl that has found something newer keeps it.
   */
  it('never overwrites an index a real crawl has filled', async () => {
    const seedPath = join(directory, 'seed.json');
    await writeFile(seedPath, JSON.stringify([record('Shipped')]), 'utf8');

    const index = new OpportunityIndex(join(directory, 'live.json'));
    await index.merge([record('Found live')]);

    const result = await seedIndex(index, seedPath);
    expect(result.reason).toBe('already-populated');
    expect(result.seeded).toBe(0);

    const all = await index.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('Found live');
  });

  /* An API that refuses to boot over a missing cache would be a strange
   * thing to build. */
  it('starts fine with no seed file, or a broken one', async () => {
    const index = new OpportunityIndex(join(directory, 'live.json'));
    expect((await seedIndex(index, join(directory, 'absent.json'))).reason).toBe('no-seed-file');

    const broken = join(directory, 'broken.json');
    await writeFile(broken, '{ not json at all', 'utf8');
    expect((await seedIndex(index, broken)).reason).toBe('no-seed-file');

    expect((await seedIndex(index, undefined)).reason).toBe('no-seed-file');
  });
});
