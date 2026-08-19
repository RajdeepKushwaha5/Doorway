import { describe, expect, it } from 'vitest';
import { computeImpact } from './impact.js';
import type { CheckResult } from '../shared/index.js';
import type { IncidentRecord, RunRecord } from '../store/types.js';

/**
 * The counterfactual has to be conservative in every direction that flatters
 * it. These tests exist to hold that line: a real page change must not be
 * counted as a save, and a failure a schema already catches must not be
 * counted as silent.
 */

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1',
    collectorId: 'col-1',
    brightDataSnapshotId: null,
    targetUrls: ['https://example.test/p'],
    version: 'production',
    rows: [{ price: 25, availability: 'In stock' }],
    checks: [],
    durationMs: 10,
    observedAt: '2026-08-19T10:00:00.000Z',
    ...overrides,
  };
}

function incident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: 'inc-1',
    collectorId: 'col-1',
    runId: 'run-1',
    classification: 'extractor_drift',
    confidence: 0.9,
    affectedFields: ['price'],
    evidence: [],
    witness: {
      url: 'https://example.test/p',
      fetchedAt: '2026-08-19T10:00:01.000Z',
      contentHash: 'abc',
      excerpt: '',
      values: [
        {
          path: 'price',
          value: 249,
          confidence: 0.85,
          evidence: {
            line: 'Purchase price: **$249**',
            lineNumber: 4,
            strategy: 'labelled-line',
          },
        },
      ],
      notFound: [],
    },
    repairPrompt: null,
    screenshotId: null,
    history: [],
    gateResults: [],
    quarantined: true,
    createdAt: '2026-08-19T10:00:02.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

const passing: CheckResult = {
  checkId: 'structure:required:price',
  field: 'price',
  status: 'pass',
  severity: 1,
  confidence: 1,
  explanation: 'price is present',
};

const failing: CheckResult = {
  checkId: 'structure:empty_result',
  status: 'fail',
  severity: 1,
  confidence: 1,
  explanation: 'the collector returned nothing',
};

describe('the counterfactual', () => {
  it('names the value that would have shipped, and the one on the page', () => {
    const stats = computeImpact([run({ checks: [passing] })], [incident()]);

    expect(stats.withheld).toBe(1);
    expect(stats.silent).toBe(1);
    expect(stats.fields).toEqual(['price']);
    expect(stats.examples[0]).toMatchObject({
      field: 'price',
      shipped: 25,
      actual: 249,
      evidence: 'Purchase price: **$249**',
      silent: true,
    });
  });

  it('does not call a failure silent when a conventional check already caught it', () => {
    const stats = computeImpact(
      [run({ checks: [failing], rows: [] })],
      [incident({ classification: 'explicit_failure' })],
    );

    expect(stats.withheld).toBe(1);
    expect(stats.silent).toBe(0);
  });

  it('refuses to count a real page change as something it saved anyone from', () => {
    const stats = computeImpact(
      [run({ checks: [passing] })],
      [incident({ classification: 'genuine_source_change' })],
    );

    expect(stats.withheld).toBe(0);
    expect(stats.silent).toBe(0);
    expect(stats.restrained).toBe(1);
  });

  it('counts a refusal to judge as a quarantine, not as a catch', () => {
    const stats = computeImpact(
      [run({ checks: [passing] })],
      [incident({ classification: 'inconclusive', witness: null })],
    );

    expect(stats.withheld).toBe(0);
    expect(stats.quarantined).toBe(1);
  });

  it('counts one withheld value per affected field', () => {
    const stats = computeImpact(
      [run({ checks: [passing], rows: [{ price: 25, availability: 'Out of stock' }] })],
      [incident({ affectedFields: ['price', 'availability'] })],
    );

    expect(stats.withheld).toBe(2);
    expect(stats.fields).toEqual(['availability', 'price']);
    // The witness had nothing to say about availability, and the record says so
    // rather than inventing a comparison.
    expect(stats.examples.find((value) => value.field === 'availability')?.actual).toBeUndefined();
  });

  it('counts an observation as published only when nothing was wrong with it', () => {
    const stats = computeImpact(
      [run({ id: 'run-1' }), run({ id: 'run-2' }), run({ id: 'run-3' })],
      [incident({ runId: 'run-1' }), incident({ id: 'inc-2', runId: 'run-2', classification: 'healthy' })],
    );

    expect(stats.runs).toBe(3);
    expect(stats.published).toBe(2);
  });

  it('reports zeroes rather than throwing on an empty store', () => {
    const stats = computeImpact([], []);

    expect(stats).toMatchObject({ runs: 0, withheld: 0, silent: 0, published: 0 });
    expect(stats.firstAt).toBeNull();
    expect(stats.examples).toEqual([]);
  });

  it('shows the newest withheld values first', () => {
    const stats = computeImpact(
      [run({ id: 'run-1' }), run({ id: 'run-2' })],
      [
        incident({ id: 'old', runId: 'run-1', createdAt: '2026-08-01T00:00:00.000Z' }),
        incident({ id: 'new', runId: 'run-2', createdAt: '2026-08-18T00:00:00.000Z' }),
      ],
    );

    expect(stats.examples.map((value) => value.incidentId)).toEqual(['new', 'old']);
  });
});
