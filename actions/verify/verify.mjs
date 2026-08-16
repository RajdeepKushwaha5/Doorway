/**
 * Fail a build when the web data it depends on is not currently trustworthy.
 *
 * A deployment pipeline already refuses to ship on a failing test or a type
 * error. It will happily ship a pricing page, a dashboard or a model trained on
 * a number that a broken scraper invented last Tuesday, because nothing in the
 * pipeline knows the difference between data and correct data.
 *
 * This asks NOTICE whether two independent Bright Data sensors currently agree
 * on the data this repository consumes, and stops the build when they do not.
 * The interesting property is the same as everywhere else in the project: it
 * refuses rather than guessing, and it says exactly why.
 *
 * Written as a plain script with no dependencies and no build step, so anyone
 * can read what their CI is about to run. Node 20 and up ships fetch.
 */

const API = (process.env.NOTICE_API_BASE ?? '').trim().replace(/\/+$/, '');
const COLLECTOR = (process.env.NOTICE_COLLECTOR ?? '').trim();
const URL_INPUT = (process.env.NOTICE_URL ?? '').trim();
const ALLOW_STALE = (process.env.NOTICE_ALLOW_STALE ?? 'false').trim() === 'true';
const SHOULD_FAIL = (process.env.NOTICE_FAIL_ON_UNVERIFIED ?? 'true').trim() !== 'false';

const log = (line) => process.stdout.write(`${line}\n`);

/** GitHub reads these files to set step outputs and render the summary. */
function emit(name, value) {
  if (process.env.GITHUB_OUTPUT === undefined) return;
  const { appendFileSync } = require('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value ?? '')}\n`);
}

function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY === undefined) return;
  const { appendFileSync } = require('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

async function api(path) {
  const response = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`NOTICE API returned ${response.status} for ${path}`);
  }
  return response.json();
}

async function collectorsToCheck() {
  const all = await api('/api/collectors');
  if (all.length === 0) {
    throw new Error('NOTICE has no registered collectors, so there is nothing to verify.');
  }
  if (COLLECTOR === '') return all;

  const match = all.find(
    (candidate) => candidate.id === COLLECTOR || candidate.brightDataCollectorId === COLLECTOR,
  );
  if (match === undefined) {
    throw new Error(
      `No collector matching "${COLLECTOR}". Known: ${all
        .map((candidate) => candidate.brightDataCollectorId)
        .join(', ')}`,
    );
  }
  return [match];
}

async function main() {
  if (API === '') {
    log('::error::api-base is required, for example https://notice-api.onrender.com');
    process.exit(1);
  }

  const collectors = await collectorsToCheck();
  const rows = [];
  let blocked = 0;

  for (const collector of collectors) {
    const url = URL_INPUT === '' ? undefined : URL_INPUT;
    const query = url === undefined ? '' : `?url=${encodeURIComponent(url)}`;
    const feed = await api(`/api/feed/${collector.id}${query}`);
    const { status, reason, incidentId, fieldsDegraded, lastVerified } = feed.health;

    // Stale is a deliberate middle state: two sensors agreed on this value at
    // some point, but not now. Whether that is acceptable depends on what the
    // build does with it, so the caller decides rather than this script.
    const acceptable = status === 'verified' || (status === 'stale' && ALLOW_STALE);
    if (!acceptable) blocked += 1;

    rows.push({ name: collector.name, status, reason, incidentId, fieldsDegraded, lastVerified });

    const line = `${collector.name}: ${status}${reason ? ` (${reason})` : ''}`;
    if (acceptable) log(`  ok    ${line}`);
    else log(`::error::${line}`);

    // Single-collector runs expose their result, so a later step can branch.
    if (collectors.length === 1) {
      emit('status', status);
      emit('reason', reason ?? '');
      emit('incident', incidentId ?? '');
    }
  }

  summary(
    [
      '## NOTICE data verification',
      '',
      '| Source | Status | Withheld | Last verified |',
      '|---|---|---|---|',
      ...rows.map(
        (row) =>
          `| ${row.name} | ${row.status} | ${
            row.fieldsDegraded?.length > 0 ? row.fieldsDegraded.join(', ') : 'none'
          } | ${row.lastVerified ?? 'never'} |`,
      ),
      '',
      blocked === 0
        ? 'Every source is currently confirmed by two independent Bright Data sensors.'
        : `${blocked} source(s) could not be verified. Shipping against them means shipping data nobody checked.`,
    ].join('\n'),
  );

  if (blocked === 0) {
    log('');
    log('All sources verified by two independent sensors.');
    return;
  }

  log('');
  log(`${blocked} of ${collectors.length} source(s) are not verified.`);

  if (!SHOULD_FAIL) {
    log('fail-on-unverified is false, so this is reported and not enforced.');
    return;
  }
  process.exit(1);
}

main().catch((error) => {
  log(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
