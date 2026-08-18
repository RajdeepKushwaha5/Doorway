/**
 * Drive the deployed NOTICE from a terminal.
 *
 * The `notice` CLI operates on a local file store, which is right for
 * development and wrong for a demonstration: it would report an incident that
 * the deployed dashboard knows nothing about, because they are two different
 * stores. Everything here goes over HTTP to the running API, so the terminal
 * and the dashboard are the same system and a viewer can watch one change the
 * other.
 *
 * Usage:
 *   npm run live -- <command>
 *
 *   status                     the fleet, its contracts and open incidents
 *   run <collector>            observe once and classify
 *   observe-all                observe every collector, sequentially
 *   incidents                  every incident, newest first
 *   show <incident>            full evidence for one incident
 *   heal <incident>            queue a repair and follow the job
 *   approve <incident>         promote a candidate that passed the gate
 *   reject <incident>          discard a candidate
 *   feed <collector>           what a consumer actually receives
 *   mode <name>                switch the DriftMart fixture
 *   modes                      list the fixture's modes
 *
 * Environment:
 *   NOTICE_API_BASE         defaults to the deployed API
 *   NOTICE_ADMIN_TOKEN      required for anything that mutates
 *   DRIFTMART_URL           defaults to the deployed fixture
 *   DRIFTMART_ADMIN_TOKEN   required for `mode`
 */

const API = (process.env['NOTICE_API_BASE'] ?? 'https://notice-api-0vfo.onrender.com').replace(
  /\/+$/,
  '',
);
const FIXTURE = (process.env['DRIFTMART_URL'] ?? 'https://driftmart-3ut8.onrender.com').replace(
  /\/+$/,
  '',
);

const out = (text: string): void => void process.stdout.write(`${text}\n`);
const rule = (): void => out('-'.repeat(72));

function adminToken(): string {
  const token = process.env['NOTICE_ADMIN_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error('NOTICE_ADMIN_TOKEN is not set, and every mutating route requires it.');
  }
  return token.trim();
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const body: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : text;
    throw new Error(`${String(response.status)} ${message}`);
  }
  return body;
}

const authed = (path: string, body?: unknown): Promise<unknown> =>
  call(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken()}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Resolve a `c_...` id or a NOTICE uuid to the record NOTICE uses internally. */
async function resolveCollector(reference: string): Promise<{ id: string; name: string }> {
  const collectors = (await call('/api/collectors')) as {
    id: string;
    name: string;
    brightDataCollectorId: string;
  }[];
  const match = collectors.find(
    (collector) => collector.id === reference || collector.brightDataCollectorId === reference,
  );
  if (match === undefined) {
    throw new Error(
      collectors.length === 0
        ? 'no collectors are registered yet'
        : `no collector matching "${reference}"`,
    );
  }
  return { id: match.id, name: match.name };
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async status() {
    const collectors = (await call('/api/collectors')) as Record<string, unknown>[];
    if (collectors.length === 0) {
      out('No collectors registered yet.');
      return;
    }
    for (const collector of collectors) {
      rule();
      out(`${String(collector['name'])}   ${String(collector['brightDataCollectorId'])}`);
      out(`  open incidents   ${String(collector['openIncidents'])}`);
      out(`  baseline runs    ${String(collector['baselineRuns'])}`);
      out(`  confidence       ${String(collector['contractConfidence'])}`);
    }
    rule();
  },

  async run([reference]) {
    const collector = await resolveCollector(reference ?? '');
    out(`Observing ${collector.name}. A real collector run takes a while.`);
    const result = (await authed(`/api/collectors/${collector.id}/run`)) as Record<string, unknown>;
    out(JSON.stringify(result, null, 2));
  },

  /**
   * Observe every registered collector, one after another.
   *
   * Sequential on purpose. Each observation spends two page loads from the same
   * monthly allowance, and firing them together makes a burst that the budget
   * guard can only notice after the fact.
   *
   * One collector failing must not stop the rest: a fleet check that abandons
   * everything after the first sleeping target is worse than no check, because
   * the sources after it are silently never looked at.
   */
  async 'observe-all'() {
    const collectors = (await call('/api/collectors')) as Record<string, unknown>[];
    if (collectors.length === 0) {
      out('No collectors registered yet.');
      return;
    }

    let failed = 0;
    for (const collector of collectors) {
      const name = String(collector['name']);
      const id = String(collector['id']);
      rule();
      out(`Observing ${name} ...`);
      try {
        const result = (await authed(`/api/collectors/${id}/run`)) as Record<string, unknown>;
        const incident = result['incident'] as Record<string, unknown> | null;
        const verdict = incident === null ? 'healthy' : String(incident['classification']);
        out(`  verdict      ${verdict}`);
        out(`  publishable  ${String(result['publishable'])}`);
      } catch (error) {
        failed += 1;
        out(`  FAILED       ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    rule();
    out(`${String(collectors.length - failed)} of ${String(collectors.length)} observed.`);

    // A non-zero exit when every single one failed, so a scheduled job can tell
    // "the fleet is fine" apart from "nothing was reachable".
    if (failed === collectors.length) process.exitCode = 1;
  },

  async incidents() {
    const incidents = (await call('/api/incidents')) as Record<string, unknown>[];
    if (incidents.length === 0) {
      out('No incidents. Every collector agrees with its witness.');
      return;
    }
    for (const incident of incidents) {
      out(
        `${String(incident['id']).slice(0, 8)}  ${String(incident['verdict']).padEnd(24)} ${
          incident['quarantined'] === true ? 'quarantined' : 'published'
        }`,
      );
    }
  },

  async show([id]) {
    out(JSON.stringify(await call(`/api/incidents/${id ?? ''}`), null, 2));
  },

  async heal([id]) {
    const queued = (await authed(`/api/incidents/${id ?? ''}/heal`)) as { jobId?: string };
    const jobId = queued.jobId;
    if (jobId === undefined) {
      out(JSON.stringify(queued, null, 2));
      return;
    }
    out(`Queued as job ${jobId}. Bright Data can take several minutes.`);

    // Poll rather than hold a request open. The API returns 202 precisely so a
    // proxy timeout cannot abandon a repair that is already in flight.
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const job = (await call(`/api/jobs/${jobId}`)) as { status?: string; error?: string };
      out(`  ${new Date().toISOString().slice(11, 19)}  ${String(job.status)}`);
      if (job.status === 'succeeded' || job.status === 'failed') {
        if (job.error !== undefined) out(`  ${job.error}`);
        return;
      }
    }
  },

  async approve([id]) {
    out(JSON.stringify(await authed(`/api/incidents/${id ?? ''}/approve`), null, 2));
  },

  async reject([id]) {
    out(JSON.stringify(await authed(`/api/incidents/${id ?? ''}/reject`), null, 2));
  },

  async feed([reference]) {
    const collector = await resolveCollector(reference ?? '');
    out(JSON.stringify(await call(`/api/feed/${collector.id}`), null, 2));
  },

  /**
   * Recreate the demo state in one command.
   *
   * The free tier has no persistent disk, so the store resets whenever the
   * service restarts or wakes from idle. That is survivable only if getting
   * back to a useful state takes seconds. Rebuilding it by hand before a
   * recording is how a demo starts late and flustered.
   *
   * Registers the collector if it is missing and leaves it there. Running it
   * is deliberately a separate step, because a run spends page loads and the
   * operator should choose when.
   */
  /**
   * Recreate the demo state in one command.
   *
   * The free tier has no persistent disk, so the store resets whenever the
   * service restarts or wakes from idle. Rebuilding it by hand before a
   * recording is how a demo starts late, so this registers every known
   * collector and skips the ones already there.
   *
   * Running them is deliberately separate: a run spends page loads, and the
   * operator should choose when.
   */
  async register([only]) {
    const known = [
      {
        // Rebuilt on 2026-08-16 against the labelled markup. The previous
        // collector returned 0 and Self-Healing would not promote a fix.
        id: process.env['NOTICE_DEMO_COLLECTOR'] ?? 'c_msvllpds1n1dcoz8qx',
        name: 'DriftMart headphones',
        url: `${FIXTURE}/product/headphones`,
        field: 'price',
        meaning:
          'The purchase price of the product, not a refundable deposit, shipping fee or sponsored listing price.',
        labels: ['price', 'purchase price'],
        exclude: ['deposit', 'refundable', 'security', 'sponsored'],
        golden: [{ label: 'baseline', url: `${FIXTURE}/fixtures/baseline`, expected: { price: 249 } }],
      },
      {
        id: 'c_msvk2zahnc2mizts6',
        name: 'Books to Scrape',
        url: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
        field: 'price_excl_tax',
        meaning: 'The price of the book excluding tax, not the tax amount and not a shipping fee.',
        labels: ['price', 'price excl'],
        exclude: ['shipping', 'sponsored', 'incl'],
        golden: [],
      },
    ].filter((candidate) => only === undefined || candidate.id === only);

    const existing = (await call('/api/collectors')) as { brightDataCollectorId: string }[];

    for (const entry of known) {
      if (existing.some((candidate) => candidate.brightDataCollectorId === entry.id)) {
        out(`${entry.id}  already registered`);
        continue;
      }

      const created = (await authed('/api/collectors', {
        brightDataCollectorId: entry.id,
        name: entry.name,
        targetDomain: new URL(entry.url).hostname,
        watchUrls: [entry.url],
        witnessSpecs: [
          {
            path: entry.field,
            meaning: entry.meaning,
            labels: entry.labels,
            excludeLabels: entry.exclude,
            kind: 'money',
            allowed: [],
          },
        ],
        // Declared, never inferred. A rule learned from a broken run protects
        // nothing, so the field must exist and must be at least 1, which is
        // what catches a silent zero with no baseline at all.
        invariants: [
          { kind: 'required', field: entry.field },
          { kind: 'range', field: entry.field, min: 1 },
        ],
        protectedFields: [entry.field],
        goldenCases: entry.golden,
        // Non-null so the scheduler will observe it. isDue skips a collector
        // with no schedule, which quietly made autonomy impossible.
        schedule: 'every 6 hours',
      })) as { id: string };

      out(`${entry.id}  registered as ${created.id}`);
    }

    out('');
    out('Next:  npm run live -- status');
  },

  async modes() {
    const response = await fetch(`${FIXTURE}/api/admin/mode`);
    out(JSON.stringify(await response.json(), null, 2));
  },

  async mode([name]) {
    const token = process.env['DRIFTMART_ADMIN_TOKEN'];
    if (token === undefined || token.trim() === '') {
      throw new Error('DRIFTMART_ADMIN_TOKEN is not set, so the fixture cannot be switched.');
    }
    const response = await fetch(`${FIXTURE}/api/admin/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token.trim()}` },
      body: JSON.stringify({ mode: name }),
    });
    if (!response.ok) throw new Error(`mode switch failed: ${String(response.status)}`);
    out(JSON.stringify(await response.json(), null, 2));
  },
};

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const handler = command === undefined ? undefined : commands[command];

  if (handler === undefined) {
    out(`API:     ${API}`);
    out(`Fixture: ${FIXTURE}`);
    out('');
    out(`Commands: ${Object.keys(commands).sort().join(', ')}`);
    return;
  }

  await handler(args);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
