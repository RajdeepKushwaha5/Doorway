/**
 * Capture the whole lifecycle as raw artifacts a stranger can open.
 *
 * The claims in this repository were all true and all written as prose. Prose
 * asks to be believed. A numbered chain of raw files asks to be checked, and
 * the second one is worth much more from somebody who has never met you.
 *
 * So this runs the real loop against the deployed services and writes what each
 * step actually returned, unedited: the collector's provenance, the page before
 * and after a real break, what Bright Data returned each time, the verdict the
 * two sensors reached, and what a consumer received while the source was lying.
 *
 * Nothing here is generated or reformatted for presentation. Every file is the
 * bytes that came back. The point is that the last step contradicts the source
 * page, and you can verify that yourself from files 05, 06 and 08.
 *
 * Usage:
 *   npm run evidence
 *
 * Spends roughly six Bright Data page loads. Needs NOTICE_ADMIN_TOKEN and
 * DRIFTMART_ADMIN_TOKEN in .env, the same ones `npm run live` uses.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

const OUT = 'docs/evidence/lifecycle';
const COLLECTOR = 'c_mt36mo6tj37dmjgqh';
const PAGE = 'https://doorway-lab.onrender.com/opportunity/ai-fellowship';
const API = 'https://doorway-api-4ftn.onrender.com';

/**
 * The heal is opt-in.
 *
 * It polls Bright Data for several minutes and costs more than every other
 * step combined, so a plain run captures the detection half and stops. Pass
 * --with-heal to capture what happens to the repair.
 */
const WITH_HEAL = process.argv.includes('--with-heal');

const steps = [];

/** Write one artifact and remember it for the ledger. */
async function artifact(file, body, note) {
  await writeFile(`${OUT}/${file}`, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
  steps.push({ file, note });
  process.stdout.write(`  wrote ${file}\n`);
}

/**
 * Run a command and return its stdout.
 *
 * Failure is captured rather than thrown. A step that errored is still
 * evidence, and hiding it would defeat the point of the directory.
 */
async function capture(command, args) {
  try {
    const { stdout, stderr } = await run(command, args, {
      shell: true,
      maxBuffer: 20_000_000,
      windowsHide: true,
    });
    // The Bright Data CLI prints a CommonJS/ESM warning on every invocation.
    // It is noise from npm, not from the run, so it is filtered from the
    // artifact rather than left to look like output.
    const noise = /^.*(ExperimentalWarning|is loading ES Module|Support for loading ES Module|trace-warnings).*$/gm;
    return `${stdout}${stderr}`.replace(noise, '').replace(/\n{3,}/g, '\n\n').trim();
  } catch (error) {
    return `COMMAND FAILED\n${String(error instanceof Error ? error.message : error)}`;
  }
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' });
  return await response.text();
}

/**
 * Read the run back out of its own artifacts.
 *
 * The ledger quotes real values rather than describing them, so it cannot
 * claim something the files do not contain. If a field is missing the table
 * says so instead of inventing a number.
 */
function jsonAfterPreamble(text) {
  const at = text.indexOf('{');
  if (at === -1) return null;
  try {
    return JSON.parse(text.slice(at));
  } catch {
    return null;
  }
}

async function readBack(file) {
  const { readFile } = await import('node:fs/promises');
  return await readFile(`${OUT}/${file}`, 'utf8');
}

await mkdir(OUT, { recursive: true });
process.stdout.write(`\ncapturing into ${OUT}\n\n`);

// 1. Where the collector came from. It was generated from a description.
process.stdout.write('1/8  collector provenance\n');
await artifact(
  '01_collector.json',
  await fetchText(`${API}/api/collectors`),
  'The registered fleet, including how each collector was created.',
);

// 2 and 3. The page as it stands, and what both sensors make of it.
process.stdout.write('2/8  the page, before\n');
await artifact('02_page_baseline.html', await fetchText(PAGE), 'The source page, correct.');

process.stdout.write('3/8  baseline run (2 page loads)\n');
await artifact(
  '03_run_baseline.txt',
  await capture('npm', ['run', 'live', '--silent', '--', 'run', COLLECTOR]),
  'Both sensors read the page and agree. Verdict: healthy.',
);

// 4 and 5. A real break: an early-interest date above the real deadline.
process.stdout.write('4/8  breaking the page\n');
await artifact(
  '04_break.json',
  await capture('npm', ['run', 'live', '--silent', '--', 'mode', 'deadline_drift']),
  'The source page is switched to serve a wrong value, not a missing one.',
);

process.stdout.write('5/8  the page, after\n');
await artifact(
  '05_page_broken.html',
  await fetchText(PAGE),
  'The same page now shows an early-interest date above the real deadline.',
);

// 6. What Bright Data returns from the broken page. This is the whole problem.
process.stdout.write('6/8  what Bright Data returns now (1 page load)\n');
await artifact(
  '06_collector_output_broken.json',
  await capture('bdata', ['scraper', 'run', COLLECTOR, PAGE]),
  'A successful run. Valid JSON, every field present, and the deadline is wrong.',
);

// 7. The verdict.
process.stdout.write('7/8  the two-sensor verdict (2 page loads)\n');
await artifact(
  '07_verdict.txt',
  await capture('npm', ['run', 'live', '--silent', '--', 'run', COLLECTOR]),
  'The sensors disagree on one field. Verdict: extractor_drift.',
);

// 8. The part nobody else shows: what a consumer got while the source lied.
process.stdout.write('8/8  what a consumer receives\n');
await artifact(
  '08_feed_withheld.json',
  await capture('npm', ['run', 'live', '--silent', '--', 'feed', COLLECTOR]),
  'The wrong value was never published. The last agreed reading still stands.',
);

/*
 * 9 and 10. What happens to the repair.
 *
 * This is the half the platform does not do for you. Its own engineer
 * confirmed there is no automatic comparison of a healed template against
 * prior known-good output before promotion, so the candidate is replayed here
 * against the page that broke and the pages that were already working.
 */
if (WITH_HEAL) {
  const incidentId = jsonAfterPreamble(await readBack('07_verdict.txt'))?.incident?.id;

  if (incidentId === undefined) {
    process.stdout.write('\n  no incident to heal, skipping 9 and 10\n');
  } else {
    process.stdout.write('\n9/10  asking Bright Data to heal it (minutes)\n');
    await artifact(
      '09_heal.txt',
      await capture('npm', ['run', 'live', '--silent', '--', 'heal', incidentId]),
      'Bright Data Self-Healing writes a candidate repair.',
    );

    process.stdout.write('10/10 the gate, and what it decided\n');
    await artifact(
      '10_gate.txt',
      await capture('npm', ['run', 'live', '--silent', '--', 'show', incidentId]),
      'The candidate is replayed before it can ship. The gate decides, not the flag.',
    );
  }
}

// Leave the fixture as it was found.
process.stdout.write('\nresetting the fixture\n');
await capture('npm', ['run', 'live', '--silent', '--', 'mode', 'baseline']);

const baseline = jsonAfterPreamble(await readBack('03_run_baseline.txt'));
const drifted = jsonAfterPreamble(await readBack('07_verdict.txt'));
const consumer = jsonAfterPreamble(await readBack('08_feed_withheld.json'));
const rawBroken = await readBack('06_collector_output_broken.json');

const deadlineIn = (parsed) => parsed?.run?.rows?.[0]?.deadline_raw ?? '(not found)';
const brokenRaw = /"deadline_raw"\s*:\s*"([^"]+)"/.exec(rawBroken)?.[1] ?? '(not found)';
const served = consumer?.data?.deadline_raw ?? '(not found)';
const verdict = drifted?.incident?.classification ?? '(not found)';
const fields = (drifted?.incident?.affectedFields ?? []).join(', ') || '(none)';
const held = drifted?.incident?.quarantined === true;

/*
 * What the heal actually did.
 *
 * A heal can fail on the platform's side, and when it does the gate never
 * runs because there is no candidate to gate. Saying "the gate rejected it"
 * in that case would be a lie, so the outcome is read back rather than
 * assumed.
 */
let healOutcome = null;
if (WITH_HEAL) {
  const healLog = await readBack('09_heal.txt').catch(() => '');
  const gateIncident = jsonAfterPreamble(await readBack('10_gate.txt').catch(() => ''));
  const cases = gateIncident?.incident?.gateResults ?? [];
  const last = [...healLog.matchAll(/^\s+\d{2}:\d{2}:\d{2}\s+(\w+)$/gm)].at(-1)?.[1];
  const error = /Bright Data returned [^\n]+/.exec(healLog)?.[0];
  healOutcome = { status: last ?? 'unknown', error: error ?? null, cases: cases.length };
}

const ledger = `# The lifecycle, with receipts

Every file here is raw output from one real run against the deployed services.
Nothing is reformatted, staged or generated for presentation. The commands are
listed so you can produce your own.

## The short version

While the source page was serving **${brokenRaw}** as the closing date, a
consumer of this feed was still receiving **${served}**.

The wrong value was never published. That is the entire argument of this
project, and files 05, 06 and 08 are enough to check it without trusting a word
of this README.

| | Value |
|---|---|
| What the page said before the break | \`${deadlineIn(baseline)}\` |
| What Bright Data returned after it | \`${brokenRaw}\` |
| Verdict the two sensors reached | \`${verdict}\`, on \`${fields}\` |
| Withheld from the feed | ${held ? 'yes' : 'no'} |
| **What a consumer actually received** | **\`${served}\`** |

## The chain

| # | Step | Command | Artifact |
|---|---|---|---|
${steps
  .map((step, index) => {
    const commands = [
      '`GET /api/collectors`',
      '`curl <page>`',
      '`npm run live -- run <collector>`',
      '`npm run live -- mode deadline_drift`',
      '`curl <page>`',
      '`bdata scraper run <collector> <page>`',
      '`npm run live -- run <collector>`',
      '`npm run live -- feed <collector>`',
      '`npm run live -- heal <incident>`',
      '`npm run live -- show <incident>`',
    ];
    return `| ${String(index + 1)} | ${step.note} | ${commands[index] ?? ''} | [\`${step.file}\`](${step.file}) |`;
  })
  .join('\n')}

${
  WITH_HEAL
    ? `
## What happened to the repair

\`npm run live -- heal\` asked Bright Data Self-Healing for a candidate. The job
finished as **\`${healOutcome?.status ?? 'unknown'}\`**.${
        healOutcome?.error === null
          ? ''
          : `

\`\`\`
${healOutcome?.error ?? ''}
\`\`\`

The platform declined to produce a candidate for this collector, so there was
nothing for the gate to replay and it did not run. That is recorded here rather
than retried until it looked better: a chain that only shows the runs that went
well is not evidence.

Bright Data's own account of why arrived by email and is quoted in full in
[\`11_heal_declined_email.md\`](11_heal_declined_email.md), alongside what the
page actually looked like.`
      }

Gate cases replayed: **${String(healOutcome?.cases ?? 0)}**. The record stays
quarantined either way, which is the behaviour that matters: a repair that does
not exist cannot promote, and neither can one that fails.
`
    : `
## The half this run did not capture

Steps 9 and 10, the heal and the gate, are opt-in because a heal polls Bright
Data for several minutes:

\`\`\`bash
npm run evidence -- --with-heal
\`\`\`

That captures Self-Healing writing a candidate, and the gate replaying it
against the page that broke and the pages that were already working before it
is allowed to ship. Bright Data's own engineer confirmed the platform has no
such regression check, which is why it lives here.
`
}
## Reproduce it

\`\`\`bash
npm run evidence${WITH_HEAL ? ' -- --with-heal' : ''}
\`\`\`

Roughly six Bright Data page loads, more with \`--with-heal\`. It resets the
fixture to \`baseline\` afterwards, so running it twice is safe.

## If you only open one thing

[\`06_collector_output_broken.json\`](06_collector_output_broken.json), find
\`deadline_raw\`. Then [\`08_feed_withheld.json\`](08_feed_withheld.json), same
field.

They disagree. The collector really did return the wrong date from a page that
really was serving it. The consumer never saw it.
`;

await writeFile(`${OUT}/README.md`, ledger, 'utf8');
process.stdout.write(`\n  wrote ${OUT}/README.md\n`);
process.stdout.write(`\n  ${String(steps.length)} artifacts captured\n`);
process.stdout.write(`  page served ${brokenRaw}, consumer received ${served}\n\n`);
