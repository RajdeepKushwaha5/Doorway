/**
 * Prove the central claim, live, in one command.
 *
 * NOTICE rests on one idea: two Bright Data sensors read the same page, and
 * their disagreement tells you the collector broke rather than the world
 * changing. That is easy to assert and easy to doubt. This script demonstrates
 * it against the deployed fixture, with no scripted client and no fixtures on
 * disk, so a reader can watch it happen instead of trusting a test count.
 *
 * For each mode it:
 *   1. switches DriftMart to that mode
 *   2. reads the value a selector-bound collector would read, straight from
 *      the HTML, standing in for the Scraper Studio collector
 *   3. fetches the same URL through Web Unlocker as markdown, which has no
 *      selectors to bind to
 *   4. runs the real witness extractor over that markdown
 *   5. compares the two with the same code the pipeline uses, and prints what
 *      NOTICE would decide
 *
 * Usage:
 *   npm run prove --workspace backend
 *
 * Needs BRIGHTDATA_API_KEY, BRIGHTDATA_UNLOCKER_ZONE and DRIFTMART_ADMIN_TOKEN.
 */
import { extractField } from '../src/witness/extract.js';
import { compareValues } from '../src/shared/normalize.js';
import type { WitnessFieldSpec } from '../src/witness/spec.js';

const FIXTURE = process.env['DRIFTMART_URL'] ?? 'https://driftmart-3ut8.onrender.com';
const PAGE = `${FIXTURE}/product/headphones`;

const PRICE: WitnessFieldSpec = {
  path: 'price',
  meaning: 'The purchase price of the product, not a refundable deposit.',
  labels: ['price', 'purchase price'],
  excludeLabels: ['deposit', 'refundable', 'security', 'sponsored'],
  kind: 'money',
  allowed: [],
};

/** What NOTICE concludes, given whether the page's meaning actually changed. */
interface Scenario {
  mode: string;
  /** True when the underlying fact really moved, so a repair would be wrong. */
  semanticChange: boolean;
  expect: string;
}

const SCENARIOS: readonly Scenario[] = [
  { mode: 'baseline', semanticChange: false, expect: 'sensors agree, nothing to do' },
  {
    mode: 'genuine_price_change',
    semanticChange: true,
    expect: 'sensors agree on a new value, the world changed, do NOT heal',
  },
  {
    mode: 'selector_drift',
    semanticChange: false,
    expect: 'sensors disagree, the collector broke, heal it',
  },
  {
    mode: 'silent_zero',
    semanticChange: false,
    expect: 'structured value reads 0 while the page shows 249, sensors disagree',
  },
];

async function setMode(mode: string): Promise<void> {
  const token = process.env['DRIFTMART_ADMIN_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error('DRIFTMART_ADMIN_TOKEN is not set, so the fixture cannot be switched.');
  }
  const response = await fetch(`${FIXTURE}/api/admin/mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error(`mode switch failed: ${String(response.status)}`);
}

/**
 * Sensor 1. What a collector bound to `.selling-price` extracts.
 *
 * Read from the raw HTML rather than by triggering a real collector, so this
 * runs without a Scraper Studio account and spends no credits. The selector is
 * the same one a collector binds to on the baseline layout, which is precisely
 * why it goes wrong when the layout moves.
 */
async function collectorReading(): Promise<string | null> {
  const html = await (await fetch(PAGE, { cache: 'no-store' })).text();
  const element = /<[^>]*class="selling-price"[^>]*>[^<]*</.exec(html)?.[0];
  if (element === undefined) return null;

  // A structured attribute outranks the visible text, which is what a real
  // collector does and the whole point of the silent_zero mode: the page shows
  // the right price while the machine-readable value beside it says 0.
  const attribute = /data-amount="([^"]*)"/.exec(element)?.[1];
  if (attribute !== undefined && attribute !== '') return attribute;

  return />([^<]+)</.exec(element)?.[1]?.trim() ?? null;
}

/** Sensor 2. The independent witness, with no selectors to drift. */
async function witnessReading(): Promise<{ value: unknown; line: string } | null> {
  const key = process.env['BRIGHTDATA_API_KEY'];
  const zone = process.env['BRIGHTDATA_UNLOCKER_ZONE'];
  if (key === undefined || zone === undefined) {
    throw new Error('BRIGHTDATA_API_KEY and BRIGHTDATA_UNLOCKER_ZONE are both required.');
  }

  const response = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ zone, url: PAGE, format: 'raw', data_format: 'markdown' }),
  });
  if (!response.ok) throw new Error(`unlocker failed: ${String(response.status)}`);

  const found = extractField(await response.text(), PRICE);
  return found === null ? null : { value: found.value, line: found.evidence.line };
}

async function main(): Promise<void> {
  process.stdout.write(`Fixture: ${PAGE}\n`);
  process.stdout.write('Two Bright Data sensors, same page, read against each other.\n');

  for (const scenario of SCENARIOS) {
    await setMode(scenario.mode);

    const collector = await collectorReading();
    const witness = await witnessReading();

    const comparison =
      witness === null
        ? { kind: 'incomparable' as const, note: 'the witness could not read a price' }
        : compareValues(collector, witness.value);

    // A disagreement means the collector broke. Agreement means the page is
    // telling the truth, and whether that truth moved is a separate question
    // the contract answers, not the witness.
    const verdict =
      comparison.kind === 'disagree'
        ? 'EXTRACTOR DRIFT, heal the collector'
        : comparison.kind === 'incomparable'
          ? 'INCONCLUSIVE, quarantine and ask a human'
          : scenario.semanticChange
            ? 'GENUINE SOURCE CHANGE, do not heal'
            : 'HEALTHY, publish';

    process.stdout.write(`\n${'='.repeat(64)}\n`);
    process.stdout.write(`mode        ${scenario.mode}\n`);
    process.stdout.write(`collector   ${collector ?? 'nothing'}   (bound to .selling-price)\n`);
    process.stdout.write(
      `witness     ${witness === null ? 'not found' : JSON.stringify(witness.value)}   (no selectors)\n`,
    );
    if (witness !== null) process.stdout.write(`evidence    "${witness.line}"\n`);
    process.stdout.write(`comparison  ${comparison.kind}: ${comparison.note}\n`);
    process.stdout.write(`verdict     ${verdict}\n`);
    process.stdout.write(`expected    ${scenario.expect}\n`);
  }

  // Leave the fixture as it was found. A demo that poisons the next run is
  // worse than no demo.
  await setMode('baseline');
  process.stdout.write(`\n${'='.repeat(64)}\nFixture reset to baseline.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
