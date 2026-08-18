/**
 * Drift Discrimination Score: can a method tell a broken extractor from a
 * changed world?
 *
 * Every approach to scraper health gets measured on one axis, whether it
 * notices something is wrong, and that axis alone makes a change monitor look
 * perfect. It is not. A monitor that alerts on any difference catches every
 * corruption and also fires on every legitimate price change, and acting on the
 * second as though it were the first rewrites a collector that was working.
 * Detection without restraint is not a safety property.
 *
 * So this scores two axes over the same six cases:
 *
 *   detection  of the cases that ARE faults, how many did the method catch
 *   restraint  of the cases that are NOT faults, how many did it leave alone
 *
 * DDS is how often the method reached the correct decision. A method has to
 * earn both halves; scoring full marks on either one alone caps it at 67%.
 *
 * Nothing here is asserted. Each method runs against the live fixture and its
 * verdict is computed, so a reader who doubts a row can change a mode and
 * re-run it.
 *
 * Usage:
 *   npm run benchmark          # runs live, writes evals/dds.json
 *
 * Needs BRIGHTDATA_API_KEY, BRIGHTDATA_UNLOCKER_ZONE and DRIFTMART_ADMIN_TOKEN.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchWitnessMarkdown } from '../src/brightdata/unlocker.js';
import { extractField } from '../src/witness/extract.js';
import { compareValues, normalizeMoney } from '../src/shared/normalize.js';
import type { WitnessFieldSpec } from '../src/witness/spec.js';

const FIXTURE = (process.env['DRIFTMART_URL'] ?? 'https://driftmart-3ut8.onrender.com').replace(
  /\/+$/,
  '',
);
const PAGE = `${FIXTURE}/product/headphones`;

const PRICE: WitnessFieldSpec = {
  path: 'price',
  meaning: 'The purchase price of the product, not a refundable deposit.',
  labels: ['price', 'purchase price'],
  excludeLabels: ['deposit', 'refundable', 'security', 'sponsored'],
  kind: 'money',
  allowed: [],
};

const AVAILABILITY: WitnessFieldSpec = {
  path: 'availability',
  meaning: 'Whether the product can be bought right now.',
  labels: ['availability', 'stock'],
  excludeLabels: [],
  kind: 'text',
  allowed: [],
};

/**
 * One case, with its ground truth stated up front.
 *
 * `fault` is what a correct system should conclude, decided by what the page
 * means rather than by what any method happens to output. `baseline` and
 * `genuine_price_change` are the two the whole benchmark turns on: the page is
 * telling the truth in both, and a method that touches the collector for either
 * has done damage.
 *
 * `pagination_collapse` is deliberately absent. Its fault is a repeated row
 * rather than a wrong field value, so scoring it here would measure something
 * this benchmark does not test.
 */
interface Case {
  mode: string;
  field: 'price' | 'availability';
  fault: boolean;
  note: string;
}

const CASES: readonly Case[] = [
  { mode: 'baseline', field: 'price', fault: false, note: 'nothing is wrong' },
  {
    mode: 'genuine_price_change',
    field: 'price',
    fault: false,
    note: 'the price really moved to 229',
  },
  { mode: 'selector_drift', field: 'price', fault: true, note: 'reads the 25 deposit' },
  { mode: 'silent_zero', field: 'price', fault: true, note: 'structured value says 0' },
  { mode: 'sponsored_insertion', field: 'price', fault: true, note: 'reads the 99 sponsored card' },
  { mode: 'missing_field', field: 'availability', fault: true, note: 'availability disappeared' },
];

/** The value the collector last saw when everything was correct. */
const KNOWN_GOOD: Record<Case['field'], string> = { price: '249', availability: 'In stock' };

/** Repo root, not the workspace the script happens to run from. */
const EVAL_DIR = join(process.cwd(), process.cwd().endsWith('backend') ? '..' : '.', 'evals');

const out = (line = ''): void => void process.stdout.write(`${line}\n`);

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
 * Sensor 1, the selector-bound collector, read straight from the HTML.
 *
 * Standing in for Scraper Studio so the benchmark runs without an account and
 * spends no collector credits. The selector is the one a collector binds to on
 * the baseline layout, which is exactly why it goes wrong when the layout moves.
 */
async function collectorReading(field: Case['field']): Promise<string | null> {
  const html = await (await fetch(PAGE, { cache: 'no-store' })).text();
  const pattern =
    field === 'price'
      ? /<[^>]*class="selling-price"[^>]*>[^<]*</
      : /<[^>]*class="stock"[^>]*>[^<]*</;
  const element = pattern.exec(html)?.[0];
  if (element === undefined) return null;

  // A machine-readable attribute outranks the visible text, which is what a
  // real collector does and the entire point of silent_zero.
  const attribute = /data-amount="([^"]*)"/.exec(element)?.[1];
  if (attribute !== undefined && attribute !== '') return attribute;
  return />([^<]+)</.exec(element)?.[1]?.trim() ?? null;
}

async function witnessReading(field: Case['field']): Promise<unknown> {
  const apiKey = process.env['BRIGHTDATA_API_KEY'];
  const zone = process.env['BRIGHTDATA_UNLOCKER_ZONE'];
  if (apiKey === undefined || zone === undefined) {
    throw new Error('BRIGHTDATA_API_KEY and BRIGHTDATA_UNLOCKER_ZONE are both required.');
  }
  const { markdown } = await fetchWitnessMarkdown({ apiKey, zone }, PAGE);
  const found = extractField(markdown, field === 'price' ? PRICE : AVAILABILITY);
  return found === null ? null : found.value;
}

/** Whether the method withheld or raised, whatever it called the outcome. */
interface Decision {
  flagged: boolean;
  label: string;
}

/**
 * Method A: the checks a careful team already has.
 *
 * Status, valid JSON, field present, not null, right type, positive. Generous
 * on purpose: these are the checks a reviewer would actually have written, and
 * a strawman here would make the whole result worthless.
 */
function conventional(field: Case['field'], collector: string | null): Decision {
  if (collector === null) return { flagged: true, label: 'required field missing' };
  if (field === 'availability') return { flagged: false, label: 'non-empty string' };
  const money = normalizeMoney(collector);
  if (money === null || !Number.isFinite(money.value)) {
    return { flagged: true, label: 'not a number' };
  }
  if (money.value <= 0) return { flagged: true, label: 'range check, price > 0' };
  return { flagged: false, label: 'all checks pass' };
}

/** Method B: alert on any difference from the last known value. */
function changeMonitor(field: Case['field'], collector: string | null): Decision {
  const previous = KNOWN_GOOD[field];
  if (collector === null) return { flagged: true, label: 'value disappeared' };
  const same =
    field === 'price'
      ? normalizeMoney(collector)?.value === normalizeMoney(previous)?.value
      : collector.trim().toLowerCase() === previous.toLowerCase();
  return same
    ? { flagged: false, label: 'unchanged' }
    : { flagged: true, label: `changed from ${previous}` };
}

/**
 * Method C: two sensors, one rule.
 *
 * Disagreement means the extractor drifted. Agreement means the page is telling
 * the truth, and whether that truth moved is a separate question the contract
 * answers rather than the witness. Absence on both sides is inconclusive and is
 * withheld rather than guessed at.
 */
function notice(collector: string | null, witness: unknown): Decision {
  if (collector === null && witness === null) {
    return { flagged: true, label: 'inconclusive, withheld' };
  }
  if (collector === null || witness === null) {
    return { flagged: true, label: 'one sensor blind, withheld' };
  }
  const agreement = compareValues(collector, witness);
  if (agreement.kind === 'agree') return { flagged: false, label: 'sensors agree, leave alone' };
  if (agreement.kind === 'incomparable') return { flagged: true, label: 'incomparable, withheld' };
  return { flagged: true, label: 'extractor_drift' };
}

interface Row {
  mode: string;
  field: string;
  fault: boolean;
  collector: string | null;
  witness: unknown;
  results: Record<string, Decision>;
}

function score(rows: Row[], method: string): { detected: number; restrained: number; dds: number } {
  const faults = rows.filter((row) => row.fault);
  const clean = rows.filter((row) => !row.fault);
  const detected = faults.filter((row) => row.results[method]?.flagged === true).length;
  const restrained = clean.filter((row) => row.results[method]?.flagged === false).length;
  return {
    detected,
    restrained,
    dds: Math.round(((detected + restrained) / rows.length) * 100),
  };
}

const METHODS = [
  ['conventional', 'Status, schema, null, type, range'],
  ['monitor', 'Change monitor, alert on any diff'],
  ['notice', 'NOTICE, two independent sensors'],
] as const;

async function main(): Promise<void> {
  const rows: Row[] = [];

  out();
  out('Drift Discrimination Score');
  out(`fixture  ${PAGE}`);
  out();

  for (const testCase of CASES) {
    await setMode(testCase.mode);
    const collector = await collectorReading(testCase.field);
    const witness = await witnessReading(testCase.field);

    rows.push({
      mode: testCase.mode,
      field: testCase.field,
      fault: testCase.fault,
      collector,
      witness,
      results: {
        conventional: conventional(testCase.field, collector),
        monitor: changeMonitor(testCase.field, collector),
        notice: notice(collector, witness),
      },
    });

    const mark = testCase.fault ? 'FAULT   ' : 'no fault';
    out(`  ${mark}  ${testCase.mode.padEnd(22)} ${testCase.note}`);
  }

  const faults = rows.filter((row) => row.fault).length;
  const clean = rows.length - faults;

  out();
  out('='.repeat(78));
  out(
    'Method'.padEnd(36) +
      `Detection /${String(faults)}`.padEnd(15) +
      `Restraint /${String(clean)}`.padEnd(16) +
      'DDS',
  );
  out('='.repeat(78));
  for (const [key, label] of METHODS) {
    const s = score(rows, key);
    out(
      label.padEnd(36) +
        String(s.detected).padEnd(15) +
        String(s.restrained).padEnd(16) +
        `${String(s.dds)}%`,
    );
  }
  out('='.repeat(78));
  out();
  out('Detection alone is easy. A monitor that alerts on everything scores full');
  out('marks for it and is still unusable, because it fires on a price that');
  out('genuinely changed and rewrites a collector that was working.');
  out();

  await mkdir(EVAL_DIR, { recursive: true });
  await writeFile(
    join(EVAL_DIR, 'dds.json'),
    `${JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        fixture: PAGE,
        cases: rows,
        scores: Object.fromEntries(
          METHODS.map(([key, label]) => [key, { label, ...score(rows, key) }]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  out(`Wrote ${join(EVAL_DIR, 'dds.json')}`);

  await setMode('baseline');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
