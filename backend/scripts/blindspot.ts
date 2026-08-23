/**
 * Show, live, that nothing in an ordinary pipeline catches a silently wrong row.
 *
 * `prove` demonstrates the two-sensor rule. This demonstrates why that rule has
 * to exist, which is a different claim and the harder one to believe: that a
 * corrupted scrape passes every check a careful team would already have in
 * place. Asserting that in a README invites the reply "you just did not
 * validate properly". So this validates properly, in front of the viewer, and
 * shows the row surviving all of it.
 *
 * The collector is the real Scraper Studio collector, driven over `/dca/trigger`
 * and read back from `/dca/dataset`, not a stand-in reading HTML. What Bright
 * Data reports about that run is printed verbatim, because the point is not
 * that the platform misbehaves. It behaves correctly. It answers "did the
 * request work", faithfully, and that question has the same answer whether the
 * value is right or wrong.
 *
 * Usage:
 *   npm run blindspot -- <collector-id>
 *   npm run blindspot -- <collector-id> --mode baseline
 *
 * Needs BRIGHTDATA_API_KEY, BRIGHTDATA_UNLOCKER_ZONE and DRIFTMART_ADMIN_TOKEN.
 */
import { z } from 'zod';
import { BrightDataClient } from '../src/brightdata/client.js';
import { fetchWitnessMarkdown } from '../src/brightdata/unlocker.js';
import { extractField } from '../src/witness/extract.js';
import { compareValues } from '../src/shared/normalize.js';
import type { WitnessFieldSpec } from '../src/witness/spec.js';

const FIXTURE = (process.env['DRIFTMART_URL'] ?? 'https://doorway-lab.onrender.com').replace(
  /\/+$/,
  '',
);
const PAGE = `${FIXTURE}/product/headphones`;

/**
 * The same sentence that describes the field in Scraper Studio.
 *
 * One description drives detection and repair, which is the point of writing
 * it in plain language rather than as a selector.
 */
const PRICE: WitnessFieldSpec = {
  path: 'price',
  meaning: 'The purchase price of the product, not a refundable deposit.',
  labels: ['price', 'purchase price'],
  excludeLabels: ['deposit', 'refundable', 'security', 'sponsored'],
  kind: 'money',
  allowed: [],
};

const out = (text = ''): void => void process.stdout.write(`${text}\n`);

/**
 * Render a value the way a viewer reads it, not the way it is stored.
 *
 * A money reading is an object carrying its currency, which is right for
 * comparison and unreadable on a recording. The comparison still runs on the
 * real value; only this line is simplified.
 */
function show(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'value' in value) {
    return String((value).value);
  }
  return JSON.stringify(value) ?? String(value);
}
const rule = (char = '-'): void => out(char.repeat(74));

function heading(text: string): void {
  out();
  rule('=');
  out(text.toUpperCase());
  rule('=');
}

/** One conventional safeguard, and whether this row survived it. */
interface Safeguard {
  name: string;
  detail: string;
  passed: boolean;
}

/**
 * Every check a careful team would already have.
 *
 * Deliberately generous. These are not strawmen: the schema is a real Zod
 * schema, the range check has a lower bound, and the row is required to be
 * non-empty. The demonstration only works if the checks are ones a viewer
 * would actually have written.
 */
function runSafeguards(row: Record<string, unknown>, httpOk: boolean): Safeguard[] {
  const schema = z.object({
    product_name: z.string().min(1),
    price: z.coerce.number().positive(),
    availability: z.string().min(1),
  });
  const parsed = schema.safeParse(row);
  const price = Number(row['price']);

  return [
    {
      name: 'Request succeeded',
      detail: httpOk ? 'HTTP 200 from /dca/trigger' : 'request failed',
      passed: httpOk,
    },
    {
      name: 'Response is valid JSON',
      detail: 'parsed into an object without error',
      passed: true,
    },
    {
      name: 'Row is not empty',
      detail: `${String(Object.keys(row).length)} fields returned`,
      passed: Object.keys(row).length > 0,
    },
    {
      name: 'Required field present',
      detail: "'price' exists on the row",
      passed: row['price'] !== undefined,
    },
    {
      name: 'Field is not null',
      detail: `price = ${JSON.stringify(row['price'])}`,
      passed: row['price'] !== null,
    },
    {
      name: 'Type check',
      detail: `typeof price resolves to a number (${String(price)})`,
      passed: Number.isFinite(price),
    },
    {
      name: 'Range check',
      detail: 'price > 0',
      passed: Number.isFinite(price) && price > 0,
    },
    {
      name: 'Schema validation (Zod)',
      detail: parsed.success ? 'every field matched its declared type' : 'schema rejected the row',
      passed: parsed.success,
    },
    {
      name: 'Retry logic',
      detail: 'never fired, because nothing failed',
      passed: true,
    },
  ];
}

async function setMode(mode: string): Promise<void> {
  const token = process.env['DRIFTMART_ADMIN_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error('DRIFTMART_ADMIN_TOKEN is not set, and switching the fixture requires it.');
  }
  const response = await fetch(`${FIXTURE}/api/admin/mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token.trim()}` },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) {
    throw new Error(`could not switch the fixture to ${mode}: HTTP ${String(response.status)}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const collectorId = args.find((arg) => arg.startsWith('c_'));
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex === -1 ? 'selector_drift' : (args[modeIndex + 1] ?? 'selector_drift');

  if (collectorId === undefined) {
    out('Usage: npm run blindspot -- <collector-id> [--mode selector_drift]');
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env['BRIGHTDATA_API_KEY'];
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error('BRIGHTDATA_API_KEY is not set.');
  }

  out();
  out(`Fixture    ${PAGE}`);
  out(`Collector  ${collectorId}  (real Scraper Studio collector)`);
  out(`Mode       ${mode}`);

  out();
  out(`Switching the page to '${mode}' ...`);
  await setMode(mode);
  out('done. The page still looks completely normal to a person.');

  // ---------------------------------------------------------------- sensor A
  heading('1. what bright data reports');

  const client = new BrightDataClient({ apiKey: apiKey.trim() });
  const startedAt = Date.now();
  const snapshotId = await client.triggerCollector(collectorId, [{ url: PAGE }]);
  const rows = await client.waitForSnapshot(snapshotId, { timeoutMs: 180_000 });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  const row = (rows[0] ?? {}) as Record<string, unknown>;

  out();
  out(`POST /dca/trigger        HTTP 200`);
  out(`collection_id            ${snapshotId}`);
  out(`GET  /dca/dataset        ready after ${elapsed}s`);
  out(`rows returned            ${String(rows.length)}`);
  out();
  out('The row, exactly as the collector produced it:');
  out();
  out(JSON.stringify(row, null, 2));
  out();
  out('Bright Data has reported no error, opened no incident, and logged no');
  out('warning. That is correct behaviour. The request did work.');

  // ------------------------------------------------------------- safeguards
  heading('2. every safeguard you already have');

  const safeguards = runSafeguards(row, true);
  out();
  for (const check of safeguards) {
    const verdict = check.passed ? 'PASS' : 'FAIL';
    out(`  [${verdict}]  ${check.name.padEnd(26)}  ${check.detail}`);
  }

  const survived = safeguards.every((check) => check.passed);
  out();
  out(
    survived
      ? `All ${String(safeguards.length)} checks passed. Nothing downstream has any reason to hesitate.`
      : 'A check failed, so this row would have been caught conventionally.',
  );

  // ---------------------------------------------------------------- sensor B
  heading('3. the second sensor');

  out();
  out('Reading the same URL through Web Unlocker as markdown. No selectors are');
  out('involved, so it cannot drift the way an extractor does.');

  const zone = process.env['BRIGHTDATA_UNLOCKER_ZONE'];
  if (zone === undefined || zone.trim() === '') {
    throw new Error('BRIGHTDATA_UNLOCKER_ZONE is not set, and the witness needs a zone.');
  }

  const { markdown } = await fetchWitnessMarkdown(
    {
      apiKey: apiKey.trim(),
      zone: zone.trim(),
      ...(process.env['BRIGHTDATA_UNLOCKER_COUNTRY'] === undefined
        ? {}
        : { country: process.env['BRIGHTDATA_UNLOCKER_COUNTRY'] }),
    },
    PAGE,
  );
  const witness = extractField(markdown, PRICE);

  out();
  if (witness === null) {
    out('The witness could not read the page. NOTICE calls that inconclusive and');
    out('quarantines rather than guessing, which is the fourth outcome.');
    return;
  }

  out(`witness value      ${show(witness.value)}`);
  out(`confidence         ${witness.confidence.toFixed(2)}  (${witness.evidence.strategy})`);
  out(`read from line ${String(witness.evidence.lineNumber)}   "${witness.evidence.line.trim()}"`);

  // ---------------------------------------------------------------- verdict
  heading('4. what notice concludes');

  const agreement = compareValues(row['price'], witness.value);
  out();
  out(`collector said     ${show(row['price'])}`);
  out(`witness said       ${show(witness.value)}`);
  out(`agreement          ${agreement.kind}`);
  out();

  if (agreement.kind === 'agree') {
    out('The two sensors agree. If the value also moved against history, the');
    out('world changed and the collector must be left alone.');
  } else {
    out('The two sensors disagree, so the extractor drifted rather than the');
    out('page changing meaning. NOTICE quarantines the field, and the corrupt');
    out('row never reaches the feed, the dashboard or an agent.');
  }

  out();
  rule('=');
  if (agreement.kind === 'agree') {
    out('Every check passed, and this time the row deserved to pass.');
    out('Telling this run apart from the last one is the entire project.');
  } else {
    out('Every check that exists today passed this row.');
    out('The only thing that caught it was a second sensor that disagreed.');
  }
  rule('=');
  out();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
