import { createServer } from 'node:http';
import {
  BrightDataClient,
  createWitnessFetcher,
  fetchWitnessScreenshot,
  scrapeMarkdown,
} from './brightdata/index.js';
import { startWorkerLoop } from './worker/index.js';
import { buildRouter } from './api/routes.js';
import { FileStore, ScreenshotStore, seedCollectors } from './store/index.js';
import { OpportunityIndex, seedIndex } from './crawl/index-store.js';
import { notifyIncident, reportIncidentToGitHub } from './pipeline/index.js';

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
  const screenshots = new ScreenshotStore(process.env['NOTICE_DATA_FILE']);
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
      device: process.env['BRIGHTDATA_UNLOCKER_DEVICE'] === 'mobile' ? 'mobile' : 'desktop',
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

  // Capture a picture of the page when an incident opens, if a zone exists.
  // Without one there is nothing to capture through, and the pipeline simply
  // records no image rather than failing.
  const zone = process.env['BRIGHTDATA_UNLOCKER_ZONE'];
  const captureScreenshot =
    zone === undefined || zone.trim() === ''
      ? undefined
      : async (target: string): Promise<string> => {
          const shot = await fetchWitnessScreenshot(
            {
              apiKey,
              zone: zone.trim(),
              ...(process.env['BRIGHTDATA_UNLOCKER_COUNTRY'] === undefined
                ? {}
                : { country: process.env['BRIGHTDATA_UNLOCKER_COUNTRY'] }),
            },
            target,
          );
          return screenshots.save(shot.png);
        };

  // Announce incidents to a webhook, when one is configured. Slack, Discord
  // and every incident tool accept an inbound URL taking JSON, so one
  // mechanism covers all of them.
  const notify = {
    webhookUrl: process.env['NOTICE_WEBHOOK_URL'],
    dashboardUrl: process.env['NOTICE_DASHBOARD_URL'],
  };
  // Two destinations, one call. A chat message tells people now; an issue
  // gives the defect an owner and a close date, which is what a team actually
  // works from. Both are optional and neither can affect the verdict.
  const github = {
    repository: process.env['NOTICE_GITHUB_REPO'],
    token: process.env['NOTICE_GITHUB_TOKEN'],
    dashboardUrl: process.env['NOTICE_DASHBOARD_URL'],
    apiUrl: process.env['NOTICE_PUBLIC_API_URL'],
  };

  const announce = async (
    incident: Parameters<typeof notifyIncident>[1],
    name: string,
  ): Promise<void> => {
    await Promise.allSettled([
      notifyIncident(notify, incident, name),
      reportIncidentToGitHub(github, incident, name),
    ]);
  };

  /*
   * Live discovery, when the credentials for it exist.
   *
   * The same key and the same unlocker zone the witness already uses. Passing
   * it explicitly rather than reading the environment inside the route keeps
   * the "is this feature on" decision in one place, where the server can also
   * say so at startup instead of failing under a student's hand.
   */
  const discoveryKey = process.env['BRIGHTDATA_API_KEY'];
  const discoveryZone = process.env['BRIGHTDATA_UNLOCKER_ZONE'];
  const discoveryCountry = process.env['DISCOVERY_COUNTRY'];
  const discovery =
    discoveryKey === undefined || discoveryZone === undefined
      ? undefined
      : {
          apiKey: discoveryKey,
          zone: discoveryZone,
          ...(discoveryCountry === undefined || discoveryCountry.trim() === ''
            ? {}
            : { country: discoveryCountry.trim().toLowerCase() }),
        };

  const router = buildRouter({
    store,
    client,
    fetchMarkdown,
    screenshots,
    ...(captureScreenshot === undefined ? {} : { captureScreenshot }),
    notifyIncident: announce,
    ...(discovery === undefined ? {} : { discovery }),
  });
  const server = createServer((request, response) => {
    void router.handle(request, response);
  });

  // Restore the fleet when the store comes up empty, which on a host with no
  // persistent disk is after every restart and every wake from idle. Only when
  // it is empty, so a curated fleet is never overwritten, and without running
  // anything, because a restart must not quietly spend the monthly allowance.
  /*
   * The index travels with the code, because the disk does not survive.
   *
   * Every restart on a free tier begins with an empty index, so the first
   * student of the day would get the product at its worst. Crawling on boot
   * would fix it and spend hundreds of paid requests each time the instance
   * wakes, which is often. The shipped file is real crawl output, loaded only
   * into an empty index, so it can never overwrite what a live crawl found.
   */
  void seedIndex(
    new OpportunityIndex(process.env['DOORWAY_INDEX_FILE']),
    process.env['DOORWAY_INDEX_SEED'] ?? '../seed-index.json',
  ).then(
    (result) => {
      if (result.seeded > 0) {
        process.stdout.write(`Loaded ${String(result.seeded)} indexed opportunities into an empty index.
`);
      }
    },
    () => undefined,
  );

  void seedCollectors(store, process.env['NOTICE_SEED_FILE'] ?? '../seed-collectors.json').then(
    (result) => {
      if (result.seeded > 0) {
        process.stdout.write(`Seeded ${String(result.seeded)} collector(s) into an empty store.
`);
      }
    },
  );

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
      notifyIncident: announce,
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
