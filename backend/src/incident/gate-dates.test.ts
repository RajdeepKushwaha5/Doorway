import { describe, expect, it } from 'vitest';
import { evaluateGate } from './gate.js';
import type { CollectorContract } from '../store/index.js';
import type { WitnessFieldSpec } from '../witness/spec.js';

/**
 * The gate compared every value the same way, and a date is the one field
 * where that is catastrophic.
 *
 * A candidate returning "2026-09-18T00:00:00.000Z" against a case pinned as
 * "18 September 2026" was normalised to the numbers 20260918000000000 and
 * 182026 and reported as a numeric mismatch. That is the same day, written by
 * two authors for two audiences, and rejecting it means a repair to the
 * closing date could never be promoted no matter how correct it was.
 */

const DATE_SPEC: WitnessFieldSpec = {
  path: 'application_deadline',
  meaning: 'The date applications close.',
  labels: ['application deadline'],
  excludeLabels: [],
  kind: 'text',
  allowed: [],
  shape: 'date',
};

const contract = {
  requiredFields: [],
  invariants: [],
  confidence: 0.5,
  sampleCount: 0,
  rowCount: { median: 0 },
  fields: {},
} as unknown as CollectorContract;

const gate = (observed: string, specs: readonly WitnessFieldSpec[]) =>
  evaluateGate({
    incident: {
      url: 'https://example.test/fellowship',
      expected: { application_deadline: '18 September 2026' },
    },
    regression: [],
    candidateRowsByUrl: new Map([
      ['https://example.test/fellowship', [{ application_deadline: observed }]],
    ]),
    protectedFields: [],
    contract,
    specs,
  });

describe('the gate judging a date repair', () => {
  it('accepts a repair that returns the same day in a different format', () => {
    const decision = gate('2026-09-18T00:00:00.000Z', [DATE_SPEC]);
    expect(decision.results[0]?.passed).toBe(true);
    expect(decision.approved).toBe(true);
  });

  it('rejected that same correct repair before the spec was passed', () => {
    // Pinned so the regression cannot come back quietly: with no spec, the two
    // spellings normalise to 20260918000000000 and 182026.
    const decision = gate('2026-09-18T00:00:00.000Z', []);
    expect(decision.results[0]?.passed).toBe(false);
  });

  it('still rejects a repair that returns the wrong day', () => {
    const decision = gate('2026-09-01T00:00:00.000Z', [DATE_SPEC]);
    expect(decision.results[0]?.passed).toBe(false);
    expect(decision.approved).toBe(false);
  });

  it('still rejects a candidate that returns nothing for the field', () => {
    const decision = gate('', [DATE_SPEC]);
    expect(decision.results[0]?.passed).toBe(false);
  });
});
