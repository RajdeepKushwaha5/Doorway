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

  /*
   * The badge has to mean what it says.
   *
   * `confirmedBy` was hardcoded to `two_sensors` on every publish, so a run
   * where the witness read nothing still produced a record badged "confirmed
   * by two independent sensors". Found on a freshly manufactured collector
   * whose field names did not match its witness specs: the run's own evidence
   * said the witness could not read either field, and the published record
   * claimed both were confirmed.
   */
  it('does not claim two sensors when the witness read nothing', async () => {
    // A young collector, so the witness actually runs. With a confident
    // contract the second sensor is skipped and that path already records
    // `contract_only`; the bug lived on the path where the witness ran.
    await store.saveContract(learnContract(collector.id, [], INVARIANTS));
    fake.rowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);
    const blind = async (): Promise<{ markdown: string; fetchedAt: string }> => ({
      // A page with none of the watched fields on it, which is what a schema
      // mismatch looks like from the witness's side.
      markdown: '# Something else entirely\n\nNothing here is watched.',
      fetchedAt: new Date().toISOString(),
    });

    await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: blind,
    });

    const snapshots = await store.listVerifiedSnapshots();
    const latest = snapshots[snapshots.length - 1];
    expect(latest?.confirmedBy).toBe('contract_only');
  });

  it('claims two sensors when the witness actually agreed', async () => {
    await store.saveContract(learnContract(collector.id, [], INVARIANTS));
    fake.rowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);
    await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    const snapshots = await store.listVerifiedSnapshots();
    const latest = snapshots[snapshots.length - 1];
    expect(latest?.confirmedBy).toBe('two_sensors');
  });

  /*
   * The other half of manufacturing: a collector registered before its schema
   * could be read starts watching on the first run that returns rows.
   */
  it('promotes pending specs once a row exists to key them against', async () => {
    const unwatched: CollectorRecord = {
      ...collector,
      witnessSpecs: [],
      protectedFields: [],
      pendingWitnessSpecs: SPECS,
    };
    await store.saveCollector(unwatched);
    fake.rowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);

    await observeOnce(unwatched, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    const saved = await store.getCollector(unwatched.id);
    expect(saved?.witnessSpecs.map((s) => s.path)).toEqual(['price', 'deposit']);
    // Protected is set from the promoted specs, never separately, so a
    // protected field nobody reads cannot come into being here.
    expect(saved?.protectedFields).toEqual(['price', 'deposit']);
    expect(saved?.pendingWitnessSpecs).toBeUndefined();
  });

  it('leaves the intent alone when the run still returns nothing', async () => {
    const unwatched: CollectorRecord = {
      ...collector,
      witnessSpecs: [],
      protectedFields: [],
      pendingWitnessSpecs: SPECS,
    };
    await store.saveCollector(unwatched);
    fake.rowsByUrl.set(INCIDENT_URL, []);

    await observeOnce(unwatched, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    const saved = await store.getCollector(unwatched.id);
    expect(saved?.pendingWitnessSpecs).toHaveLength(2);
    expect(saved?.witnessSpecs).toHaveLength(0);
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

  /**
   * Breaking is only half a lifecycle.
   *
   * `resolvedAt` used to be set in exactly one place, after a promoted repair,
   * so a source that came good on its own had no route out of quarantine. A
   * reverted redesign left the collector withheld forever, serving a stale
   * value with a disagreement attached to it, and no amount of healthy runs
   * changed that.
   */
  it('closes an open incident once the source itself recovers', async () => {
    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const broken = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });
    expect(broken.incident?.quarantined).toBe(true);
    expect((await buildFeed(store, collector.id, INCIDENT_URL)).health.status).not.toBe('verified');

    // The page is fixed at source: same collector, same URL, correct row again.
    fake.rowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);
    const recovered = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    expect(recovered.incident).toBeNull();
    expect(recovered.publishable).toBe(true);

    const closed = await store.getIncident(broken.incident!.id);
    expect(closed?.resolvedAt).not.toBeNull();
    expect(closed?.quarantined).toBe(false);
    expect(closed?.history.at(-1)?.to).toBe('resolved');

    const feed = await buildFeed(store, collector.id, INCIDENT_URL);
    expect(feed.health.status).toBe('verified');
  });

  it('leaves the incident open while the source is still broken', async () => {
    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const broken = await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    await observeOnce(collector, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });

    const still = await store.getIncident(broken.incident!.id);
    expect(still?.resolvedAt).toBeNull();
    expect(still?.quarantined).toBe(true);
  });

  /**
   * The same recovery, for a collector too young to have a baseline.
   *
   * Recovery was detectable on exactly one path: every contract passes, so the
   * witness is never woken. That path is unreachable for a new source, because
   * a contract needs history before it can assert anything, so the witness is
   * woken on every run and the collector never qualifies. A source that tripped
   * one incident in its first days stayed quarantined permanently.
   *
   * The signal that closes it here is the one that opened it. Drift is declared
   * when two independent sensors read the same page and disagree, so two
   * sensors agreeing again is the answer to that exact question, and a stronger
   * one than a contract passing against the collector's own short history.
   */
  it('closes an incident on renewed agreement, with no baseline to lean on', async () => {
    const young: CollectorRecord = { ...collector, id: 'col-young', goldenCases: [] };
    await store.saveCollector(young);
    // Deliberately no learnContract call: this collector has no history.

    fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
    const broken = await observeOnce(young, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });
    expect(broken.incident?.quarantined).toBe(true);
    expect(broken.publishable).toBe(false);

    // The extractor is fixed. Both sensors now read the same page the same way.
    fake.rowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);
    const recovered = await observeOnce(young, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: witness,
    });
    expect(recovered.publishable).toBe(true);
    expect(recovered.incident?.quarantined).toBe(false);

    const closed = await store.getIncident(broken.incident!.id);
    expect(closed?.resolvedAt).not.toBeNull();
    expect(closed?.quarantined).toBe(false);
    expect(closed?.history.at(-1)?.to).toBe('resolved');

    // And the point of all of it: the row is served again.
    const feed = await buildFeed(store, young.id, INCIDENT_URL);
    expect(feed.health.status).toBe('verified');
  });

  /**
   * Blameless and still unfit to serve.
   *
   * `genuine_source_change` is a verdict about who is at fault, and it was
   * being read as permission to publish. Those are two questions. A required
   * field going missing is a statement about the row, not about the extractor,
   * and both can be true at once: the field really did vanish from the page,
   * both sensors agree that it vanished, the collector is working perfectly,
   * and the row is still not fit to serve.
   *
   * Found by removing the apply button from a live fixture. The row published
   * and the opportunity was served as fully verified, with the listing URL
   * quietly substituted for the missing application URL, so a student clicking
   * apply would have reached a page with no form on it.
   *
   * `deposit` is this collector's protected field, standing in for the apply
   * link: the one the owner declared load-bearing.
   */
  it('withholds a row whose protected field vanished, even with no one to blame', async () => {
    const guarded: CollectorRecord = {
      ...collector,
      id: 'col-protected',
      invariants: [{ kind: 'required', field: 'deposit' }],
      protectedFields: ['deposit'],
      goldenCases: [],
    };
    await store.saveCollector(guarded);

    // The field is gone from the page, so the witness cannot find it either.
    // Nobody is at fault and the row is still unusable.
    fake.rowsByUrl.set(INCIDENT_URL, [{ price: { value: 249, currency: 'USD' } }]);
    const result = await observeOnce(guarded, INCIDENT_URL, {
      client: asClient(fake),
      store,
      fetchMarkdown: async () => ({
        // The deposit line is absent from the page, so the witness cannot
        // find it either. Nobody is at fault; the row is still unusable.
        markdown: MARKDOWN.replace(/^.*deposit.*$/gim, ''),
        fetchedAt: new Date().toISOString(),
      }),
    });

    expect(result.publishable).toBe(false);
    expect(result.incident?.quarantined).toBe(true);

    // The decisive part: nothing reaches the feed as current.
    const feed = await buildFeed(store, guarded.id, INCIDENT_URL);
    expect(feed.health.status).not.toBe('verified');
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

  /*
   * The anchor case, end to end.
   *
   * Both repairs below return 249 on the incident page, which is the right
   * answer, and the older gate would have approved either one. Only one of
   * them read the labelled element.
   */
  describe('a repair that is right for the wrong reason', () => {
    const ANCHOR_URL = 'https://driftmart.test/fixtures/price_sentinel';

    beforeEach(async () => {
      collector = {
        ...collector,
        anchorCase: {
          url: ANCHOR_URL,
          expected: { 'price.value': 1337 },
          decoy: { 'price.value': 249 },
        },
      };
      await store.saveCollector(collector);

      fake.rowsByUrl.set(INCIDENT_URL, [DRIFTED_ROW]);
      fake.candidateRowsByUrl.set(INCIDENT_URL, [HEALTHY_ROW]);
      fake.candidateRowsByUrl.set(REGRESSION_URL, [HEALTHY_ROW]);
    });

    it('is rejected when it returns the decoy on the anchor page', async () => {
      const observed = await observeOnce(collector, INCIDENT_URL, {
        client: asClient(fake),
        store,
        fetchMarkdown: witness,
      });

      // Reading a position: on the anchor page the old value still sits where
      // the extractor is looking, so it returns it and looks fixed.
      fake.candidateRowsByUrl.set(ANCHOR_URL, [HEALTHY_ROW]);

      const visited: string[] = [];
      const outcome = await attemptRepair(collector, observed.incident!, {
        client: asClient(fake),
        store,
        runCandidate: async (_id, url) => {
          visited.push(url);
          return fake.candidateRowsByUrl.get(url) ?? [];
        },
        pollIntervalMs: 1,
        healTimeoutMs: 50,
      });

      expect(outcome.kind).toBe('rejected');
      // The wiring, not the rule: the anchor page has to actually be fetched,
      // or the gate is deciding on a case nobody ran.
      expect(visited).toContain(ANCHOR_URL);
      expect(fake.approvals).toBe(0);
    });

    it('is approved when it returns the token', async () => {
      const observed = await observeOnce(collector, INCIDENT_URL, {
        client: asClient(fake),
        store,
        fetchMarkdown: witness,
      });

      fake.candidateRowsByUrl.set(ANCHOR_URL, [
        { ...HEALTHY_ROW, price: { value: 1337, currency: 'USD' } },
      ]);

      const outcome = await attemptRepair(collector, observed.incident!, {
        client: asClient(fake),
        store,
        runCandidate: async (_id, url) => fake.candidateRowsByUrl.get(url) ?? [],
        pollIntervalMs: 1,
        healTimeoutMs: 50,
      });

      expect(outcome.kind).toBe('approved');
    });

    it('is rejected when the anchor page could not be reached', async () => {
      // An anchor that failed to run has proved nothing. Skipping it on error
      // would mean one flaky request is enough to promote the repair this
      // check exists to stop.
      const observed = await observeOnce(collector, INCIDENT_URL, {
        client: asClient(fake),
        store,
        fetchMarkdown: witness,
      });

      const outcome = await attemptRepair(collector, observed.incident!, {
        client: asClient(fake),
        store,
        runCandidate: async (_id, url) => {
          if (url === ANCHOR_URL) throw new Error('unlocker refused');
          return fake.candidateRowsByUrl.get(url) ?? [];
        },
        pollIntervalMs: 1,
        healTimeoutMs: 50,
      });

      expect(outcome.kind).toBe('rejected');
      expect(fake.approvals).toBe(0);
    });
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


describe('the feed does not claim a witness that never ran', () => {
  /**
   * The headline claim is that two independent Bright Data sensors agree. That
   * was asserted even when the witness was skipped: once a baseline exists and
   * every contract check passes, no Web Unlocker read happens, and the snapshot
   * was still published at 0.95 with two-sensor confirmation attached. A
   * plausible wrong value sitting inside the learned distribution could be
   * published with no second sensor ever looking at it.
   */
  it('reports contract_only when no witness read the value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'notice-prov-'));
    const store = new FileStore(join(directory, 'store.json'));

    await store.saveVerifiedSnapshot({
      collectorId: 'col-1',
      url: 'https://example.test/p',
      data: { price: 249 },
      contractVersion: 1,
      verifiedAt: new Date().toISOString(),
      contentHash: '',
      shape: null,
      confirmedBy: 'contract_only',
    });

    const feed = await buildFeed(store, 'col-1', 'https://example.test/p');

    expect(feed.health.confirmedBy).toBe('contract_only');
    expect(feed.health.confidence).toBeLessThan(0.7);
    expect(feed.health.reason).toContain('witness was not consulted');
  });

  it('reports two_sensors, and scores it higher, when the witness did read it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'notice-prov2-'));
    const store = new FileStore(join(directory, 'store.json'));

    await store.saveVerifiedSnapshot({
      collectorId: 'col-1',
      url: 'https://example.test/p',
      data: { price: 249 },
      contractVersion: 1,
      verifiedAt: new Date().toISOString(),
      contentHash: 'abc123',
      shape: null,
      confirmedBy: 'two_sensors',
    });

    const feed = await buildFeed(store, 'col-1', 'https://example.test/p');

    expect(feed.health.confirmedBy).toBe('two_sensors');
    expect(feed.health.confidence).toBe(0.95);
    expect(feed.health.reason).toBeNull();
  });

  it('reads unlabelled history as the weaker claim, never the stronger one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'notice-prov3-'));
    const store = new FileStore(join(directory, 'store.json'));

    await store.saveVerifiedSnapshot({
      collectorId: 'col-1',
      url: 'https://example.test/p',
      data: { price: 249 },
      contractVersion: 1,
      verifiedAt: new Date().toISOString(),
      contentHash: '',
      shape: null,
    });

    expect((await buildFeed(store, 'col-1', 'https://example.test/p')).health.confirmedBy).toBe(
      'contract_only',
    );
  });
});
