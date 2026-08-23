/**
 * Phase 0: the candidate-execution matrix.
 *
 * One question decides NOTICE's entire approval architecture:
 *
 *   Can we execute a pending, unapproved Self-Healing candidate against
 *   arbitrary URLs before deciding whether to promote it?
 *
 * If yes, the approval gate is incident replay plus a regression corpus
 * (Branch A). If no, the gate degrades to multi-input preview verification
 * (Branch B), a disposable shadow collector (Branch C), or an honest
 * human-reviewed packet (Branch D).
 *
 * This script answers that against a real collector and writes an evidence
 * file. It never approves anything, and it rejects nothing either, so the
 * collector is left exactly as it was found.
 *
 * Usage:
 *   node dist/matrix.js --collector c_xxx \
 *     --incident   https://site/failing-page \
 *     --original   https://site/page-the-collector-was-built-on \
 *     --unseen     https://site/other-1 \
 *     --unseen     https://site/other-2 \
 *     --unseen     https://site/other-3 \
 *     --control    https://site/structurally-different-page \
 *     --prompt     "The price field returns ... it should return ..."
 */

import { asText } from '../src/shared/text.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BrightDataClient, runScraper, type HealProgress } from '../src/brightdata/index.js';
import { redact } from '../src/shared/index.js';

interface Args {
  collector: string;
  incident: string;
  original: string;
  unseen: string[];
  control: string | null;
  prompt: string;
  out: string;
  pollIntervalMs: number;
  healTimeoutMs: number;
}

function parseArgs(argv: readonly string[]): Args {
  const unseen: string[] = [];
  const single = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || value === undefined || !flag.startsWith('--')) continue;
    const key = flag.slice(2);
    if (key === 'unseen') unseen.push(value);
    else single.set(key, value);
  }

  const required = (key: string): string => {
    const value = single.get(key);
    if (value === undefined || value.trim() === '') {
      throw new Error(`missing required argument --${key}`);
    }
    return value;
  };

  return {
    collector: required('collector'),
    incident: required('incident'),
    original: required('original'),
    unseen,
    control: single.get('control') ?? null,
    prompt: required('prompt'),
    out: single.get('out') ?? 'docs/evidence/phase0-matrix.json',
    pollIntervalMs: Number(single.get('pollIntervalMs') ?? 10_000),
    healTimeoutMs: Number(single.get('healTimeoutMs') ?? 900_000),
  };
}

interface CaseResult {
  label: string;
  url: string;
  ok: boolean;
  rowCount: number;
  /** First row, redacted, so the matrix shows what actually came back. */
  sample: unknown;
  error: string | null;
  durationMs: number;
}

/** Run one URL against the pending candidate and record what happened. */
async function runCandidate(label: string, collectorId: string, url: string): Promise<CaseResult> {
  const startedAt = Date.now();
  try {
    const { rows } = await runScraper(collectorId, [url], { version: 'dev' });
    const firstRow = rows[0] ?? null;
    const looksLikeError =
      firstRow !== null &&
      typeof firstRow === 'object' &&
      'error' in (firstRow as Record<string, unknown>);

    return {
      label,
      url,
      ok: rows.length > 0 && !looksLikeError,
      rowCount: rows.length,
      sample: redact(firstRow),
      error: looksLikeError
        ? asText((firstRow as Record<string, unknown>)['error'] ?? 'unknown')
        : null,
      durationMs: Date.now() - startedAt,
    };
  } catch (caught) {
    return {
      label,
      url,
      ok: false,
      rowCount: 0,
      sample: null,
      error: caught instanceof Error ? caught.message : String(caught),
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Poll Self-Healing until it stops at the approval gate or terminates. */
async function waitForCandidate(
  client: BrightDataClient,
  collectorId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<HealProgress> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const progress = await client.getHealProgress(collectorId);
    process.stdout.write(`  heal phase: ${progress.phase}\n`);

    if (
      progress.phase === 'awaiting_approval' ||
      progress.phase === 'done' ||
      progress.phase === 'failed' ||
      progress.phase === 'rejected'
    ) {
      return progress;
    }
    if (Date.now() + pollIntervalMs > deadline) {
      throw new Error(`heal did not reach a terminal phase within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

function decideBranch(cases: readonly CaseResult[], previewRan: boolean): string {
  const executed = cases.filter((c) => c.error === null || !/version|dev|candidate/i.test(c.error));
  const anyRan = executed.length > 0;
  const allSameAsProduction = cases.every((c) => !c.ok);

  if (!anyRan) return 'D: candidate execution unavailable, ship an honest human-reviewed packet';
  if (allSameAsProduction && previewRan) {
    return 'B or D: candidate runs did not reflect the repair, verify via multi-input preview and keep a human gate';
  }
  return 'A: candidate execution works, gate on incident replay plus regression corpus';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env['BRIGHTDATA_API_KEY'];
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error('BRIGHTDATA_API_KEY is not set');
  }

  const client = new BrightDataClient({
    apiKey,
    onEvent: (event) => process.stdout.write(`  [${event.type}]\n`),
  });

  process.stdout.write(`Phase 0 matrix for ${args.collector}\n`);
  process.stdout.write(`Incident URL: ${args.incident}\n\n`);

  // 1. Baseline: what does production do with the incident URL right now?
  process.stdout.write('1. production baseline on the incident URL\n');
  const productionBaseline = await (async (): Promise<CaseResult> => {
    const startedAt = Date.now();
    try {
      const { rows } = await runScraper(args.collector, [args.incident]);
      const firstRow = rows[0] ?? null;
      return {
        label: 'production baseline',
        url: args.incident,
        ok: rows.length > 0,
        rowCount: rows.length,
        sample: redact(firstRow),
        error: null,
        durationMs: Date.now() - startedAt,
      };
    } catch (caught) {
      return {
        label: 'production baseline',
        url: args.incident,
        ok: false,
        rowCount: 0,
        sample: null,
        error: caught instanceof Error ? caught.message : String(caught),
        durationMs: Date.now() - startedAt,
      };
    }
  })();

  // 2. Trigger Self-Healing with the incident in custom_input. This is the
  //    step the CLI cannot do: `bdata scraper heal --url` sends an empty
  //    custom_input, so the healer never sees the page that failed.
  process.stdout.write('\n2. triggering Self-Healing with the incident URL in custom_input\n');
  await client.triggerSelfHealing(args.collector, args.prompt, [args.incident]);

  // 3. Wait for the approval gate.
  process.stdout.write('\n3. waiting for the approval gate\n');
  const progress = await waitForCandidate(
    client,
    args.collector,
    args.healTimeoutMs,
    args.pollIntervalMs,
  );

  if (progress.phase !== 'awaiting_approval') {
    process.stdout.write(`\nHeal ended in phase "${progress.phase}" without an approval gate.\n`);
  }

  // 4. The actual question: can the pending candidate be executed?
  process.stdout.write('\n4. executing the pending candidate against each case\n');
  const cases: CaseResult[] = [];
  cases.push(await runCandidate('incident', args.collector, args.incident));
  cases.push(await runCandidate('original creation URL', args.collector, args.original));
  for (const [index, url] of args.unseen.entries()) {
    cases.push(await runCandidate(`unseen same-template ${index + 1}`, args.collector, url));
  }
  if (args.control !== null) {
    cases.push(await runCandidate('negative control', args.collector, args.control));
  }

  // 5. Repeat the incident case, to see whether results are stable.
  process.stdout.write('\n5. repeating the incident case to check consistency\n');
  const repeat = await runCandidate('incident (repeat)', args.collector, args.incident);
  cases.push(repeat);

  const evidence = {
    capturedAt: new Date().toISOString(),
    collectorId: args.collector,
    prompt: args.prompt,
    productionBaseline,
    healPhase: progress.phase,
    healJobId: progress.jobId,
    previewRowCount: progress.previewResult?.length ?? null,
    previewSample: redact(progress.previewResult?.[0] ?? null),
    previewRaw: progress.raw,
    cases,
    recommendedBranch: decideBranch(cases, progress.previewResult !== null),
    note: 'Nothing was approved or rejected. The collector is unchanged.',
  };

  const outPath = resolve(process.cwd(), args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  process.stdout.write('\n=== MATRIX ===\n');
  for (const c of cases) {
    const status = c.ok ? 'PASS' : 'FAIL';
    process.stdout.write(
      `  ${status.padEnd(5)} ${c.label.padEnd(26)} rows=${String(c.rowCount).padEnd(3)} ${c.error ?? ''}\n`,
    );
  }
  process.stdout.write(`\nPreview rows: ${evidence.previewRowCount ?? 'none'}\n`);
  process.stdout.write(`Recommended branch: ${evidence.recommendedBranch}\n`);
  process.stdout.write(`Evidence written to ${outPath}\n`);
  process.stdout.write('\nThe pending repair was left at the gate. Approve or reject it yourself.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`\nPhase 0 failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
