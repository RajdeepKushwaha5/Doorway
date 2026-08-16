import { describe, expect, it } from 'vitest';
import { buildTools, dispatch, PROTOCOL_VERSION, type ApiReader } from './server.js';

/**
 * The refusal is the product.
 *
 * Anyone can hand an agent a scraped number. The reason this server is worth
 * connecting instead of Bright Data's own is that it declines to answer when
 * two sensors disagree, and an agent that receives no value cannot act on a
 * wrong one. These tests exist to stop that guarantee eroding into a warning
 * string that a model is free to read past.
 */

const COLLECTOR = {
  id: 'col-1',
  name: 'DriftMart headphones',
  brightDataCollectorId: 'c_abc123',
  targetDomain: 'driftmart.example',
  watchUrls: ['https://driftmart.example/product/headphones'],
  openIncidents: 0,
  contractConfidence: 0.91,
  baselineRuns: 4,
};

function reader(routes: Record<string, unknown>): ApiReader {
  return async <T>(path: string): Promise<T> => {
    const key = Object.keys(routes).find((candidate) => path.startsWith(candidate));
    if (key === undefined) throw new Error(`NOTICE API returned 404 for ${path}`);
    return routes[key] as T;
  };
}

const call = async (
  api: ApiReader,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> => {
  const response = await dispatch(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    buildTools(api),
  );
  const result = response?.result as
    | { content: { text: string }[]; isError?: boolean }
    | undefined;
  return { text: result?.content[0]?.text ?? '', isError: result?.isError === true };
};

describe('protocol', () => {
  it('announces itself on initialize', async () => {
    const response = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      buildTools(reader({})),
    );
    const result = response?.result as { protocolVersion: string; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe('notice');
  });

  it('never answers a notification, which has no id', async () => {
    // Replying to a notification is a protocol violation, and some clients
    // treat an unexpected response as fatal.
    expect(
      await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }, buildTools(reader({}))),
    ).toBeNull();
    expect(await dispatch({ jsonrpc: '2.0', method: 'tools/list' }, buildTools(reader({})))).toBeNull();
  });

  it('lists every tool with a schema', async () => {
    const response = await dispatch(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      buildTools(reader({})),
    );
    const { tools } = response?.result as { tools: { name: string; inputSchema: unknown }[] };
    expect(tools.map((tool) => tool.name)).toEqual([
      'list_monitored_sources',
      'get_verified_web_data',
      'list_open_incidents',
      'explain_verification',
    ]);
    for (const tool of tools) expect(tool.inputSchema).toBeTruthy();
  });

  it('rejects an unknown method and an unknown tool', async () => {
    const method = await dispatch(
      { jsonrpc: '2.0', id: 3, method: 'does/not/exist' },
      buildTools(reader({})),
    );
    expect(method?.error?.code).toBe(-32601);

    const tool = await dispatch(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } },
      buildTools(reader({})),
    );
    expect(tool?.error?.code).toBe(-32602);
  });
});

describe('what an agent is allowed to receive', () => {
  it('serves data when both sensors agree', async () => {
    const api = reader({
      '/api/collectors': [COLLECTOR],
      '/api/feed/': {
        data: { price: 249, availability: 'In stock' },
        health: {
          status: 'verified',
          confidence: 0.94,
          lastVerified: '2026-08-16T06:00:00.000Z',
          stale: false,
          fieldsDegraded: [],
          incidentId: null,
          reason: null,
        },
      },
    });

    const { text } = await call(api, 'get_verified_web_data', { source: 'c_abc123' });
    expect(text).toContain('VERIFIED');
    expect(text).toContain('249');
  });

  it('withholds the value entirely when quarantined, rather than warning about it', async () => {
    const api = reader({
      '/api/collectors': [COLLECTOR],
      '/api/feed/': {
        data: { price: 25 },
        health: {
          status: 'quarantined',
          confidence: 0.1,
          lastVerified: null,
          stale: false,
          fieldsDegraded: ['price'],
          incidentId: 'inc-7',
          reason: 'collector_witness_disagreement',
        },
      },
    });

    const { text } = await call(api, 'get_verified_web_data', { source: 'c_abc123' });
    expect(text).toContain('REFUSED');
    expect(text).toContain('collector_witness_disagreement');
    expect(text).toContain('inc-7');
    // The corrupt value must not appear anywhere in what the model reads. A
    // number in the context window is a number the model can repeat.
    expect(text).not.toContain('25');
  });

  it('tells the agent not to route around a refusal', async () => {
    const api = reader({
      '/api/collectors': [COLLECTOR],
      '/api/feed/': {
        data: null,
        health: {
          status: 'unavailable',
          confidence: 0,
          lastVerified: null,
          stale: false,
          fieldsDegraded: [],
          incidentId: null,
          reason: 'no_verified_snapshot',
        },
      },
    });

    const { text } = await call(api, 'get_verified_web_data', { source: 'c_abc123' });
    expect(text).toContain('REFUSED');
    expect(text.toLowerCase()).toContain('do not substitute a guess');
  });

  it('marks stale data as stale and dates it', async () => {
    const api = reader({
      '/api/collectors': [COLLECTOR],
      '/api/feed/': {
        data: { price: 249 },
        health: {
          status: 'stale',
          confidence: 0.6,
          lastVerified: '2026-08-01T00:00:00.000Z',
          stale: true,
          fieldsDegraded: [],
          incidentId: null,
          reason: 'last_known_good',
        },
      },
    });

    const { text } = await call(api, 'get_verified_web_data', { source: 'c_abc123' });
    expect(text).toContain('STALE');
    expect(text).toContain('2026-08-01');
    expect(text).toContain('Do not present it as current');
  });

  it('says plainly that nothing is verified when nothing is monitored', async () => {
    const { text } = await call(reader({ '/api/collectors': [] }), 'list_monitored_sources');
    expect(text).toContain('No sources are being monitored');
  });

  it('refuses an unknown source instead of picking one', async () => {
    const api = reader({ '/api/collectors': [COLLECTOR] });
    const { text, isError } = await call(api, 'get_verified_web_data', { source: 'something-else' });
    expect(isError).toBe(true);
    expect(text).toContain('No monitored source matches');
  });

  it('explains a verdict with its evidence', async () => {
    const api = reader({
      '/api/incidents/': {
        incident: {
          id: 'inc-7',
          collectorId: 'col-1',
          classification: 'extractor_drift',
          confidence: 0.88,
          affectedFields: ['price'],
          evidence: ['collector read 25, witness read 249'],
          quarantined: true,
          createdAt: '2026-08-16T06:00:00.000Z',
          resolvedAt: null,
        },
      },
    });

    const { text } = await call(api, 'explain_verification', { incident_id: 'inc-7' });
    expect(text).toContain('extractor_drift');
    expect(text).toContain('collector read 25, witness read 249');
  });
});
