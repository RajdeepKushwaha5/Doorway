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
 * The seed is repeat-safe: the NOTICE incident is created once, while the
 * controlled Doorway snapshot is refreshed in place.
 *
 * Usage:  node dist/scripts/seed-demo.js
 */

import { randomUUID } from 'node:crypto';
import { learnContract, validateRun, type Invariant } from '../src/contracts/index.js';
import { classify, synthesizeRepairPrompt, transition } from '../src/incident/index.js';
import {
  compareAcquisitionContexts,
  type AcquisitionContext,
} from '../src/shared/index.js';
import {
  compareShapes,
  hashContent,
  observeMarkdown,
  pageShape,
  reconcile,
  type WitnessFieldSpec,
} from '../src/witness/index.js';
import { FileStore, type CollectorRecord, type IncidentRecord, type RunRecord } from '../src/store/index.js';

const LIVE_URL = 'https://driftmart.example/product/headphones';
const FIXTURE_URL = 'https://driftmart.example/fixtures/baseline';
const DOORWAY_COLLECTOR_ID = 'demo-doorway-fellowship';

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

async function seedNoticeIncident(store: FileStore): Promise<void> {
  const collector: CollectorRecord = {
    id: 'demo-driftmart',
    brightDataCollectorId: 'c_demoseed01',
    autoPromote: 'never',
    freshnessMinutes: null,
    currency: 'USD',
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
  if ((await store.getCollector(collector.id)) !== null) {
    process.stdout.write('Kept the existing NOTICE drift demo unchanged.\n');
    return;
  }
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
    contentHash: hashContent(MARKDOWN),
    // The reference the witness self-check compares against. Seeded from the
    // healthy page so the demo has something to be measured against, exactly
    // as a real deployment would after its first agreed reading.
    shape: pageShape(MARKDOWN),
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
  // Both sensors read the same page from the same region on the same kind of
  // device, seconds apart. Recorded so the incident page can rule the obvious
  // alternative explanation out: this disagreement is not two sensors landing
  // on a US and a UK storefront, it is one of them reading the wrong number.
  const collectorContext: AcquisitionContext = {
    requestedUrl: LIVE_URL,
    country: 'us',
    deviceType: 'desktop',
    variantMarkers: [],
    observedAt,
  };
  const witnessContext: AcquisitionContext = {
    ...collectorContext,
    observedAt: new Date(Date.parse(observedAt) + 4000).toISOString(),
  };

  const classification = classify({ checks, reconciliation, collectorContext, witnessContext });
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
    acquisition: {
      collector: collectorContext,
      witness: witnessContext,
      alignment: compareAcquisitionContexts(collectorContext, witnessContext),
    },
    // The witness demonstrably read the same document it read when this page
    // was last verified, which is what makes the disagreement below evidence
    // rather than noise.
    pageIdentity: compareShapes(pageShape(MARKDOWN), observation.shape),
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
}

async function seedDoorwayOpportunity(store: FileStore): Promise<void> {
  const fixtureBase = (process.env['DOORWAY_LAB_URL'] ?? 'http://localhost:3002').replace(/\/$/, '');
  const sourceUrl = `${fixtureBase}/opportunity/ai-fellowship`;
  const applicationUrl = `${sourceUrl}/apply`;
  const observedAt = new Date().toISOString();
  const data = {
    title: 'Open AI Research Fellowship',
    provider: 'Doorway Research Foundation (controlled fixture)',
    opportunity_type: 'fellowship',
    summary:
      'A controlled, fully funded research fellowship for undergraduate students interested in trustworthy artificial intelligence.',
    eligibility: ['Undergraduate students interested in artificial intelligence'],
    interests: ['Artificial intelligence', 'Trustworthy AI', 'Data systems'],
    funding_level: 'fully funded',
    funding_coverage: ['tuition', 'travel', 'stipend'],
    deadline: '2026-09-18',
    deadline_raw: '18 September 2026',
    locations: ['India'],
    remote: false,
    required_documents: ['CV', 'transcript', 'research statement'],
    application_url: applicationUrl,
  };
  const invariants: Invariant[] = [
    { kind: 'required', field: 'title' },
    { kind: 'required', field: 'provider' },
    { kind: 'required', field: 'deadline' },
    { kind: 'required', field: 'application_url' },
    { kind: 'enum', field: 'opportunity_type', allowed: ['fellowship'] },
  ];
  const specs: WitnessFieldSpec[] = [
    {
      path: 'deadline',
      meaning: 'the final date on which an application can be submitted',
      labels: ['application deadline', 'deadline'],
      excludeLabels: ['notification', 'result'],
      kind: 'text',
      allowed: [],
    },
    {
      path: 'funding_level',
      meaning: 'whether the programme covers all, some, or none of the participant costs',
      labels: ['funding', 'fully funded'],
      excludeLabels: [],
      kind: 'text',
      allowed: [],
    },
    {
      path: 'eligibility',
      meaning: 'the requirements an applicant must satisfy',
      labels: ['eligibility', 'who can apply'],
      excludeLabels: [],
      kind: 'text',
      allowed: [],
    },
  ];
  const collector: CollectorRecord = {
    id: DOORWAY_COLLECTOR_ID,
    brightDataCollectorId: 'c_doorwayseed01',
    autoPromote: 'never',
    freshnessMinutes: 24 * 60,
    currency: null,
    name: 'Doorway fellowship (controlled fixture)',
    targetDomain: new URL(sourceUrl).host,
    status: 'active',
    schedule: '0 */6 * * *',
    watchUrls: [sourceUrl],
    witnessSpecs: specs,
    invariants,
    protectedFields: ['deadline', 'funding_level', 'eligibility', 'application_url'],
    goldenCases: [
      { url: sourceUrl, expected: { deadline: data.deadline }, label: 'baseline opportunity' },
    ],
    acquisitionContext: {},
    createdAt: observedAt,
  };
  await store.saveCollector(collector);

  const contract = learnContract(collector.id, [{ rows: [data], observedAt }], invariants);
  await store.saveContract(contract);
  await store.saveRun({
    id: 'seed-run-doorway-fellowship',
    collectorId: collector.id,
    brightDataSnapshotId: null,
    targetUrls: [sourceUrl],
    version: 'production',
    rows: [data],
    checks: validateRun({ rows: [data], contract }),
    durationMs: 0,
    observedAt,
  });

  const markdown = [
    '# Open AI Research Fellowship',
    '',
    'Provider: Doorway Research Foundation (controlled fixture)',
    'Application deadline: 18 September 2026',
    'Funding: Fully funded, including tuition, travel and a stipend',
    'Eligibility: Undergraduate students interested in artificial intelligence',
  ].join('\n');
  await store.saveVerifiedSnapshot({
    collectorId: collector.id,
    url: sourceUrl,
    data,
    contractVersion: contract.version,
    verifiedAt: observedAt,
    contentHash: hashContent(markdown),
    shape: pageShape(markdown),
    confirmedBy: 'contract_only',
  });

  process.stdout.write('Seeded the controlled Doorway opportunity world.\n');
  process.stdout.write(`  source: ${sourceUrl}\n`);
}

async function main(): Promise<void> {
  const store = new FileStore(process.env['NOTICE_DATA_FILE']);
  await seedNoticeIncident(store);
  await seedDoorwayOpportunity(store);
  process.stdout.write('\nThis data is local only. No Bright Data calls were made.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
