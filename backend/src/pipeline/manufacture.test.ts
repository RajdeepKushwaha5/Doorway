import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { manufactureCollector } from './manufacture.js';
import { FileStore } from '../store/index.js';
import type { BrightDataClient } from '../brightdata/index.js';
import type { ObserveEvent } from './events.js';

/**
 * Manufacturing a sensor, with Bright Data stubbed.
 *
 * Every call here is against a fake, because the real ones cost money and take
 * minutes. What is worth pinning is the order and the derivation: the page is
 * read before the brief is written, the specs come from what the page showed,
 * and the protected list is derived from the specs rather than declared beside
 * them.
 */

const PAGE = 'https://lab.test/opportunity/fellowship';

const MARKDOWN = [
  '# Open AI Research Fellowship',
  '',
  'Early interest deadline',
  '',
  '1 September 2026',
  '',
  'Application deadline',
  '',
  '18 September 2026',
  '',
  '[Start application](/opportunity/fellowship/apply)',
].join('\n');

function stubClient(steps: string[]): BrightDataClient {
  let call = 0;
  return {
    createScraperTemplate: vi.fn(async () => 'c_manufactured1'),
    generateScraper: vi.fn(async () => undefined),
    getGenerationProgress: vi.fn(async () => {
      const step = steps[Math.min(call++, steps.length - 1)] ?? 'done';
      return {
        phase: step === 'done' ? 'done' : step === 'failed' ? 'failed' : 'running',
        jobId: null,
        previewResult: null,
        diff: null,
        viewUrl: null,
        raw: { step },
      };
    }),
  } as unknown as BrightDataClient;
}

async function run(steps: string[] = ['planner', 'code_fixer', 'done']) {
  const store = new FileStore(join(await mkdtemp(join(tmpdir(), 'mf-')), 'store.json'));
  const events: ObserveEvent[] = [];
  const result = await manufactureCollector({
    url: PAGE,
    client: stubClient(steps),
    store,
    readPage: async () => ({ markdown: MARKDOWN }),
    emit: (event) => events.push({ at: new Date().toISOString(), ...event } as ObserveEvent),
    pollMs: 0,
    sleep: async () => undefined,
  });
  return { result, events, store };
}

describe('manufacturing a collector', () => {
  it('reads the page before it writes the brief', async () => {
    const { events } = await run();
    const order = events.map((e) => e.step);
    expect(order.indexOf('read')).toBeLessThan(order.indexOf('brief'));
  });

  it('writes a brief that names the label to refuse', async () => {
    const { result } = await run();
    expect(result.description).toContain('Never take it from "early interest"');
  });

  it('reports each named generation step once', async () => {
    const { events } = await run(['planner', 'planner', 'code_fixer', 'done']);
    const steps = events.filter((e) => e.step === 'generating').map((e) => e.line);
    expect(steps.filter((l) => l.includes('planner'))).toHaveLength(1);
    expect(steps.some((l) => l.includes('code_fixer'))).toBe(true);
  });

  it('derives witness specs from what the page actually showed', async () => {
    const { result } = await run();
    const paths = result.collector.witnessSpecs.map((s) => s.path);
    expect(paths).toEqual(['deadline_raw', 'application_url']);
    const deadline = result.collector.witnessSpecs[0];
    expect(deadline?.shape).toBe('date');
    expect(deadline?.excludeLabels).toContain('early interest');
  });

  it('protects only fields a second sensor can read', async () => {
    // The gap that published a listing with no way to apply was a protected
    // field with no witness spec. Deriving one from the other closes it by
    // construction rather than by remembering.
    const { result } = await run();
    expect(result.collector.protectedFields).toEqual(
      result.collector.witnessSpecs.map((s) => s.path),
    );
  });

  it('records how it was built', async () => {
    const { result } = await run();
    const p = result.collector.provenance;
    expect(p?.createdBy).toBe('coding_agent');
    expect(p?.sourceUrl).toBe(PAGE);
    expect(p?.observations.join(' ')).toContain('is labelled early interest');
    expect(p?.generationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('saves the collector so it can be run', async () => {
    const { result, store } = await run();
    const saved = await store.getCollector(result.collector.id);
    expect(saved?.brightDataCollectorId).toBe('c_manufactured1');
  });

  it('gives up rather than looping forever when generation fails', async () => {
    await expect(run(['planner', 'failed'])).rejects.toThrow(/could not build a scraper/);
  });
});
