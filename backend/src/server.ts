import { createServer } from 'node:http';
import {
  BrightDataClient,
  createWitnessFetcher,
  scrapeMarkdown,
} from './brightdata/index.js';
import { startWorkerLoop } from './worker/index.js';
import { buildRouter } from './api/routes.js';
import { FileStore } from './store/index.js';

/**
 * NOTICE API entry point.
 *
 * Fails fast on a missing key rather than starting and returning 500s on the
 * first collector run, because a server that looks healthy and cannot do its
 * job is the exact failure mode this project is about.
 */
function main(): void {
  const apiKey = process.env['BRIGHTDATA_API_KEY'];
  if (apiKey === undefined || apiKey.trim() === '') {
    process.stderr.write(
      'BRIGHTDATA_API_KEY is not set. Copy .env.example to .env and fill it in.\n',
    );
    process.exit(1);
  }

  const port = Number(process.env['PORT'] ?? 4000);
  const store = new FileStore(process.env['NOTICE_DATA_FILE']);
  const client = new BrightDataClient({
    apiKey,
    ...(process.env['BRIGHTDATA_API_BASE'] === undefined
      ? {}
      : { baseUrl: process.env['BRIGHTDATA_API_BASE'] }),
    onEvent: (event) => {
      process.stdout.write(`${new Date().toISOString()} brightdata.${event.type}\n`);
    },
  });

  // Prefer the HTTP Unlocker path when a zone is configured. A deployed host
  // has no `bdata` binary, and the witness is the one thing that must keep
  // working there.
  const fetchMarkdown = createWitnessFetcher(
    {
      apiKey,
      zone: process.env['BRIGHTDATA_UNLOCKER_ZONE'],
      country: process.env['BRIGHTDATA_UNLOCKER_COUNTRY'],
    },
    (url) => scrapeMarkdown(url),
  );
  if (process.env['BRIGHTDATA_UNLOCKER_ZONE'] === undefined) {
    process.stdout.write(
      [
        'BRIGHTDATA_UNLOCKER_ZONE is not set.',
        'Witness fetches will fall back to the bdata CLI, which does not exist on a deployed host.',
        '',
      ].join('\n'),
    );
  }

  const router = buildRouter({ store, client, fetchMarkdown });
  const server = createServer((request, response) => {
    void router.handle(request, response);
  });

  server.listen(port, () => {
    process.stdout.write(`NOTICE API listening on http://localhost:${port}\n`);
  });

  // Optionally run the monitoring loop inside this process.
  //
  // The API and the worker normally run as separate services, which is the
  // right shape when they can share a database or a mounted disk. On a host
  // where they cannot, two services means two filesystems and two divergent
  // copies of every incident, so one process owning both is the only correct
  // arrangement rather than a convenience.
  if (process.env['NOTICE_RUN_WORKER_IN_PROCESS'] === 'true') {
    process.stdout.write('Running the monitoring worker in this process.\n');
    void startWorkerLoop({
      store,
      client,
      workerId: `inproc-${String(process.pid)}`,
      runCandidate: async (collectorId, url) => {
        // The HTTP API, not the `bdata` CLI. There is no CLI binary on a
        // deployed host, so shelling out here left the repair gate working on
        // a laptop and broken everywhere it actually runs.
        const { rows } = await client.runCollector(collectorId, [url], {
          version: 'dev',
          timeoutMs: 600_000,
        });
        return rows;
      },
      tickIntervalMs: Number(process.env['NOTICE_SCHEDULER_INTERVAL_S'] ?? 60) * 1000,
      minIntervalMs: Number(process.env['NOTICE_MIN_INTERVAL_S'] ?? 21_600) * 1000,
      maxPerTick: Number(process.env['NOTICE_MAX_PER_TICK'] ?? 5),
      ...(fetchMarkdown === undefined ? {} : { fetchMarkdown }),
    });
  }

  const shutdown = (signal: string): void => {
    process.stdout.write(`\n${signal} received, closing server\n`);
    server.close(() => process.exit(0));
    // Do not hang forever on a stuck connection during a demo.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
