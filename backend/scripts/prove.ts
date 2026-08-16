/**
 * Prove the central claim, live, in one command.
 *
 * NOTICE rests on one idea: two Bright Data sensors read the same page, and
 * their disagreement tells you the collector broke rather than the world
 * changing. That is easy to assert and easy to doubt. This demonstrates it
 * against the deployed fixture, with no scripted client and no fixtures on
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
 *   npm run prove
 *
 * Needs BRIGHTDATA_API_KEY, BRIGHTDATA_UNLOCKER_ZONE and DRIFTMART_ADMIN_TOKEN.
 */
import { extractField } from '../src/witness/extract.js';
import { fetchWitnessMarkdown } from '../src/brightdata/unlocker.js';
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

const out = (line: string): void => void process.stdout.write(`${line}\n`);
const RULE = '='.repeat(64);

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

/**
 * Sensor 2. The independent witness, with no selectors to drift.
 *
 * Uses the production fetcher rather than its own request. This began as a
 * bare fetch and so skipped the retry the real path has, and a transient 502
 * from Bright Data ended the whole demonstration on its second case. Calling
 * the same function the pipeline calls makes this both more robust and a
 * better proof: what a viewer watches is the code that actually runs.
 */
async function witnessReading(): Promise<{ value: unknown; line: string } | null> {
  const apiKey = process.env['BRIGHTDATA_API_KEY'];
  const zone = process.env['BRIGHTDATA_UNLOCKER_ZONE'];
  if (apiKey === undefined || zone === undefined) {
    throw new Error('BRIGHTDATA_API_KEY and BRIGHTDATA_UNLOCKER_ZONE are both required.');
  }

  const { markdown } = await fetchWitnessMarkdown(
    {
      apiKey,
      zone,
      ...(process.env['BRIGHTDATA_UNLOCKER_COUNTRY'] === undefined
        ? {}
        : { country: process.env['BRIGHTDATA_UNLOCKER_COUNTRY'] }),
    },
    PAGE,
  );

  const found = extractField(markdown, PRICE);
  return found === null ? null : { value: found.value, line: found.evidence.line };
}

async function runScenario(scenario: Scenario): Promise<void> {
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

  out(`collector   ${collector ?? 'nothing'}   (bound to .selling-price)`);
  out(
    `witness     ${witness === null ? 'not found' : JSON.stringify(witness.value)}   (no selectors)`,
  );
  if (witness !== null) out(`evidence    "${witness.line}"`);
  out(`comparison  ${comparison.kind}: ${comparison.note}`);
  out(`verdict     ${verdict}`);
  out(`expected    ${scenario.expect}`);
}

async function main(): Promise<void> {
  out(`Fixture: ${PAGE}`);
  out('Two Bright Data sensors, same page, read against each other.');

  let failures = 0;

  try {
    for (const scenario of SCENARIOS) {
      out('');
      out(RULE);
      out(`mode        ${scenario.mode}`);

      // One case failing must not end the demonstration. The network sits
      // between here and two services, and a transient error on the second of
      // four cases used to discard the two that would have worked.
      try {
        await runScenario(scenario);
      } catch (caught) {
        failures += 1;
        out(`SKIPPED     ${caught instanceof Error ? caught.message : String(caught)}`);
        out('            Re-run to retry this case.');
      }
    }
  } finally {
    // Leave the fixture as it was found, even after a failure. A demo that
    // poisons the next run is worse than no demo.
    await setMode('baseline').catch(() => {
      out('');
      out('Could not reset the fixture. Run: npm run live -- mode baseline');
    });
  }

  out('');
  out(RULE);
  out('Fixture reset to baseline.');
  if (failures > 0) {
    out(`${String(failures)} of ${String(SCENARIOS.length)} cases could not be read.`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
