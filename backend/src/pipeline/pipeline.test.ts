import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrightDataClient } from '../brightdata/index.js';
import { learnContract, type Invariant } from '../contracts/index.js';
import { FileStore, type CollectorRecord } from '../store/index.js';
import type { WitnessFieldSpec } from '../witness/index.js';
import { buildFeed } from './feed.js';
import { observeOnce } from './observe.js';
import { attemptRepair, promoteRepair } from './repair.js';

/**
 * End-to-end hero test.
 *
 * Drives the whole loop with a fake Bright Data so it runs offline and in
 * milliseconds:
 *
 *   healthy -> baseline accepted -> page drifts -> suspicious output ->
 *   witness reads the truth -> drift classified -> repair proposed ->
 *   candidate gated -> unsafe proposal rejected -> production untouched
 *
 * The final assertion is the one that matters: a corrupted value never reaches
 * the downstream feed.
 */

const INCIDENT_URL = 'https://driftmart.test/product/headphones';
const REGRESSION_URL = 'https://driftmart.test/fixtures/baseline';

const HEALTHY_ROW = {
  price: { value: 249, currency: 'USD' },
  deposit: { value: 25, currency: 'USD' },
};
/** DriftMart `selector_drift`: schema-valid, plausible, and wrong. */
const DRIFTED_ROW = {
  price: { value: 25, currency: 'USD' },
  deposit: { value: 25, currency: 'USD' },
};

const MARKDOWN = 'Nova Headphones\n\nPurchase price: $249\nRefundable deposit: $25\n';

const SPECS: WitnessFieldSpec[] = [
  {
    path: 'price',
    meaning: 'the current non-refundable purchase price',
    labels: ['purchase price', 'price'],
    excludeLabels: ['deposit', 'refundable'],
    kind: 'money',
    allowed: [],
  },
  {
    path: 'deposit',
    meaning: 'the refundable security deposit',
    labels: ['refundable deposit', 'deposit'],
    excludeLabels: [],
    kind: 'money',
    allowed: [],
  },
];

const INVARIANTS: Invariant[] = [
  { kind: 'range', field: 'price.value', min: 1 },
  { kind: 'compare', left: 'price.value', op: '>', right: 'deposit.value' },
];

/** Scriptable stand-in for the Bright Data client. */
class FakeBrightData {
  rowsByUrl = new Map<string, unknown[]>();
  candidateRowsByUrl = new Map<string, unknown[]>();
  healPhase: 'awaiting_approval' | 'failed' = 'awaiting_approval';
  healPrompts: string[] = [];
  healInputs: string[][] = [];
  approvals = 0;

  async runCollector(
    _collectorId: string,
    urls: readonly string[],
  ): Promise<{ collectorId: string; snapshotId: string; inputUrls: string[]; rows: unknown[]; durationMs: number; version: 'production' | 'dev' }> {
    const url = urls[0] ?? '';
    return {
      collectorId: 'c_fake',
      snapshotId: 'j_fake',
      inputUrls: [...urls],
      rows: this.rowsByUrl.get(url) ?? [],
      durationMs: 12,
      version: 'production',
    };
  }

  async triggerSelfHealing(_id: string, prompt: string, urls: readonly string[]): Promise<void> {
    this.healPrompts.push(prompt);
    this.healInputs.push([...urls]);
  }

  async getHealProgress(): Promise<{ phase: string; jobId: null; previewResult: unknown[] | null; diff: null; viewUrl: null; raw: unknown }> {
    return {
      phase: this.healPhase,
      jobId: null,
      // A green preview, deliberately. The gate must not be satisfied by it.
      previewResult: [HEALTHY_ROW],
      diff: null,
      viewUrl: null,
      raw: {},
    };
  }

  async approveRepair(): Promise<void> {
    this.approvals += 1;
  }
}

function asClient(fake: FakeBrightData): BrightDataClient {
  return fake as unknown as BrightDataClient;
}

describe('NOTICE end-to-end', () => {
  let directory: string;
  let store: FileStore;
  let fake: FakeBrightData;
  let collector: CollectorRecord;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'notice-test-'));
    store = new FileStore(join(directory, 'store.json'));
    fake = new FakeBrightData();

    collector = {
      id: 'col-1',
      brightDataCollectorId: 'c_fake123',
      name: 'DriftMart headphones',
      targetDomain: 'driftmart.test',
      status: 'active',
      schedule: null,
      watchUrls: [INCIDENT_URL],
      witnessSpecs: SPECS,
      invariants: INVARIANTS,
      protectedFields: ['deposit'],
      goldenCases: [
        { url: REGRESSION_URL, expected: { 'price.value': 249 }, label: 'baseline layout' },
      ],
      acquisitionContext: {},
      createdAt: new Date().toISOString(),
    };
    await store.saveCollector(collector);

    const baseline = Array.from({ length: 10 }, (_, i) => ({
      rows: [{ ...HEALTHY_ROW, price: { value: 249 + (i % 3), currency: 'USD' } }],
      observedAt: new Date().toISOString(),
    }));
    await store.saveContract(learnContract(collector.id, baseline, INVARIANTS));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const witness = async (): Promise<{ markdown: string; fetchedAt: string }> => ({
    markdown: MARKDOWN,
    fetchedAt: new Date().toISOString(),
  });

  it('publishes healthy output without opening an incident', async () => {
    fake.rowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);
    const result = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    expect(result.incident).toBeNull();
    expect(result.publishable).toBe(true);
  });

  it('detects drift, quarantines it, and never publishes the corrupt value', async () => {
    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const result = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    expect(result.incident?.classification).toBe('extractor_drift');
    expect(result.incident?.quarantined).toBe(true);
    expect(result.publishable).toBe(false);

    const feed = await buildFeed(store, collector.id, INCIDENT_URL);
    expect(feed.health.status).not.toBe('verified');
    // The corrupted 25 must not be what a consumer receives.
    expect(JSON.stringify(feed.data)).not.toContain('"value":25,"currency":"USD"');
  });

  /**
   * Capture costs a Bright Data request and roughly 200KB per incident, so
   * when it happens is a spending decision as much as a product one.
   */
  it('captures a picture of the page only when an incident is opened', async () => {
    const captured: string[] = [];
    const capture = async (url: string): Promise<string> => {
      captured.push(url);
      return 'shot-1';
    };

    fake.rowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);
    const healthy = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
      captureScreenshot: capture,
    });
    expect(healthy.incident).toBeNull();
    expect(captured).toEqual([]);

    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const drifted = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
      captureScreenshot: capture,
    });
    expect(captured).toEqual([INCIDENT_URL]);
    expect(drifted.incident?.screenshotId).toBe('shot-1');
  });

  it('still records the incident when the capture fails', async () => {
    // An illustration is worth having and never worth failing detection for.
    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const result = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
      captureScreenshot: async () => {
        throw new Error('unlocker refused');
      },
    });

    expect(result.incident).not.toBeNull();
    expect(result.incident?.classification).toBe('extractor_drift');
    expect(result.incident?.screenshotId).toBeNull();
  });

  it('sends the incident URL to Self-Healing, which the CLI would have dropped', async () => {
    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const observed = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    await attemptRepair(collector, observed.incident!, {
      client: asClient(fake),
      store,
      runCandidate: async (_id, url) => fake.candidateRowsByUrl.get(url) ?? [],
      pollIntervalMs: 1,
      healTimeoutMs: 50,
    });

    expect(fake.healInputs[0]).toContain(INCIDENT_URL);
    expect(fake.healPrompts[0]).toContain('249');
    expect(fake.healPrompts[0]!.length).toBeLessThanOrEqual(1000);
  });

  it('rejects a repair whose preview is green but still fails the incident', async () => {
    // The exact case found on a real collector during the kill test.
    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const observed = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    fake.candidateRowsByUrl.set(INCIDENT_URL, [{ error: 'Parse error: value must be finite number' }]);
    fake.candidateRowsByUrl.set(REGRESSION_URL, [HEALTHY_ROW]);

    const outcome = await attemptRepair(collector, observed.incident!, {
      client: asClient(fake),
      store,
      runCandidate: async (_id, url) => {
        const rows = fake.candidateRowsByUrl.get(url);
        if (rows === undefined) throw new Error('not executed');
        return rows;
      },
      pollIntervalMs: 1,
      healTimeoutMs: 50,
    });

    expect(outcome.kind).toBe('rejected');
    expect(fake.approvals).toBe(0);
  });

  it('approves only when the incident recovers and regressions hold', async () => {
    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const observed = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    fake.candidateRowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);
    fake.candidateRowsByUrl.set(REGRESSION_URL, [HEALTHY_ROW]);

    const outcome = await attemptRepair(collector, observed.incident!, {
      client: asClient(fake),
      store,
      runCandidate: async (_id, url) => fake.candidateRowsByUrl.get(url) ?? [],
      pollIntervalMs: 1,
      healTimeoutMs: 50,
    });

    expect(outcome.kind).toBe('approved');
    // Still not promoted. Verification and promotion are separate steps.
    expect(fake.approvals).toBe(0);

    fake.rowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);
    const resolved = await promoteRepair(
      collector,
      (outcome as { incident: typeof observed.incident }).incident!,
      {
        client: asClient(fake),
        store,
        runCandidate: async (_id, url) => fake.candidateRowsByUrl.get(url) ?? [],
      },
      'user',
    );

    expect(fake.approvals).toBe(1);
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.quarantined).toBe(false);
  });

  it('refuses to repair a genuine source change', async () => {
    // The negative case that protects working collectors. Both sensors report
    // 229, so nothing is broken and nothing should be rewritten.
    fake.rowsByUrl.set(INCIDENT_URL, [{ ...HEALTHY_ROW, price: { value: 229, currency: 'USD' } }]);
    const observed = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: async () => ({
        markdown: MARKDOWN.replace('$249', '$229'),
        fetchedAt: new Date().toISOString(),
      }),
    });

    if (observed.incident !== null) {
      const outcome = await attemptRepair(collector, observed.incident, {
        client: asClient(fake),
        store,
        runCandidate: async () => [],
        pollIntervalMs: 1,
        healTimeoutMs: 50,
      });
      expect(outcome.kind).toBe('not_repairable');
    }
    expect(fake.healPrompts).toHaveLength(0);
  });

  it('survives a store reload without losing incident history', async () => {
    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const observed = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    const reopened = new FileStore(join(directory, 'store.json'));
    const recovered = await reopened.getIncident(observed.incident!.id);
    expect(recovered?.classification).toBe('extractor_drift');
    expect(recovered?.history.length).toBeGreaterThan(0);
  });
});

/**
 * Verified is a claim about a moment, not a permanent state.
 *
 * Bright Data's own analysis of data decay puts the useful life of a retail or
 * finance page at roughly thirty days and a social page at under one. Until
 * this existed, a snapshot with no incident against it reported `verified`
 * forever, so a collector that last ran three weeks ago looked identical to one
 * that ran five minutes ago.
 */
describe('a verified value ages out', () => {
  let directory: string;
  let store: FileStore;

  const SNAPSHOT_URL = 'https://example.com/product';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'notice-fresh-'));
    store = new FileStore(join(directory, 'store.json'));
  });

  const snapshotAgedHours = async (hours: number): Promise<void> => {
    await store.saveVerifiedSnapshot({
      collectorId: 'col-fresh',
      url: SNAPSHOT_URL,
      data: { price: 249 },
      contractVersion: 1,
      verifiedAt: new Date(Date.now() - hours * 3_600_000).toISOString(),
      contentHash: 'hash',
    });
  };

  it('stays verified inside the window', async () => {
    await snapshotAgedHours(2);
    const feed = await buildFeed(store, 'col-fresh', SNAPSHOT_URL);
    expect(feed.health.status).toBe('verified');
    expect(feed.health.stale).toBe(false);
  });

  it('becomes stale once it is older than the window', async () => {
    await snapshotAgedHours(30);
    const feed = await buildFeed(store, 'col-fresh', SNAPSHOT_URL);
    expect(feed.health.status).toBe('stale');
    expect(feed.health.stale).toBe(true);
    expect(feed.health.reason).toContain('freshness window');
  });

  it('still serves the value, because age is not a fault', async () => {
    // Withholding a slightly old price helps nobody. Saying how old it is does.
    await snapshotAgedHours(30);
    const feed = await buildFeed(store, 'col-fresh', SNAPSHOT_URL);
    expect(feed.data).toEqual({ price: 249 });
    expect(feed.health.lastVerified).not.toBeNull();
  });

  it('honours a source that decays faster than the default', async () => {
    // A follower count is stale in an hour; a retail price is not.
    await snapshotAgedHours(2);
    const feed = await buildFeed(store, 'col-fresh', SNAPSHOT_URL, { maxAgeMs: 60 * 60 * 1000 });
    expect(feed.health.status).toBe('stale');
  });

  it('reports how old the value actually is', async () => {
    await snapshotAgedHours(50);
    const feed = await buildFeed(store, 'col-fresh', SNAPSHOT_URL);
    expect(feed.health.reason).toContain('50h ago');
  });
});
