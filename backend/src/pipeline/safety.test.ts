import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrightDataClient } from '../brightdata/index.js';
import { learnContract, type Invariant } from '../contracts/index.js';
import { evaluateGate, transition, type TransitionRecord } from '../incident/index.js';
import { FileStore, type CollectorRecord, type IncidentRecord } from '../store/index.js';
import type { WitnessFieldSpec } from '../witness/index.js';
import { observeOnce } from './observe.js';
import { promoteRepair, PromotionRefusedError } from './repair.js';

/**
 * Safety properties.
 *
 * Every test here corresponds to a claim made in the README, AGENTS.md or the
 * agent skill. They exist because those claims were previously asserted in
 * prose and in a comment, and one of them was false: `promoteRepair` passed a
 * hardcoded `from` state to `transition()`, which only validates the pair it is
 * handed, so any caller could promote an incident that never reached the gate.
 * A safety property without a test is a comment.
 */

const URL_A = 'https://driftmart.test/product/headphones';
const HEALTHY = {
  title: 'Nova Headphones',
  price: { value: 249, currency: 'USD' },
  deposit: { value: 25, currency: 'USD' },
};

const SPECS: WitnessFieldSpec[] = [
  {
    path: 'price',
    meaning: 'the current non-refundable purchase price',
    labels: ['purchase price', 'price'],
    excludeLabels: ['deposit'],
    kind: 'money',
    allowed: [],
  },
];

const INVARIANTS: Invariant[] = [
  { kind: 'required', field: 'title' },
  { kind: 'range', field: 'price.value', min: 1 },
];

const CONTRACT = learnContract(
  'col-1',
  Array.from({ length: 8 }, (_, i) => ({
    rows: [{ ...HEALTHY, price: { value: 249 + (i % 2), currency: 'USD' } }],
    observedAt: new Date().toISOString(),
  })),
  INVARIANTS,
);

class FakeBrightData {
  approvals = 0;
  rejections = 0;
  rows: unknown[] = [HEALTHY];

  async runCollector(): Promise<{ collectorId: string; snapshotId: string; inputUrls: string[]; rows: unknown[]; durationMs: number; version: 'production' | 'dev' }> {
    return {
      collectorId: 'c_x',
      snapshotId: 'j_x',
      inputUrls: [URL_A],
      rows: this.rows,
      durationMs: 5,
      version: 'production',
    };
  }
  async approveRepair(): Promise<void> {
    this.approvals += 1;
  }
  async rejectRepair(): Promise<void> {
    this.rejections += 1;
  }
}

function asClient(fake: FakeBrightData): BrightDataClient {
  return fake as unknown as BrightDataClient;
}

function collectorRecord(overrides: Partial<CollectorRecord> = {}): CollectorRecord {
  return {
    id: 'col-1',
    brightDataCollectorId: 'c_safety01',
    name: 'safety',
    targetDomain: 'driftmart.test',
    status: 'active',
    schedule: null,
    watchUrls: [URL_A],
    witnessSpecs: SPECS,
    invariants: INVARIANTS,
    protectedFields: ['title'],
    goldenCases: [],
    acquisitionContext: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function incidentAt(history: TransitionRecord[], overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: 'inc-1',
    collectorId: 'col-1',
    runId: 'run-1',
    classification: 'extractor_drift',
    confidence: 0.9,
    affectedFields: ['price'],
    evidence: [],
    witness: null,
    repairPrompt: 'fix the price',
    history,
    gateResults: [],
    quarantined: true,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    ...overrides,
  };
}

const PASSING_GATE = [
  {
    url: URL_A,
    label: 'incident',
    passed: true,
    fields: [{ path: 'price.value', expected: 249, observed: 249, agreed: true, note: 'match' }],
    executionError: null,
  },
];

describe('promotion cannot bypass the gate', () => {
  let directory: string;
  let store: FileStore;
  let fake: FakeBrightData;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'notice-safety-'));
    store = new FileStore(join(directory, 'store.json'));
    fake = new FakeBrightData();
    await store.saveCollector(collectorRecord());
    await store.saveContract(CONTRACT);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const deps = (): { client: BrightDataClient; store: FileStore; runCandidate: () => Promise<unknown[]> } => ({
    client: asClient(fake),
    store,
    runCandidate: async () => [HEALTHY],
  });

  it('refuses an incident that never reached the gate', async () => {
    // The exact bypass. Before this guard existed, this call promoted on
    // Bright Data for real and wrote a fabricated history entry.
    const incident = incidentAt([
      transition('observed', 'validating', { actor: 'system', reason: 'ingested' }),
      transition('validating', 'witness_pending', { actor: 'system', reason: 'tripped' }),
      transition('witness_pending', 'classifying', { actor: 'system', reason: 'witness' }),
      transition('classifying', 'drift_confirmed', { actor: 'system', reason: 'drift' }),
    ]);

    await expect(promoteRepair(collectorRecord(), incident, deps(), 'user')).rejects.toThrow(
      PromotionRefusedError,
    );
    expect(fake.approvals).toBe(0);
  });

  it('refuses an incident whose candidate was rejected', async () => {
    const incident = incidentAt([
      transition('observed', 'validating', { actor: 'system', reason: 'x' }),
      transition('validating', 'classifying', { actor: 'system', reason: 'x' }),
      transition('classifying', 'drift_confirmed', { actor: 'system', reason: 'x' }),
      transition('drift_confirmed', 'healing', { actor: 'system', reason: 'x' }),
      transition('healing', 'awaiting_candidate', { actor: 'brightdata', reason: 'x' }),
      transition('awaiting_candidate', 'verifying_candidate', { actor: 'system', reason: 'x' }),
      transition('verifying_candidate', 'repair_rejected', { actor: 'system', reason: 'failed' }),
    ]);

    await expect(promoteRepair(collectorRecord(), incident, deps(), 'user')).rejects.toThrow(
      /not "awaiting_approval"/,
    );
    expect(fake.approvals).toBe(0);
  });

  it('refuses when the state is right but no gate results were recorded', async () => {
    const incident = incidentAt(awaitingApprovalHistory(), { gateResults: [] });
    await expect(promoteRepair(collectorRecord(), incident, deps(), 'user')).rejects.toThrow(
      /no gate results/,
    );
    expect(fake.approvals).toBe(0);
  });

  it('refuses when a recorded gate case failed', async () => {
    const incident = incidentAt(awaitingApprovalHistory(), {
      gateResults: [
        {
          url: URL_A,
          label: 'incident',
          passed: false,
          fields: [],
          executionError: 'still failing',
        },
      ],
    });
    await expect(promoteRepair(collectorRecord(), incident, deps(), 'user')).rejects.toThrow(
      /failing case/,
    );
    expect(fake.approvals).toBe(0);
  });

  it('refuses to approve the same incident twice', async () => {
    const incident = incidentAt(
      [
        ...awaitingApprovalHistory(),
        transition('awaiting_approval', 'approving', { actor: 'user', reason: 'first' }),
      ],
      { gateResults: PASSING_GATE },
    );
    await expect(promoteRepair(collectorRecord(), incident, deps(), 'user')).rejects.toThrow(
      /already been approved/,
    );
    expect(fake.approvals).toBe(0);
  });

  it('allows promotion when state and gate both agree', async () => {
    const incident = incidentAt(awaitingApprovalHistory(), {
      gateResults: PASSING_GATE,
      witness: {
        url: URL_A,
        fetchedAt: new Date().toISOString(),
        contentHash: 'x'.repeat(64),
        excerpt: '',
        values: [],
        notFound: [],
      },
    });
    const resolved = await promoteRepair(collectorRecord(), incident, deps(), 'user');
    expect(fake.approvals).toBe(1);
    expect(resolved.history.some((step) => step.to === 'approving')).toBe(true);
  });
});

function awaitingApprovalHistory(): TransitionRecord[] {
  return [
    transition('observed', 'validating', { actor: 'system', reason: 'x' }),
    transition('validating', 'classifying', { actor: 'system', reason: 'x' }),
    transition('classifying', 'drift_confirmed', { actor: 'system', reason: 'x' }),
    transition('drift_confirmed', 'healing', { actor: 'system', reason: 'x' }),
    transition('healing', 'awaiting_candidate', { actor: 'brightdata', reason: 'x' }),
    transition('awaiting_candidate', 'verifying_candidate', { actor: 'system', reason: 'x' }),
    transition('verifying_candidate', 'awaiting_approval', { actor: 'system', reason: 'passed' }),
  ];
}

describe('the gate protects fields it was never asked to compare', () => {
  it('blocks a candidate that drops a protected field absent from expectations', () => {
    // `title` is protected but is not in `expected`. The previous gate looked
    // for protected fields among the values it had already compared, so this
    // candidate passed while silently dropping the title.
    const decision = evaluateGate({
      incident: { url: URL_A, expected: { 'price.value': 249 } },
      regression: [],
      candidateRowsByUrl: new Map([[URL_A, [{ price: { value: 249, currency: 'USD' } }]]]),
      protectedFields: ['title'],
      contract: CONTRACT,
    });

    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(' ')).toContain('title');
  });

  it('blocks a candidate that breaks a structural contract check', () => {
    // A missing required field is a `structure:` check, not an `invariant:`
    // one. The previous gate only inspected invariant failures.
    const decision = evaluateGate({
      incident: { url: URL_A, expected: { 'price.value': 249 } },
      regression: [],
      candidateRowsByUrl: new Map([[URL_A, [{ price: { value: 249, currency: 'USD' } }]]]),
      protectedFields: [],
      contract: CONTRACT,
    });

    expect(decision.approved).toBe(false);
  });

  it('still approves a candidate that keeps everything intact', () => {
    const decision = evaluateGate({
      incident: { url: URL_A, expected: { 'price.value': 249 } },
      regression: [],
      candidateRowsByUrl: new Map([[URL_A, [HEALTHY]]]),
      protectedFields: ['title'],
      contract: CONTRACT,
    });
    expect(decision.approved).toBe(true);
  });
});

describe('observation degrades safely', () => {
  let directory: string;
  let store: FileStore;
  let fake: FakeBrightData;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'notice-observe-'));
    store = new FileStore(join(directory, 'store.json'));
    fake = new FakeBrightData();
    await store.saveCollector(collectorRecord());
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('turns a witness failure into a quarantined inconclusive incident', async () => {
    // Previously this threw, leaving the suspicious run unrecorded and the
    // downstream feed serving as though nothing had happened.
    await store.saveContract(CONTRACT);
    fake.rows = [{ ...HEALTHY, price: { value: 0, currency: 'USD' } }];

    const result = await observeOnce(collectorRecord(), URL_A, {
      client: asClient(fake),
      store,
      fetchMarkdown: async () => {
        throw new Error('bdata not found on PATH');
      },
    });

    expect(result.incident?.classification).toBe('inconclusive');
    expect(result.incident?.quarantined).toBe(true);
    expect(result.publishable).toBe(false);
    expect(result.incident?.evidence.join(' ')).toContain('bdata not found');
  });

  it('never publishes a collector with no baseline on contract checks alone', async () => {
    // With no baseline the statistical checks report `unknown`, so an earlier
    // version saw "nothing failed", skipped the witness entirely and stored
    // the very first result as verified. A corrupt first run would then become
    // the last-known-good value every later quarantine falls back to.
    //
    // The rule now is that an unbaselined collector always requires a witness.
    // Publication is possible, but only on independent confirmation, never on
    // the absence of a complaint.
    let witnessFetched = false;

    await observeOnce(collectorRecord(), URL_A, {
      client: asClient(fake),
      store,
      fetchMarkdown: async () => {
        witnessFetched = true;
        return {
          markdown: 'Nova Headphones\n\nPurchase price: $249\n',
          fetchedAt: new Date().toISOString(),
        };
      },
    });

    expect(witnessFetched).toBe(true);
  });

  it('publishes an unbaselined collector only when the witness confirms it', async () => {
    const result = await observeOnce(collectorRecord(), URL_A, {
      client: asClient(fake),
      store,
      fetchMarkdown: async () => ({
        markdown: 'Nova Headphones\n\nPurchase price: $249\n',
        fetchedAt: new Date().toISOString(),
      }),
    });

    // Collector says 249, witness reads 249 from a labelled line. That is
    // independent confirmation, which is better evidence than a learned
    // baseline, not worse.
    expect(result.publishable).toBe(true);
  });

  it('withholds an unbaselined collector when the witness disagrees', async () => {
    fake.rows = [{ ...HEALTHY, price: { value: 25, currency: 'USD' } }];

    const result = await observeOnce(collectorRecord(), URL_A, {
      client: asClient(fake),
      store,
      fetchMarkdown: async () => ({
        markdown: 'Nova Headphones\n\nPurchase price: $249\nRefundable deposit: $25\n',
        fetchedAt: new Date().toISOString(),
      }),
    });

    expect(result.publishable).toBe(false);
    expect(await store.getVerifiedSnapshot('col-1', URL_A)).toBeNull();
  });
});
