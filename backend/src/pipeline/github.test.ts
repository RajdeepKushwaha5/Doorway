import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportIncidentToGitHub } from './github.js';
import type { IncidentRecord } from '../store/index.js';

/**
 * An incident is a defect somebody has to decide about, not an alert to
 * acknowledge, so it belongs in the tracker. These cover the two things that
 * decide whether that is useful or annoying: the issue has to carry enough to
 * rule on without opening anything else, and it must not file the same defect
 * four times a day.
 */

function incident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: 'inc-1',
    collectorId: 'col-1',
    runId: 'run-1',
    classification: 'extractor_drift',
    confidence: 0.9,
    affectedFields: ['price'],
    evidence: ['"price": collector reported 0, witness read 249 from "Price: $249"'],
    witness: {
      url: 'https://example.com/p',
      fetchedAt: new Date().toISOString(),
      contentHash: 'abc',
      values: [
        {
          path: 'price',
          value: { value: 249, currency: null },
          confidence: 0.85,
          evidence: { line: 'Price: $249', lineNumber: 13, strategy: 'labelled-line' },
        },
      ],
      notFound: [],
    },
    screenshotId: 'shot-1',
    repairPrompt: null,
    history: [],
    gateResults: [],
    quarantined: true,
    createdAt: '2026-08-16T09:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

const CONFIG = {
  repository: 'acme/data',
  token: 'ghp_test',
  dashboardUrl: 'https://dash.example.com',
  apiUrl: 'https://api.example.com',
};

/** No open issues, then a successful create. */
function stubGitHub(openIssues: { title: string; html_url: string }[] = []) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body as string });
      if ((init.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(openIssues), { status: 200 });
      }
      return new Response(JSON.stringify({ html_url: 'https://github.com/acme/data/issues/7' }), {
        status: 201,
      });
    }),
  );
  return calls;
}

afterEach(() => void vi.restoreAllMocks());

describe('filing an incident as a GitHub issue', () => {
  it('does nothing without a repository or a token', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await reportIncidentToGitHub({}, incident(), 'DriftMart')).toBeNull();
    expect(await reportIncidentToGitHub({ repository: 'acme/data' }, incident(), 'DriftMart')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('carries both readings, so a reviewer can rule on it without leaving the issue', async () => {
    const calls = stubGitHub();
    await reportIncidentToGitHub(CONFIG, incident(), 'DriftMart');

    const created = calls.find((call) => call.method === 'POST');
    const payload = JSON.parse(created?.body ?? '{}') as { title: string; body: string };
    expect(payload.title).toBe('[NOTICE] DriftMart: price is not trustworthy');
    expect(payload.body).toContain('collector reported 0, witness read 249');
    expect(payload.body).toContain('Price: $249');
    expect(payload.body).toContain('withheld from the feed');
  });

  it('embeds the capture, because an image settles what the page looked like', async () => {
    const calls = stubGitHub();
    await reportIncidentToGitHub(CONFIG, incident(), 'DriftMart');
    const payload = JSON.parse(calls.find((c) => c.method === 'POST')?.body ?? '{}') as {
      body: string;
    };
    expect(payload.body).toContain('![Rendered capture');
    expect(payload.body).toContain('https://api.example.com/api/incidents/inc-1/screenshot');
  });

  it('does not file a second issue for a fault already open', async () => {
    // A collector observed every six hours would otherwise file four issues a
    // day about one unresolved fault, and a tracker full of duplicates is one
    // people stop reading.
    const calls = stubGitHub([
      { title: '[NOTICE] DriftMart: price is not trustworthy', html_url: 'https://github.com/acme/data/issues/3' },
    ]);

    const url = await reportIncidentToGitHub(CONFIG, incident({ id: 'inc-2' }), 'DriftMart');
    expect(url).toBe('https://github.com/acme/data/issues/3');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('stays quiet when the collector was right and the site changed', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(
      await reportIncidentToGitHub(CONFIG, incident({ classification: 'genuine_source_change' }), 'DriftMart'),
    ).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('swallows a GitHub outage rather than losing the incident', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('rate limited');
      }),
    );
    await expect(reportIncidentToGitHub(CONFIG, incident(), 'DriftMart')).resolves.toBeNull();
  });

  it('labels the issue so it can be found and filtered', async () => {
    const calls = stubGitHub();
    await reportIncidentToGitHub(CONFIG, incident(), 'DriftMart');
    const payload = JSON.parse(calls.find((c) => c.method === 'POST')?.body ?? '{}') as {
      labels: string[];
    };
    expect(payload.labels).toContain('notice');
    expect(payload.labels).toContain('notice:extractor_drift');
  });
});
