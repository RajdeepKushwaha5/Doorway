import { extractField } from '../src/witness/extract.js';
import { reconcile } from '../src/witness/compare.js';
import { classify } from '../src/incident/classify.js';
import { registerCollectorSchema } from '../src/api/routes.js';
import type { WitnessFieldSpec, WitnessObservation } from '../src/witness/spec.js';
import type { CheckResult } from '../src/shared/index.js';

/**
 * Reproduce the blind spot, offline, in front of anybody.
 *
 * On 22 August 2026 a controlled page had its apply button removed. The
 * collector kept reporting an application URL, both sensors agreed on every
 * field either of them was looking at, and the run came back healthy. A
 * listing with no way to apply was served as confirmed by two independent
 * readings.
 *
 * Nothing had failed. `application_url` was declared protected and carried a
 * required-field rule, and it was not among the witness specs. Reconciliation
 * iterates the specs, so the one field whose absence makes a listing useless
 * was the one field no second sensor ever read.
 *
 * This script replays that with no network, no Bright Data request and no
 * credits, so the finding can be checked rather than believed. Every value
 * below is computed by the same functions production uses.
 *
 * Run with: npm run blindspot:proof
 */

const RULE = '─'.repeat(74);

function heading(n: string, text: string): void {
  console.log(`\n${RULE}\n ${n}  ${text}\n${RULE}`);
}

/** The fixture page, as Bright Data's markdown path renders it. */
const WITH_APPLY_LINK = `
# Open AI Research Fellowship

Application deadline: 18 September 2026

Funding: Fully funded

[Apply now](https://doorway-lab.onrender.com/opportunity/ai-fellowship/apply)
`.trim();

/** The same page after the apply button became a sentence. Zero links. */
const WITHOUT_APPLY_LINK = `
# Open AI Research Fellowship

Application deadline: 18 September 2026

Funding: Fully funded

Applications are open. Contact the programme team for access.
`.trim();

/**
 * What the collector reports in both cases.
 *
 * The URL is unchanged because the collector never re-derived it from the
 * page. It is well formed, and at the time of the incident it still resolved
 * to a live page, which is precisely why nothing downstream objected.
 */
const COLLECTOR_ROW = {
  deadline_raw: '18 September 2026',
  funding_level: 'Fully funded',
  application_url: 'https://doorway-lab.onrender.com/opportunity/ai-fellowship/apply',
};

const DEADLINE_SPEC: WitnessFieldSpec = {
  path: 'deadline_raw',
  meaning: 'The date applications close.',
  labels: ['application deadline', 'applications close'],
  excludeLabels: ['early interest'],
  kind: 'text',
  allowed: [],
  shape: 'date',
};

const FUNDING_SPEC: WitnessFieldSpec = {
  path: 'funding_level',
  meaning: 'How much of the cost the award covers.',
  labels: ['funding'],
  excludeLabels: [],
  kind: 'text',
  allowed: [],
};

const APPLY_SPEC: WitnessFieldSpec = {
  path: 'application_url',
  meaning: 'Where a student goes to apply. The page must show this.',
  labels: ['apply', 'application'],
  excludeLabels: [],
  kind: 'text',
  allowed: [],
  shape: 'url',
  requiredOnPage: true,
};

/** An unshaped version of the same spec, to show why the shape gate exists. */
const APPLY_SPEC_UNSHAPED: WitnessFieldSpec = {
  path: 'application_url',
  meaning: 'Where a student goes to apply.',
  labels: ['apply', 'application'],
  excludeLabels: [],
  kind: 'text',
  allowed: [],
};

function observe(markdown: string, specs: readonly WitnessFieldSpec[]): WitnessObservation {
  const values = [];
  const notFound: string[] = [];
  for (const spec of specs) {
    const found = extractField(markdown, spec);
    if (found === null) notFound.push(spec.path);
    else values.push(found);
  }
  return {
    url: 'https://doorway-lab.onrender.com/opportunity/ai-fellowship',
    fetchedAt: new Date().toISOString(),
    contentHash: 'offline-reproduction',
    excerpt: markdown.slice(0, 60),
    values,
    notFound,
    shape: { headings: [], labels: [], lines: 0, links: 0, tables: 0, images: 0, words: 0 },
  };
}

function run(markdown: string, specs: readonly WitnessFieldSpec[]) {
  const summary = reconcile(COLLECTOR_ROW, observe(markdown, specs), specs);
  const checks: readonly CheckResult[] = [];
  return { summary, classification: classify({ checks, reconciliation: summary }) };
}

function report(specs: readonly WitnessFieldSpec[], markdown: string): void {
  const { summary, classification } = run(markdown, specs);
  console.log(`   fields compared   ${specs.map((s) => s.path).join(', ')}`);
  for (const comparison of summary.comparisons) {
    const collector = String(comparison.collectorValue ?? 'not reported');
    const witness = String(comparison.witnessValue ?? 'NOT FOUND ON PAGE');
    console.log(
      `     ${comparison.path.padEnd(16)} ${comparison.agreement.kind.toUpperCase().padEnd(12)}` +
        `\n       collector  ${collector}` +
        `\n       witness    ${witness}`,
    );
  }
  console.log(`   verdict           ${classification.verdict}`);
}

console.log(`
 Reproducing a scraper that succeeded and was wrong
 No network. No Bright Data request. No credits. Every value below is
 computed by the same functions that run in production.`);

heading('01', 'The page shows an apply link. Both sensors read it.');
console.log('   page shows        [Apply now](https://doorway-lab.onrender.com/.../apply)');
report([DEADLINE_SPEC, FUNDING_SPEC, APPLY_SPEC], WITH_APPLY_LINK);

heading('02', 'The apply button is replaced by a sentence. Zero links remain.');
console.log('   page now shows    "Applications are open. Contact the programme team for access."');
console.log('   collector still reports the old URL, which is well formed and still resolves.\n');

console.log('   AS SHIPPED BEFORE THE FIX, application_url is protected but unwitnessed:');
report([DEADLINE_SPEC, FUNDING_SPEC], WITHOUT_APPLY_LINK);
console.log(
  '   A listing with no way to apply, published as confirmed by two sensors,\n' +
    '   because the only field that changed was one nobody was reading.\n',
);

console.log('   AFTER THE FIX, the same page with application_url witnessed:');
report([DEADLINE_SPEC, FUNDING_SPEC, APPLY_SPEC], WITHOUT_APPLY_LINK);

heading('03', 'Why the witness needed to learn what a link is.');
const unshaped = extractField(WITH_APPLY_LINK, APPLY_SPEC_UNSHAPED);
const shaped = extractField(WITH_APPLY_LINK, APPLY_SPEC);
console.log(`   without a shape   application_url = ${String(unshaped?.value)}`);
console.log(`   with shape: url   application_url = ${String(shaped?.value)}`);
console.log(
  '\n   "application" occurs inside "Application deadline", so a spec with no\n' +
    '   shape reads the closing date as the URL and reports drift on a page where\n' +
    '   nothing is wrong. Adding the spec without the gate is worse than not\n' +
    '   adding it at all.',
);

heading('04', 'The rule, enforced where the collector is registered.');
const base = {
  brightDataCollectorId: 'c_example1',
  name: 'Fellowship sensor',
  targetDomain: 'example.test',
  watchUrls: ['https://example.test/fellowship'],
  invariants: [],
};

const rejected = registerCollectorSchema.safeParse({
  ...base,
  witnessSpecs: [DEADLINE_SPEC, FUNDING_SPEC],
  protectedFields: ['deadline_raw', 'application_url'],
});
console.log(`   protected but unwitnessed   ${rejected.success ? 'ACCEPTED' : 'REJECTED'}`);
if (!rejected.success) console.log(`     ${rejected.error.issues[0]?.message ?? ''}`);

const accepted = registerCollectorSchema.safeParse({
  ...base,
  witnessSpecs: [DEADLINE_SPEC, FUNDING_SPEC, APPLY_SPEC],
  protectedFields: ['deadline_raw', 'application_url'],
});
console.log(`\n   protected and witnessed     ${accepted.success ? 'ACCEPTED' : 'REJECTED'}`);

console.log(`
${RULE}
 Protecting a field is a statement that publishing it wrong does harm.
 A field that matters that much cannot be one only a single sensor reads.
${RULE}
`);
