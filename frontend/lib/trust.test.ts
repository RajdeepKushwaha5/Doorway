import { describe, expect, it } from 'vitest';
import { buildPoints, countOutcomes, numberAt, outcomeOf } from './trust';
import type { CollectorSummary, Incident, RunRecord } from './types';

/**
 * The history is drawn from records, so the reading of those records is the
 * only part that can lie. A chart that quietly turns a missing field into zero,
 * or paints a real source change red, would make a false claim more
 * persuasively than any sentence on the page.
 */

function collector(overrides: Partial<CollectorSummary> = {}): CollectorSummary {
  return {
    id: 'col-1',
    brightDataCollectorId: 'c_trust1',
    createdAt: '2026-08-01T00:00:00.000Z',
    name: 'DriftMart headphones',
    targetDomain: 'driftmart.test',
    status: 'active',
    watchUrls: ['https://driftmart.test/p'],
    protectedFields: [],
    witnessSpecs: [
      {
        path: 'price',
        meaning: 'The purchase price.',
        labels: ['price'],
        excludeLabels: ['deposit'],
        kind: 'money',
        allowed: [],
      },
    ],
    autoPromote: 'never',
    openIncidents: 0,
    contractVersion: 1,
    contractConfidence: 0.5,
    baselineRuns: 8,
    ...overrides,
  };
}

function run(id: string, row: unknown, at: string): RunRecord {
  return {
    id,
    collectorId: 'col-1',
    targetUrls: ['https://driftmart.test/p'],
    rows: [row],
    checks: [],
    durationMs: 10,
    observedAt: at,
  };
}

function incident(runId: string, classification: Incident['classification']): Incident {
  return {
    id: `inc-${runId}`,
    collectorId: 'col-1',
    runId,
    classification,
    confidence: 0.9,
    affectedFields: ['price'],
    evidence: [],
    witness: null,
    screenshotId: null,
    repairPrompt: null,
    history: [],
    gateResults: [],
    quarantined: classification === 'extractor_drift',
    acquisition: null,
    pageIdentity: null,
    createdAt: '2026-08-19T10:00:00.000Z',
    resolvedAt: null,
  };
}

describe('reading a value out of a stored row', () => {
  it('unwraps the normalized money shape', () => {
    expect(numberAt({ price: { value: 249, currency: 'USD' } }, 'price')).toBe(249);
  });

  it('reads a plain number and a nested path', () => {
    expect(numberAt({ price: 249 }, 'price')).toBe(249);
    expect(numberAt({ price: { value: 249 } }, 'price.value')).toBe(249);
  });

  it('returns null for an absent field rather than zero', () => {
    // Drawn as a gap in the line. Zero would be a price the collector never
    // reported, plotted as though it had.
    expect(numberAt({ title: 'Nova' }, 'price')).toBeNull();
    expect(numberAt(null, 'price')).toBeNull();
    expect(numberAt({ price: 'two hundred' }, 'price')).toBeNull();
  });
});

describe('what happened to each observation', () => {
  it('treats no incident and a healthy incident alike', () => {
    expect(outcomeOf(undefined)).toBe('published');
    expect(outcomeOf(incident('r', 'healthy'))).toBe('published');
  });

  it('separates a broken extractor from a page that genuinely moved', () => {
    expect(outcomeOf(incident('r', 'extractor_drift'))).toBe('withheld');
    expect(outcomeOf(incident('r', 'explicit_failure'))).toBe('withheld');
    expect(outcomeOf(incident('r', 'genuine_source_change'))).toBe('source_changed');
  });

  it('does not colour a refusal to judge as a failure', () => {
    expect(outcomeOf(incident('r', 'inconclusive'))).toBe('quarantined');
    expect(outcomeOf(incident('r', 'access_anomaly'))).toBe('quarantined');
  });
});

describe('the history as a whole', () => {
  const runs = [
    run('r3', { price: { value: 25, currency: 'USD' } }, '2026-08-19T12:00:00.000Z'),
    run('r2', { price: { value: 229, currency: 'USD' } }, '2026-08-19T11:00:00.000Z'),
    run('r1', { price: { value: 249, currency: 'USD' } }, '2026-08-19T10:00:00.000Z'),
  ];

  it('draws oldest first, whatever order the store returned', () => {
    const { points } = buildPoints(collector(), runs, []);
    expect(points.map((point) => point.runId)).toEqual(['r1', 'r2', 'r3']);
    expect(points.map((point) => point.value)).toEqual([249, 229, 25]);
  });

  it('marks the drifted run withheld and the genuine drop as a source change', () => {
    const { points } = buildPoints(collector(), runs, [
      incident('r3', 'extractor_drift'),
      incident('r2', 'genuine_source_change'),
    ]);

    expect(points.map((point) => point.outcome)).toEqual([
      'published',
      'source_changed',
      'withheld',
    ]);
    expect(points[2]?.incidentId).toBe('inc-r3');
    expect(countOutcomes(points)).toMatchObject({
      published: 1,
      source_changed: 1,
      withheld: 1,
      quarantined: 0,
    });
  });

  it('picks the declared field, not whichever number happens to be first', () => {
    const { field } = buildPoints(
      collector({
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
      [run('r1', { rank: 4, price: { value: 249 } }, '2026-08-19T10:00:00.000Z')],
      [],
    );

    expect(field).toBe('price');
  });

  it('reports no chartable field rather than inventing one', () => {
    const { field, points } = buildPoints(
      collector({ witnessSpecs: [] }),
      [run('r1', { title: 'Nova' }, '2026-08-19T10:00:00.000Z')],
      [],
    );

    expect(field).toBeNull();
    expect(points[0]?.value).toBeNull();
  });
});
