import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRouter } from './routes.js';
import { FileStore, ScreenshotStore } from '../store/index.js';
import type { BrightDataClient } from '../brightdata/index.js';
import type { IncidentRecord } from '../store/index.js';

/**
 * The HTTP surface had no tests at all.
 *
 * Every other suite exercises the pipeline by calling it directly, which
 * leaves the layer that decides who is allowed to call it entirely unproven.
 * `assertAdmin` is the only thing between the open internet and chargeable
 * Bright Data runs, Self-Healing triggers and repair promotion, so its
 * behaviour deserves the same scrutiny as the promotion guards.
 *
 * These drive a real server over a real socket rather than calling handlers
 * directly, because the things most likely to break here are statuses,
 * headers and content types, none of which a direct call would exercise.
 */

const TOKEN = 'a'.repeat(64);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

let server: Server;
let base: string;
let store: FileStore;
let screenshots: ScreenshotStore;

/** The routes under test never reach Bright Data. */
const client = {} as BrightDataClient;

function incident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: 'inc-1',
    collectorId: 'col-1',
    runId: 'run-1',
    classification: 'extractor_drift',
    confidence: 0.9,
    affectedFields: ['price'],
    evidence: ['collector and witness disagree'],
    witness: null,
    screenshotId: null,
    repairPrompt: null,
    history: [],
    gateResults: [],
    quarantined: true,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    ...overrides,
  };
}

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notice-routes-'));
  store = new FileStore(join(directory, 'notice.json'));
  screenshots = new ScreenshotStore(join(directory, 'notice.json'));
  process.env['NOTICE_ADMIN_TOKEN'] = TOKEN;

  const router = buildRouter({ store, client, screenshots });
  server = createServer((request, response) => void router.handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  delete process.env['NOTICE_ADMIN_TOKEN'];
  delete process.env['NOTICE_CORS_ORIGIN'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('authorization on mutating routes', () => {
  it('refuses a write with no token', async () => {
    const response = await fetch(`${base}/api/collectors`, { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('refuses a write with the wrong token', async () => {
    const response = await fetch(`${base}/api/collectors`, {
      method: 'POST',
      headers: { authorization: `Bearer ${'b'.repeat(64)}` },
    });
    expect(response.status).toBe(401);
  });

  it('refuses a token of the right value but the wrong length', async () => {
    const response = await fetch(`${base}/api/collectors`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN.slice(0, 32)}` },
    });
    expect(response.status).toBe(401);
  });

  it('disables writes entirely when no token is configured, rather than opening them', async () => {
    delete process.env['NOTICE_ADMIN_TOKEN'];
    const response = await fetch(`${base}/api/collectors`, { method: 'POST' });
    expect(response.status).toBe(503);
  });

  it('lets reads through without a token', async () => {
    expect((await fetch(`${base}/api/collectors`)).status).toBe(200);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});

describe('the screenshot route', () => {
  it('404s for an unknown incident', async () => {
    expect((await fetch(`${base}/api/incidents/nope/screenshot`)).status).toBe(404);
  });

  it('404s when the incident recorded no capture', async () => {
    await store.saveIncident(incident());
    const response = await fetch(`${base}/api/incidents/inc-1/screenshot`);
    expect(response.status).toBe(404);
  });

  it('410s when the record outlived the file, which happens on a host with no disk', async () => {
    await store.saveIncident(incident({ screenshotId: '11111111-2222-3333-4444-555555555555' }));
    const response = await fetch(`${base}/api/incidents/inc-1/screenshot`);
    // Not a 404: the incident exists and did have a capture. Saying "gone"
    // rather than "never existed" is the difference between a redeploy and a
    // bug in the dashboard.
    expect(response.status).toBe(410);
  });

  it('serves the bytes as an image, not as JSON', async () => {
    const id = await screenshots.save(PNG);
    await store.saveIncident(incident({ screenshotId: id }));

    const response = await fetch(`${base}/api/incidents/inc-1/screenshot`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(PNG.byteLength));

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toEqual(PNG);
  });

  it('needs no token, so the dashboard can use a plain img tag', async () => {
    const id = await screenshots.save(PNG);
    await store.saveIncident(incident({ screenshotId: id }));
    delete process.env['NOTICE_ADMIN_TOKEN'];

    expect((await fetch(`${base}/api/incidents/inc-1/screenshot`)).status).toBe(200);
  });
});

describe('transport behaviour', () => {
  it('returns JSON for an unknown path rather than an HTML error page', async () => {
    const response = await fetch(`${base}/nothing/here`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ error: 'not found' });
  });

  it('echoes the configured origin and varies on it', async () => {
    process.env['NOTICE_CORS_ORIGIN'] = 'https://dashboard.example.com';
    const response = await fetch(`${base}/api/health`);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://dashboard.example.com',
    );
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('treats a blank origin as unset instead of emitting an empty header', async () => {
    // A hosting dashboard stores a field left blank as an empty string, and an
    // empty allow-origin header fails every browser request while curl keeps
    // working.
    process.env['NOTICE_CORS_ORIGIN'] = '   ';
    const response = await fetch(`${base}/api/health`);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers a preflight without running a handler', async () => {
    const response = await fetch(`${base}/api/collectors`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
  });
});

describe('correcting a registered collector', () => {
  const collector = {
    brightDataCollectorId: 'c_abc123',
    name: 'Fixture',
    targetDomain: 'example.test',
    watchUrls: ['https://example.test/p'],
    witnessSpecs: [
      {
        path: 'price',
        meaning: 'The purchase price.',
        labels: ['result'],
        excludeLabels: [],
        kind: 'money',
        allowed: [],
      },
    ],
  };

  async function create(): Promise<{ id: string }> {
    const response = await fetch(`${base}/api/collectors`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(collector),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { id: string };
  }

  /**
   * Registration used to be a one-way door. The field most likely to need
   * correcting is `witnessSpecs`, and a loose label there produces a confident
   * wrong verdict rather than a visible error: a spec labelled "result" against
   * a page whose header reads "1 result" made the witness match the count line
   * and report drift on a page where nothing was wrong.
   */
  it('replaces a witness spec without disturbing the rest of the record', async () => {
    const created = await create();

    const response = await fetch(`${base}/api/collectors/${created.id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        witnessSpecs: [
          {
            path: 'price',
            meaning: 'The purchase price.',
            labels: ['price'],
            excludeLabels: ['featured'],
            kind: 'money',
            allowed: [],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const after = await store.getCollector(created.id);
    expect(after?.witnessSpecs[0]?.labels).toEqual(['price']);
    expect(after?.brightDataCollectorId).toBe('c_abc123');
    expect(after?.watchUrls).toEqual(['https://example.test/p']);
    expect(after?.name).toBe('Fixture');
  });

  it('leaves untouched fields alone when only one is supplied', async () => {
    const created = await create();

    await fetch(`${base}/api/collectors/${created.id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ freshnessMinutes: 90 }),
    });

    const after = await store.getCollector(created.id);
    expect(after?.freshnessMinutes).toBe(90);
    expect(after?.witnessSpecs[0]?.labels).toEqual(['result']);
  });

  it('refuses without the admin token', async () => {
    const created = await create();
    const response = await fetch(`${base}/api/collectors/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ freshnessMinutes: 90 }),
    });
    expect(response.status).toBe(401);
  });

  it('404s for a collector that does not exist', async () => {
    const response = await fetch(`${base}/api/collectors/missing`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ freshnessMinutes: 90 }),
    });
    expect(response.status).toBe(404);
  });
});

describe('refusing an operation that does not apply', () => {
  /**
   * A 500 tells a caller the server broke. Rejecting an incident with no
   * proposed repair is not a server fault, it is a request that does not
   * apply, and the two must not look the same: the first invites a retry and
   * a bug report, the second invites reading the message.
   *
   * This route used to call Bright Data before asking whether there was
   * anything to reject, so their 404 surfaced here as our 500.
   */
  it('409s when rejecting an incident with no proposed repair', async () => {
    // The incident has to point at a collector that exists, or the request
    // fails at collector lookup and never reaches the guard under test.
    const created = await fetch(`${base}/api/collectors`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        brightDataCollectorId: 'c_reject1',
        name: 'Fixture',
        targetDomain: 'example.test',
        watchUrls: ['https://example.test/p'],
        witnessSpecs: [
          {
            path: 'price',
            meaning: 'The purchase price.',
            labels: ['price'],
            excludeLabels: [],
            kind: 'money',
            allowed: [],
          },
        ],
      }),
    });
    const collector = (await created.json()) as { id: string };

    await store.saveIncident(
      incident({ id: 'no-candidate', collectorId: collector.id, history: [] }),
    );

    const response = await fetch(`${base}/api/incidents/no-candidate/reject`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/no proposed repair to reject/);
  });

  it('names the offending field when a registration body is invalid', async () => {
    const response = await fetch(`${base}/api/collectors`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'missing everything else' }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('brightDataCollectorId');
  });
});

describe('the impact report', () => {
  /**
   * The number this endpoint exists to publish is a claim about what the
   * system prevented, which makes it the easiest number in the project to
   * overstate by accident. This asserts it stays reachable without a token and
   * stays anchored to real records.
   */
  it('reports what was withheld, without a token', async () => {
    const created = await fetch(`${base}/api/collectors`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        brightDataCollectorId: 'c_impact1',
        name: 'Impact fixture',
        targetDomain: 'example.test',
        watchUrls: ['https://example.test/p'],
        witnessSpecs: [
          {
            path: 'price',
            meaning: 'The purchase price.',
            labels: ['price'],
            excludeLabels: [],
            kind: 'money',
            allowed: [],
          },
        ],
      }),
    });
    const collector = (await created.json()) as { id: string };

    await store.saveRun({
      id: 'run-impact',
      collectorId: collector.id,
      brightDataSnapshotId: null,
      targetUrls: ['https://example.test/p'],
      version: 'production',
      rows: [{ price: 25 }],
      // Everything a conventional pipeline could check, passing.
      checks: [
        {
          checkId: 'structure:required:price',
          field: 'price',
          status: 'pass',
          severity: 1,
          confidence: 1,
          explanation: 'price is present',
        },
      ],
      durationMs: 12,
      observedAt: new Date().toISOString(),
    });

    await store.saveIncident(
      incident({ id: 'inc-impact', collectorId: collector.id, runId: 'run-impact' }),
    );

    const response = await fetch(`${base}/api/stats/impact`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      withheld: number;
      silent: number;
      fields: string[];
      examples: { field: string; shipped: unknown }[];
    };

    expect(body.withheld).toBe(1);
    expect(body.silent).toBe(1);
    expect(body.fields).toEqual(['price']);
    expect(body.examples[0]).toMatchObject({ field: 'price', shipped: 25 });
  });
});

describe('an incident carries the run that caused it', () => {
  /**
   * The incident page argues about what the collector returned. Until the run
   * came back with it, that page could show what a repair produces and what
   * the page says, but not the wrong value itself.
   */
  it('returns the run alongside the incident', async () => {
    await store.saveRun({
      id: 'run-1',
      collectorId: 'col-1',
      brightDataSnapshotId: null,
      targetUrls: ['https://example.test/p'],
      version: 'production',
      rows: [{ price: { value: 25, currency: 'USD' } }],
      checks: [],
      durationMs: 12,
      observedAt: new Date().toISOString(),
    });
    await store.saveIncident(incident({ id: 'inc-with-run', runId: 'run-1' }));

    const response = await fetch(`${base}/api/incidents/inc-with-run`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { run: { id: string; rows: unknown[] } | null };
    expect(body.run?.id).toBe('run-1');
    expect(body.run?.rows[0]).toEqual({ price: { value: 25, currency: 'USD' } });
  });

  it('returns null rather than failing when the run has aged out of the store', async () => {
    await store.saveIncident(incident({ id: 'inc-no-run', runId: 'run-gone' }));

    const response = await fetch(`${base}/api/incidents/inc-no-run`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { run: unknown }).run).toBeNull();
  });
});
