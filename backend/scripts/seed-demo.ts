/**
 * Seed the local store with a realistic incident, entirely offline.
 *
 * Makes no Bright Data calls and spends no credits. Exists so the dashboard
 * can be reviewed and the demo rehearsed without waiting on a live collector
 * run, and so a fresh clone shows something other than three empty states.
 *
 * The data mirrors the DriftMart `selector_drift` mode: a collector that reads
 * the refundable deposit as the purchase price, caught by the witness.
 *
 * Usage:  node dist/scripts/seed-demo.js [--reset]
 */

import { randomUUID } from 'node:crypto';
import { learnContract, validateRun, type Invariant } from '../src/contracts/index.js';
import { classify, synthesizeRepairPrompt, transition } from '../src/incident/index.js';
import { observeMarkdown, reconcile, type WitnessFieldSpec } from '../src/witness/index.js';
import { FileStore, type CollectorRecord, type IncidentRecord, type RunRecord } from '../src/store/index.js';

const LIVE_URL = 'https://driftmart.example/product/headphones';
const FIXTURE_URL = 'https://driftmart.example/fixtures/baseline';

const HEALTHY = {
  title: 'Nova Headphones',
  price: { value: 249, currency: 'USD' },
  deposit: { value: 25, currency: 'USD' },
  availability: 'in_stock',
  sku: 'NOVA-001',
};

/** Schema-valid, plausible, and wrong: the deposit read as the price. */
const DRIFTED = { ...HEALTHY, price: { value: 25, currency: 'USD' } };

const MARKDOWN = [
  '# DriftMart',
  '',
  'Nova Headphones',
  '',
  'Purchase price: $249',
  'Refundable deposit: $25',
  'Availability: In stock',
].join('\n');

const SPECS: WitnessFieldSpec[] = [
  {
    path: 'title',
    meaning: 'the product title',
    labels: ['Nova Headphones', 'product'],
    excludeLabels: [],
    kind: 'text',
    allowed: [],
  },
  {
    path: 'price',
    meaning: 'the current non-refundable purchase price',
    labels: ['purchase price', 'price'],
    excludeLabels: ['deposit', 'refundable', 'mrp', 'was'],
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
  {
    path: 'availability',
    meaning: 'whether the item can be bought now',
    labels: ['availability', 'in stock'],
    excludeLabels: [],
    kind: 'enum',
    allowed: ['in_stock', 'out_of_stock', 'preorder'],
  },
];

const INVARIANTS: Invariant[] = [
  { kind: 'required', field: 'title' },
  { kind: 'range', field: 'price.value', min: 1 },
  { kind: 'compare', left: 'price.value', op: '>', right: 'deposit.value' },
  { kind: 'currency', field: 'price', allowed: ['USD'] },
  { kind: 'enum', field: 'availability', allowed: ['in_stock', 'out_of_stock', 'preorder'] },
];

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function main(): Promise<void> {
  const store = new FileStore(process.env['NOTICE_DATA_FILE']);

  const collector: CollectorRecord = {
    id: 'demo-driftmart',
    brightDataCollectorId: 'c_demoseed01',
    autoPromote: 'never',
    name: 'DriftMart headphones',
    targetDomain: 'driftmart.example',
    status: 'active',
    schedule: '0 */6 * * *',
    watchUrls: [LIVE_URL],
    witnessSpecs: SPECS,
    invariants: INVARIANTS,
    protectedFields: ['title', 'deposit', 'availability'],
    goldenCases: [
      { url: FIXTURE_URL, expected: { 'price.value': 249 }, label: 'baseline layout' },
    ],
    acquisitionContext: {},
    createdAt: minutesAgo(600),
  };
  await store.saveCollector(collector);

  // Twelve accepted baseline runs, with a little natural price variation so
  // the learned profile has a real spread rather than a constant.
  const baselineRuns = Array.from({ length: 12 }, (_, index) => ({
    rows: [{ ...HEALTHY, price: { value: 249 + (index % 3), currency: 'USD' } }],
    observedAt: minutesAgo(600 - index * 45),
  }));
  const contract = learnContract(collector.id, baselineRuns, INVARIANTS);
  await store.saveContract(contract);

  for (const [index, baseline] of baselineRuns.entries()) {
    const run: RunRecord = {
      id: `seed-run-${String(index)}`,
      collectorId: collector.id,
      brightDataSnapshotId: `j_seed${String(index)}`,
      targetUrls: [LIVE_URL],
      version: 'production',
      rows: [...baseline.rows],
      checks: validateRun({ rows: baseline.rows, contract }),
      durationMs: 3400 + index * 20,
      observedAt: baseline.observedAt,
    };
    await store.saveRun(run);
  }

  await store.saveVerifiedSnapshot({
    collectorId: collector.id,
    url: LIVE_URL,
    data: HEALTHY,
    contractVersion: contract.version,
    verifiedAt: minutesAgo(50),
    contentHash: '',
  });

  // Now the drift.
  const observedAt = minutesAgo(6);
  const checks = validateRun({ rows: [DRIFTED], contract });

  const driftRun: RunRecord = {
    id: 'seed-run-drift',
    collectorId: collector.id,
    brightDataSnapshotId: 'j_seeddrift',
    targetUrls: [LIVE_URL],
    version: 'production',
    rows: [DRIFTED],
    checks,
    durationMs: 3610,
    observedAt,
  };
  await store.saveRun(driftRun);

  const observation = observeMarkdown(LIVE_URL, MARKDOWN, SPECS, observedAt);
  const reconciliation = reconcile(DRIFTED, observation, SPECS);
  const classification = classify({ checks, reconciliation });
  const prompt = synthesizeRepairPrompt({
    classification,
    reconciliation,
    specs: SPECS,
    protectedFields: collector.protectedFields,
  });

  const history = [
    transition('observed', 'validating', { actor: 'system', reason: 'collector run ingested' }),
    transition('validating', 'witness_pending', {
      actor: 'system',
      reason: 'price.value violates "price.value > deposit.value"',
    }),
    transition('witness_pending', 'classifying', {
      actor: 'system',
      reason: `witness observed ${String(observation.values.length)} fields`,
      evidenceRefs: [observation.contentHash],
    }),
    transition('classifying', 'drift_confirmed', {
      actor: 'system',
      reason: classification.evidence[0] ?? 'extractor drift',
    }),
    transition('drift_confirmed', 'healing', {
      actor: 'system',
      reason: 'evidence-backed diagnosis synthesized',
    }),
    transition('healing', 'awaiting_candidate', {
      actor: 'brightdata',
      reason: 'self-healing job accepted, incident URL sent in custom_input',
    }),
    transition('awaiting_candidate', 'verifying_candidate', {
      actor: 'system',
      reason: 'checking the proposed repair against the incident and the regression corpus',
    }),
    transition('verifying_candidate', 'repair_rejected', {
      actor: 'system',
      reason: 'the candidate still returns the deposit on the incident page',
    }),
  ];

  const incident: IncidentRecord = {
    id: randomUUID(),
    collectorId: collector.id,
    runId: driftRun.id,
    classification: classification.verdict,
    confidence: classification.confidence,
    affectedFields: classification.affectedFields,
    evidence: classification.evidence,
    witness: observation,
    screenshotId: null,
    repairPrompt: prompt.text,
    history,
    gateResults: [
      {
        url: LIVE_URL,
        label: 'incident',
        passed: false,
        fields: [
          {
            path: 'price.value',
            expected: 249,
            observed: 25,
            agreed: false,
            note: 'numeric mismatch: collector 25, expected 249',
          },
        ],
        executionError: null,
      },
      {
        url: FIXTURE_URL,
        label: 'baseline layout',
        passed: true,
        fields: [
          { path: 'price.value', expected: 249, observed: 249, agreed: true, note: 'numeric match (249)' },
        ],
        executionError: null,
      },
    ],
    quarantined: true,
    createdAt: observedAt,
    resolvedAt: null,
  };
  await store.saveIncident(incident);

  await store.appendAudit({
    id: randomUUID(),
    actor: 'system',
    eventType: 'incident.extractor_drift',
    entityId: incident.id,
    payload: { evidence: classification.evidence },
    at: observedAt,
  });

  process.stdout.write('Seeded a demo collector and one open drift incident.\n');
  process.stdout.write(`  verdict:  ${classification.verdict}\n`);
  process.stdout.write(`  incident: ${incident.id}\n`);
  process.stdout.write(`  baseline: ${String(contract.sampleCount)} runs, confidence ${contract.confidence.toFixed(2)}\n`);
  process.stdout.write('\nThis data is local only. No Bright Data calls were made.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
