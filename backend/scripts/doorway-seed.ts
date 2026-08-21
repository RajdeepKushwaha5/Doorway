/**
 * Populate a local store with Doorway opportunity sources, entirely offline.
 *
 * Makes no Bright Data calls and spends no credits. It exists so the world can
 * be opened, clicked and judged on a laptop before a single collector has been
 * created, and so a fresh clone shows a city rather than an empty field with an
 * explanation in it.
 *
 * Every record here mirrors what the controlled fixture actually serves, field
 * for field, so the seeded world and the world a real collector produces are
 * the same world. That matters: a seed that invented a nicer opportunity than
 * the fixture publishes would make the demo a lie, and would quietly diverge
 * the moment a real run replaced it.
 *
 * The provider names say "controlled fixture" for the same reason the fixture
 * page does. Doorway must never present a fabricated opportunity as a real one,
 * and a student reading this world should be able to tell at a glance which
 * doors are demonstration doors.
 *
 * Usage:  npm run doorway:seed [-- --reset]
 */

import { randomUUID } from 'node:crypto';
import { FileStore, type CollectorRecord, type VerifiedSnapshot } from '../src/store/index.js';
import type { WitnessFieldSpec } from '../src/witness/index.js';

const FIXTURE = (process.env['DRIFTMART_URL'] ?? 'http://localhost:3002').replace(/\/+$/, '');

/**
 * The fields whose meaning the witness needs, in the collector's own words.
 *
 * Deadline and funding come first because they are the two a student plans
 * around, and the two whose corruption costs them something real.
 */
const SPECS: WitnessFieldSpec[] = [
  {
    path: 'deadline_raw',
    meaning: 'the date applications close, not an early-interest or notification date',
    labels: ['application deadline', 'deadline', 'closes'],
    excludeLabels: ['early interest', 'notification', 'posted', 'announced'],
    kind: 'text',
    allowed: [],
  },
  {
    path: 'funding_level',
    meaning: 'how much of the cost the award covers',
    labels: ['funding', 'award', 'stipend'],
    excludeLabels: ['sponsored'],
    kind: 'text',
    allowed: [],
  },
  {
    path: 'title',
    meaning: 'the name of the opportunity being offered',
    labels: ['fellowship', 'scholarship', 'programme', 'program'],
    excludeLabels: ['sponsored'],
    kind: 'text',
    allowed: [],
  },
];

interface Source {
  slug: string;
  brightDataCollectorId: string;
  name: string;
  url: string;
  row: Record<string, unknown>;
  /** How this reading was confirmed, so the world shows more than one state. */
  confirmedBy: 'two_sensors' | 'contract_only';
  /** Minutes ago it was verified, so one source can read as stale. */
  agoMinutes: number;
}

/**
 * Four sources, chosen so the world shows every trust state it can produce.
 *
 * A city where everything is green teaches a viewer nothing about what the
 * colours mean.
 */
const SOURCES: Source[] = [
  {
    slug: 'ai-fellowship',
    brightDataCollectorId: 'c_doorway_lab_fellowship',
    name: 'Doorway Lab, AI Research Fellowship',
    url: `${FIXTURE}/opportunity/ai-fellowship`,
    confirmedBy: 'two_sensors',
    agoMinutes: 6,
    row: {
      title: 'Open AI Research Fellowship',
      provider: 'Doorway Research Foundation (controlled fixture)',
      opportunity_type: 'fellowship',
      summary:
        'A controlled, fully funded research fellowship for undergraduate students interested in trustworthy artificial intelligence.',
      eligibility: ['Undergraduate students interested in artificial intelligence'],
      funding_level: 'Fully funded',
      funding: { amount: 250_000, currency: 'INR', coverage: ['tuition', 'stipend'] },
      deadline: '2026-09-18',
      deadline_raw: '18 September 2026',
      locations: ['India'],
      remote: false,
      required_documents: ['CV', 'transcript', 'research statement'],
      application_url: `${FIXTURE}/opportunity/ai-fellowship/apply`,
      source_url: `${FIXTURE}/opportunity/ai-fellowship`,
    },
  },
  {
    slug: 'national-scholarship',
    brightDataCollectorId: 'c_doorway_lab_scholarship',
    name: 'Doorway Lab, National AI Scholarship',
    url: `${FIXTURE}/opportunity/ai-fellowship?variant=scholarship`,
    confirmedBy: 'two_sensors',
    agoMinutes: 22,
    row: {
      title: 'National AI Scholarship',
      provider: 'Doorway Lab Ministry of Learning (controlled fixture)',
      opportunity_type: 'scholarship',
      summary:
        'A controlled tuition scholarship for computer science undergraduates working on machine learning.',
      eligibility: ['Indian nationals', 'Undergraduate students', 'Computer science background'],
      funding: { amount: 120_000, currency: 'INR', coverage: ['tuition'] },
      deadline: '2026-11-02',
      deadline_raw: 'Applications close 2 November 2026',
      locations: ['India'],
      remote: false,
      required_documents: ['transcript', 'income certificate'],
      application_url: `${FIXTURE}/opportunity/ai-fellowship/apply`,
      source_url: `${FIXTURE}/opportunity/ai-fellowship?variant=scholarship`,
    },
  },
  {
    slug: 'robotics-internship',
    brightDataCollectorId: 'c_doorway_lab_internship',
    name: 'Doorway Lab, Robotics Internship',
    url: `${FIXTURE}/opportunity/ai-fellowship?variant=internship`,
    // Passed its contracts but the witness was not woken on this reading, so
    // the world can show what the weaker claim looks like.
    confirmedBy: 'contract_only',
    agoMinutes: 40,
    row: {
      title: 'Applied Robotics Summer Internship',
      provider: 'Doorway Lab Robotics (controlled fixture)',
      opportunity_type: 'internship',
      summary: 'A controlled paid summer internship in applied robotics and machine learning.',
      eligibility: ['Undergraduate students', 'Some programming experience'],
      funding: { amount: 60_000, currency: 'INR', coverage: ['stipend'] },
      deadline: '2026-10-10',
      deadline_raw: 'Rolling until 10 October 2026',
      locations: ['India'],
      remote: true,
      required_documents: ['CV'],
      application_url: `${FIXTURE}/opportunity/ai-fellowship/apply`,
      source_url: `${FIXTURE}/opportunity/ai-fellowship?variant=internship`,
    },
  },
  {
    slug: 'research-grant',
    brightDataCollectorId: 'c_doorway_lab_grant',
    name: 'Doorway Lab, Deep Learning Research Grant',
    url: `${FIXTURE}/opportunity/ai-fellowship?variant=grant`,
    confirmedBy: 'two_sensors',
    // Older than the default freshness window, so this one reads as stale and
    // the world shows what an unconfirmed deadline looks like.
    agoMinutes: 36 * 60,
    row: {
      title: 'Deep Learning Research Grant',
      provider: 'Doorway Lab Science Council (controlled fixture)',
      opportunity_type: 'grant',
      summary: 'A controlled research grant for deep learning work at undergraduate level.',
      eligibility: ['Undergraduate or postgraduate students', 'A named academic supervisor'],
      funding: { amount: 500_000, currency: 'INR', coverage: ['tuition', 'travel'] },
      deadline: '2027-01-15',
      deadline_raw: '15 January 2027',
      locations: ['India'],
      remote: false,
      required_documents: ['research proposal', 'supervisor letter'],
      application_url: `${FIXTURE}/opportunity/ai-fellowship/apply`,
      source_url: `${FIXTURE}/opportunity/ai-fellowship?variant=grant`,
    },
  },
];

function collectorFor(source: Source, now: Date): CollectorRecord {
  return {
    id: randomUUID(),
    brightDataCollectorId: source.brightDataCollectorId,
    name: source.name,
    targetDomain: new URL(source.url).host,
    status: 'active',
    schedule: null,
    watchUrls: [source.url],
    witnessSpecs: SPECS,
    invariants: [
      { kind: 'required', field: 'title' },
      { kind: 'required', field: 'application_url' },
    ],
    // A repair may drop neither of these. An opportunity with no deadline and
    // no way to apply is not an opportunity.
    protectedFields: ['deadline_raw', 'application_url'],
    goldenCases: [],
    acquisitionContext: {},
    autoPromote: 'never',
    freshnessMinutes: null,
    currency: 'INR',
    createdAt: now.toISOString(),
  };
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const store = new FileStore(process.env['NOTICE_DATA_FILE']);
  const now = new Date();

  const out = (line = ''): void => void process.stdout.write(`${line}\n`);

  if (reset) {
    out('Reset requested. Existing Doorway lab sources will be replaced.');
  }

  const existing = await store.listCollectors();
  let seeded = 0;

  for (const source of SOURCES) {
    const already = existing.find(
      (collector) => collector.brightDataCollectorId === source.brightDataCollectorId,
    );
    if (already !== undefined && !reset) {
      out(`  already present  ${source.name}`);
      continue;
    }

    const collector = already ?? collectorFor(source, now);
    await store.saveCollector(collector);

    const snapshot: VerifiedSnapshot = {
      collectorId: collector.id,
      url: source.url,
      data: source.row,
      contractVersion: 1,
      verifiedAt: new Date(now.getTime() - source.agoMinutes * 60_000).toISOString(),
      // No witness body was fetched offline, so there is nothing to hash.
      // Recorded as empty rather than faked.
      contentHash: '',
      shape: null,
      confirmedBy: source.confirmedBy,
    };
    await store.saveVerifiedSnapshot(snapshot);

    out(`  seeded           ${source.name}  (${source.confirmedBy})`);
    seeded += 1;
  }

  out();
  out(`Seeded ${String(seeded)} controlled opportunity source(s).`);
  out('This data is local only. No Bright Data calls were made, and every');
  out('provider is labelled as a controlled fixture so nothing here can be');
  out('mistaken for a real opportunity.');
  out();
  out('Open the world at http://localhost:3000');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
