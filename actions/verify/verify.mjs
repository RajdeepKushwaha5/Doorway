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

/**
 * A failure this step should report but never enforce.
 *
 * `fail-on-unverified: false` means tell me, do not block. Anything that
 * represents the state of the data, including there being none yet, belongs in
 * that bargain.
 */
class Soft extends Error {}

/**
 * A failure that must always stop the build, whatever the flags say.
 *
 * Reserved for a step that cannot do its job at all. Passing silently in that
 * situation is worse than failing, because a gate that always says yes is
 * indistinguishable from no gate and nobody finds out for months.
 */
class Fatal extends Error {}

async function collectorsToCheck() {
  const all = await api('/api/collectors');

  if (COLLECTOR === '') {
    if (all.length === 0) {
      // Nothing registered is a state, not a misconfiguration. On a host with
      // no persistent disk it is also what a restart looks like.
      throw new Soft('NOTICE has no registered collectors, so there is nothing to verify.');
    }
    return all;
  }

  const match = all.find(
    (candidate) => candidate.id === COLLECTOR || candidate.brightDataCollectorId === COLLECTOR,
  );
  if (match === undefined) {
    // A named collector that does not exist is always fatal, even in
    // report-only mode. A typo here would otherwise verify nothing, pass every
    // time, and look exactly like success.
    throw new Fatal(
      all.length === 0
        ? `Asked to verify "${COLLECTOR}" but NOTICE has no collectors registered.`
        : `No collector matching "${COLLECTOR}". Known: ${all
            .map((candidate) => candidate.brightDataCollectorId)
            .join(', ')}`,
    );
  }
  return [match];
}

async function main() {
  if (API === '') {
    // Always fatal: without a base URL this step can never do anything, and a
    // silent pass would hide that forever.
    throw new Fatal('api-base is required, for example https://notice-api.onrender.com');
  }

  const collectors = await collectorsToCheck();
  const rows = [];
  let blocked = 0;

  let contractOnly = 0;

  for (const collector of collectors) {
    /*
     * Every watched page, not just the first.
     *
     * This asked for `/api/feed/{id}` with no URL, which the API answers for
     * `watchUrls[0]`. A collector watching five pages was therefore judged on
     * one of them, while the summary told the build that every source was
     * verified. A gate that checks a fifth of what it claims to check is worse
     * than no gate, because it is trusted.
     */
    const urls = URL_INPUT === '' ? (collector.watchUrls ?? []) : [URL_INPUT];
    const targets = urls.length === 0 ? [undefined] : urls;

    for (const url of targets) {
      const query = url === undefined ? '' : `?url=${encodeURIComponent(url)}`;
      const feed = await api(`/api/feed/${collector.id}${query}`);
      const { status, reason, incidentId, fieldsDegraded, lastVerified, confirmedBy } = feed.health;

      // Stale is a deliberate middle state: two sensors agreed on this value at
      // some point, but not now. Whether that is acceptable depends on what the
      // build does with it, so the caller decides rather than this script.
      const acceptable = status === 'verified' || (status === 'stale' && ALLOW_STALE);
      if (!acceptable) blocked += 1;
      if (acceptable && confirmedBy === 'contract_only') contractOnly += 1;

      const label = url === undefined ? collector.name : `${collector.name} ${new URL(url).pathname}`;
      rows.push({ name: label, status, reason, incidentId, fieldsDegraded, lastVerified, confirmedBy });

      const line = `${label}: ${status}${reason ? ` (${reason})` : ''}`;
      if (acceptable) log(`  ok    ${line}`);
      else log(`::error::${line}`);

      // Single-page runs expose their result, so a later step can branch.
      if (collectors.length === 1 && targets.length === 1) {
        emit('status', status);
        emit('reason', reason ?? '');
        emit('incident', incidentId ?? '');
      }
    }
  }

  summary(
    [
      '## NOTICE data verification',
      '',
      '| Page | Status | Confirmed by | Withheld | Last verified |',
      '|---|---|---|---|---|',
      ...rows.map(
        (row) =>
          `| ${row.name} | ${row.status} | ${row.confirmedBy ?? 'unknown'} | ${
            row.fieldsDegraded?.length > 0 ? row.fieldsDegraded.join(', ') : 'none'
          } | ${row.lastVerified ?? 'never'} |`,
      ),
      '',
      /*
       * The summary used to state that every source was confirmed by two
       * independent sensors whenever nothing was blocked. That is only true of
       * pages the witness actually read: a reading can pass on the learned
       * contract alone, and saying otherwise overstates the evidence in the one
       * place a build is deciding whether to trust it.
       */
      blocked === 0 && contractOnly === 0
        ? `All ${rows.length} page(s) confirmed by two independent Bright Data sensors.`
        : blocked === 0
          ? `All ${rows.length} page(s) passed, but ${contractOnly} of them were confirmed against the learned contract only, with no independent witness reading.`
          : `${blocked} page(s) could not be verified. Shipping against them means shipping data nobody checked.`,
    ].join('\n'),
  );

  if (blocked === 0) {
    log('');
    log(
      contractOnly === 0
        ? `All ${rows.length} page(s) verified by two independent sensors.`
        : `All ${rows.length} page(s) passed. ${contractOnly} were contract-only, with no witness reading.`,
    );
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
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof Fatal) {
    log(`::error::${message}`);
    process.exit(1);
  }

  // Everything else describes the data rather than the setup, so it honours
  // the caller's choice about whether this blocks.
  if (SHOULD_FAIL) {
    log(`::error::${message}`);
    process.exit(1);
  }

  log(`::warning::${message}`);
  log('fail-on-unverified is false, so this is reported and not enforced.');
});
