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
 *   npm run live --workspace backend -- <command>
 *
 *   status                     the fleet, its contracts and open incidents
 *   run <collector>            observe once and classify
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
