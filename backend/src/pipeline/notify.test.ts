import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyIncident } from './notify.js';
import type { IncidentRecord } from '../store/index.js';

/**
 * Detection that reaches no human is indistinguishable from no detection: the
 * outcome is the same, someone finds out days later from the damage. These
 * cover the two things that matter about a notification, which are that it
 * says something useful and that it can never cost a quarantine.
 */

function incident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: 'inc-1',
    collectorId: 'col-1',
    runId: 'run-1',
    classification: 'extractor_drift',
    confidence: 0.9,
    affectedFields: ['price'],
    evidence: [
      'row 0: "price" is 0, outside 1..+inf',
      '"price": collector reported 0, witness read 249 from "Price: $249"',
    ],
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

const sent = (): { url: string; body: Record<string, unknown> } => {
  const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
    string,
    { body: string },
  ];
  return { url: call[0], body: JSON.parse(call[1].body) as Record<string, unknown> };
};

afterEach(() => void vi.restoreAllMocks());

describe('incident notification', () => {
  it('does nothing when no webhook is configured', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await notifyIncident({}, incident(), 'DriftMart')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats a blank webhook as unset, the way a dashboard stores an empty field', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await notifyIncident({ webhookUrl: '   ' }, incident(), 'DriftMart')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('leads with both values, because that is the whole story', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    await notifyIncident({ webhookUrl: 'https://hooks.example.com/x' }, incident(), 'DriftMart');

    const { body } = sent();
    // `text` is the field Slack and Discord render.
    expect(String(body['text'])).toContain('witness read 249');
    expect(String(body['text'])).toContain('withheld from the feed');
    expect(body['classification']).toBe('extractor_drift');
  });

  it('links to the incident when a dashboard URL is known', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    await notifyIncident(
      { webhookUrl: 'https://hooks.example.com/x', dashboardUrl: 'https://dash.example.com/' },
      incident(),
      'DriftMart',
    );
    expect(sent().body['url']).toBe('https://dash.example.com/incidents/inc-1');
  });

  it('stays quiet when the collector was right and the site changed', async () => {
    // Waking someone to say nothing is wrong is how alerts get muted, and a
    // muted alert is worse than none because it looks like coverage.
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await notifyIncident(
      { webhookUrl: 'https://hooks.example.com/x' },
      incident({ classification: 'genuine_source_change', quarantined: false }),
      'DriftMart',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('speaks up when the witness could not be read at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const delivered = await notifyIncident(
      { webhookUrl: 'https://hooks.example.com/x' },
      incident({ classification: 'inconclusive' }),
      'DriftMart',
    );
    // Arguably the most important case: the system has stopped being able to
    // check, and silence looks exactly like everything being fine.
    expect(delivered).toBe(true);
  });

  it('swallows a webhook failure rather than losing the incident', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('chat service is down');
      }),
    );
    await expect(
      notifyIncident({ webhookUrl: 'https://hooks.example.com/x' }, incident(), 'DriftMart'),
    ).resolves.toBe(false);
  });

  it('reports a rejected webhook without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect(
      await notifyIncident({ webhookUrl: 'https://hooks.example.com/x' }, incident(), 'DriftMart'),
    ).toBe(false);
  });
});
