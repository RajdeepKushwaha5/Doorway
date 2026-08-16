/**
 * The `notice` CLI.
 *
 * Exists so the whole system is drivable from a coding agent in plain
 * language. A judge should be able to clone the repository, open a coding agent
 * and say "check my collectors and heal anything that broke" without ever
 * opening the dashboard.
 *
 * Every command prints human-readable text by default and machine-readable
 * JSON with `--json`, because an agent needs to parse the result and a person
 * needs to read it, and neither should get the other's format.
 *
 * Usage:
 *   notice collectors                        list the fleet and its health
 *   notice check <collectorId> [--url U]     observe once and classify
 *   notice incidents [collectorId]           list incidents, newest first
 *   notice show <incidentId>                 full evidence for one incident
 *   notice heal <incidentId>                 diagnose, heal, replay, gate
 *   notice approve <incidentId>              promote a repair that passed
 *   notice feed <collectorId> [--url U]      what a consumer receives
 */

import { BrightDataClient } from '../src/brightdata/index.js';
import { attemptRepair, buildFeed, observeOnce, promoteRepair } from '../src/pipeline/index.js';
import { FileStore, type CollectorRecord, type Store } from '../src/store/index.js';

interface Flags {
  json: boolean;
  url: string | undefined;
}

function parseFlags(argv: readonly string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  let json = false;
  let url: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === '--json') json = true;
    else if (token === '--url') {
      url = argv[i + 1];
      i += 1;
    } else if (!token.startsWith('--')) positional.push(token);
  }
  return { positional, flags: { json, url } };
}

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function emit(flags: Flags, value: unknown, render: () => void): void {
  if (flags.json) out(JSON.stringify(value, null, 2));
  else render();
}

function requireClient(): BrightDataClient {
  const apiKey = process.env['BRIGHTDATA_API_KEY'];
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error('BRIGHTDATA_API_KEY is not set. Copy .env.example to .env and fill it in.');
  }
  return new BrightDataClient({ apiKey });
}

async function findCollector(store: Store, idOrBrightDataId: string): Promise<CollectorRecord> {
  const direct = await store.getCollector(idOrBrightDataId);
  if (direct !== null) return direct;

  // Accept the `c_...` id too, since that is what a person has in front of
  // them from Scraper Studio and the CLI.
  const all = await store.listCollectors();
  const match = all.find((collector) => collector.brightDataCollectorId === idOrBrightDataId);
  if (match === undefined) throw new Error(`no collector matching "${idOrBrightDataId}"`);
  return match;
}

/**
 * Replay a candidate over the HTTP API rather than the `bdata` CLI.
 *
 * The CLI is not installed on most machines, including the ones this project
 * deploys to, so shelling out made the repair gate fail for reasons that had
 * nothing to do with the repair.
 */
const runCandidate = async (collectorId: string, url: string): Promise<unknown[]> => {
  const { rows } = await requireClient().runCollector(collectorId, [url], {
    version: 'dev',
    timeoutMs: 600_000,
  });
  return rows;
};

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  const store = new FileStore(process.env['NOTICE_DATA_FILE']);

  switch (command) {
    case 'collectors': {
      const collectors = await store.listCollectors();
      const rows = await Promise.all(
        collectors.map(async (collector) => {
          const incidents = await store.listIncidents(collector.id);
          const open = incidents.filter((i) => i.resolvedAt === null && i.quarantined).length;
          const contract = await store.getContract(collector.id);
          return {
            id: collector.id,
            collectorId: collector.brightDataCollectorId,
            name: collector.name,
            openIncidents: open,
            baselineRuns: contract?.sampleCount ?? 0,
            contractConfidence: contract?.confidence ?? 0,
          };
        }),
      );

      emit(flags, rows, () => {
        if (rows.length === 0) {
          out('No collectors registered. POST one to /api/collectors to begin.');
          return;
        }
        for (const row of rows) {
          const status = row.openIncidents === 0 ? 'verified' : `${String(row.openIncidents)} open`;
          out(
            `${row.collectorId.padEnd(24)} ${row.name.padEnd(28)} ${status.padEnd(12)} baseline ${String(row.baselineRuns)} runs`,
          );
        }
      });
      return;
    }

    case 'check': {
      const collector = await findCollector(store, positional[0] ?? '');
      const url = flags.url ?? collector.watchUrls[0];
      if (url === undefined) throw new Error('no URL to check');

      const result = await observeOnce(collector, url, { client: requireClient(), store });

      emit(flags, result, () => {
        if (result.incident === null) {
          out(`verified  ${url}`);
          out('Contract checks passed. No witness fetch was needed.');
          return;
        }
        out(`${result.incident.classification}  ${url}`);
        out(`confidence ${result.incident.confidence.toFixed(2)}`);
        for (const line of result.incident.evidence) out(`  - ${line}`);
        if (result.incident.repairPrompt !== null) {
          out('');
          out('Proposed diagnosis:');
          out(`  ${result.incident.repairPrompt}`);
          out('');
          out(`Run: notice heal ${result.incident.id}`);
        } else {
          out('');
          out('No repair proposed. This classification must not be healed.');
        }
      });
      return;
    }

    case 'incidents': {
      const incidents = await store.listIncidents(positional[0]);
      emit(flags, incidents, () => {
        if (incidents.length === 0) {
          out('No incidents recorded.');
          return;
        }
        for (const incident of incidents.slice(0, 25)) {
          const state = incident.resolvedAt !== null ? 'resolved' : incident.quarantined ? 'open' : 'closed';
          out(
            `${incident.id.slice(0, 8)}  ${incident.classification.padEnd(22)} ${state.padEnd(9)} ${incident.affectedFields.join(',') || '-'}`,
          );
        }
      });
      return;
    }

    case 'show': {
      const incident = await store.getIncident(positional[0] ?? '');
      if (incident === null) throw new Error('incident not found');

      emit(flags, incident, () => {
        out(`${incident.classification}  confidence ${incident.confidence.toFixed(2)}`);
        out(`fields: ${incident.affectedFields.join(', ') || 'none isolated'}`);
        out('');
        out('Evidence:');
        for (const line of incident.evidence) out(`  - ${line}`);

        if (incident.witness !== null) {
          out('');
          out(`Witness (sha256 ${incident.witness.contentHash.slice(0, 16)}):`);
          for (const value of incident.witness.values) {
            out(
              `  ${value.path} = ${JSON.stringify(value.value)}  [${value.evidence.strategy}, line ${String(value.evidence.lineNumber)}]`,
            );
          }
        }

        if (incident.gateResults.length > 0) {
          out('');
          out('Candidate replay:');
          for (const result of incident.gateResults) {
            out(
              `  ${(result.passed ? 'PASS' : 'FAIL').padEnd(5)} ${result.label.padEnd(24)} ${result.executionError ?? ''}`,
            );
          }
        }

        out('');
        out('Timeline:');
        for (const step of incident.history) {
          out(`  ${step.at.slice(11, 19)}  ${step.from} to ${step.to}  (${step.actor}) ${step.reason}`);
        }
      });
      return;
    }

    case 'heal': {
      const incident = await store.getIncident(positional[0] ?? '');
      if (incident === null) throw new Error('incident not found');
      const collector = await findCollector(store, incident.collectorId);

      const outcome = await attemptRepair(collector, incident, {
        client: requireClient(),
        store,
        runCandidate,
      });

      emit(flags, outcome, () => {
        if (outcome.kind === 'not_repairable') {
          out(`not repairable: ${outcome.reason}`);
          return;
        }
        out(outcome.kind === 'approved' ? 'gate passed' : 'gate blocked, production unchanged');
        for (const reason of outcome.decision.reasons) out(`  - ${reason}`);
        out('');
        for (const result of outcome.decision.results) {
          out(
            `  ${(result.passed ? 'PASS' : 'FAIL').padEnd(5)} ${result.label.padEnd(24)} ${result.executionError ?? ''}`,
          );
        }
        if (outcome.kind === 'approved') {
          out('');
          out(`Nothing has been promoted yet. Run: notice approve ${incident.id}`);
        }
      });
      return;
    }

    case 'approve': {
      const incident = await store.getIncident(positional[0] ?? '');
      if (incident === null) throw new Error('incident not found');
      const collector = await findCollector(store, incident.collectorId);

      // The state machine refuses anything that has not reached
      // awaiting_approval, so an unverified candidate cannot be promoted from
      // here even deliberately.
      const resolved = await promoteRepair(
        collector,
        incident,
        { client: requireClient(), store, runCandidate },
        'user',
      );

      emit(flags, resolved, () => {
        out(resolved.resolvedAt !== null ? 'promoted and verified in production' : 'promoted but production still failing, escalated');
        for (const step of resolved.history.slice(-3)) {
          out(`  ${step.from} to ${step.to}: ${step.reason}`);
        }
      });
      return;
    }

    case 'feed': {
      const collector = await findCollector(store, positional[0] ?? '');
      const url = flags.url ?? collector.watchUrls[0];
      if (url === undefined) throw new Error('no URL specified');
      const envelope = await buildFeed(store, collector.id, url);

      emit(flags, envelope, () => {
        out(`status: ${envelope.health.status}`);
        if (envelope.health.stale) {
          out(`STALE. Last verified ${envelope.health.lastVerified ?? 'never'}.`);
        }
        if (envelope.health.fieldsDegraded.length > 0) {
          out(`degraded: ${envelope.health.fieldsDegraded.join(', ')}`);
        }
        out(JSON.stringify(envelope.data, null, 2));
      });
      return;
    }

    default:
      out('notice collectors | check <id> | incidents [id] | show <id> | heal <id> | approve <id> | feed <id>');
      out('Flags: --json for machine-readable output, --url to target a specific page.');
      process.exitCode = command === undefined ? 0 : 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
