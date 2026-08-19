import { describe, expect, it } from 'vitest';
import { aggregateChecks } from '../shared/index.js';
import { learnContract, type BaselineRun } from './learn.js';
import { hasHardFailure, hasSuspicion, validateRun } from './validate.js';
import type { CollectorContract, Invariant } from './types.js';

/**
 * These scenarios mirror the DriftMart fault-injection modes, so the contract
 * layer is graded against the same cases the demo will show.
 */

const HEALTHY_ROW = {
  name: 'Nova Headphones',
  price: { value: 249, currency: 'USD' },
  deposit: { value: 25, currency: 'USD' },
  availability: 'in_stock',
  sku: 'NOVA-001',
};

function baseline(count: number, overrides: Record<string, unknown> = {}): BaselineRun[] {
  return Array.from({ length: count }, (_, index) => ({
    // Vary the price slightly so the profile learns a real spread rather than
    // a constant, which is what a genuine baseline looks like.
    rows: [{ ...HEALTHY_ROW, price: { value: 249 + (index % 3), currency: 'USD' }, ...overrides }],
    observedAt: new Date(Date.now() - index * 3_600_000).toISOString(),
  }));
}

const INVARIANTS: Invariant[] = [
  { kind: 'required', field: 'name' },
  { kind: 'range', field: 'price.value', min: 1 },
  { kind: 'compare', left: 'price.value', op: '>', right: 'deposit.value' },
  { kind: 'currency', field: 'price', allowed: ['USD'] },
  { kind: 'enum', field: 'availability', allowed: ['in_stock', 'out_of_stock', 'preorder'] },
  { kind: 'unique', field: 'sku' },
];

describe('learnContract', () => {
  it('reports low confidence on a thin baseline', () => {
    const contract = learnContract('c_test', baseline(2), INVARIANTS);
    expect(contract.sampleCount).toBe(2);
    expect(contract.confidence).toBeLessThan(0.35);
  });

  it('grows confidence with more runs but never reaches certainty', () => {
    expect(learnContract('c_test', baseline(20), INVARIANTS).confidence).toBeGreaterThan(0.75);
    expect(learnContract('c_test', baseline(500), INVARIANTS).confidence).toBeLessThan(1);
  });

  it('learns required fields and currency from the baseline', () => {
    const contract = learnContract('c_test', baseline(10), INVARIANTS);
    expect(contract.requiredFields).toContain('name');
    expect(contract.requiredFields).toContain('availability');

    const priceProfile = contract.profiles.find((p) => p.path === 'price.value');
    expect(priceProfile?.currencies).toBeUndefined();
    const priceCurrency = contract.profiles.find((p) => p.path === 'price.currency');
    expect(priceCurrency).toBeDefined();
  });
});

describe('validateRun', () => {
  const contract = learnContract('c_test', baseline(10), INVARIANTS);

  it('passes healthy output', () => {
    const results = validateRun({ rows: [HEALTHY_ROW], contract });
    expect(hasHardFailure(results)).toBe(false);
    expect(hasSuspicion(results)).toBe(false);
  });

  it('catches selector drift where price captures the deposit', () => {
    // DriftMart `selector_drift`. Schema-valid, plausible, and wrong: the
    // collector now reads the refundable deposit as the purchase price.
    const drifted = { ...HEALTHY_ROW, price: { value: 25, currency: 'USD' } };
    const results = validateRun({ rows: [drifted], contract });

    expect(hasHardFailure(results)).toBe(true);
    const breach = results.find((r) => r.checkId.startsWith('invariant:compare'));
    expect(breach?.status).toBe('fail');
    expect(breach?.explanation).toContain('violates');
  });

  it('catches the silent zero', () => {
    // DriftMart `silent_zero`. Nothing throws, the field is populated, and the
    // value is impossible.
    const zeroed = { ...HEALTHY_ROW, price: { value: 0, currency: 'USD' } };
    const results = validateRun({ rows: [zeroed], contract });
    expect(hasHardFailure(results)).toBe(true);
  });

  it('catches a currency swap that leaves the magnitude plausible', () => {
    const swapped = { ...HEALTHY_ROW, price: { value: 249, currency: 'EUR' } };
    const results = validateRun({ rows: [swapped], contract });
    expect(hasHardFailure(results)).toBe(true);
  });

  it('treats a genuine price change as unremarkable, not a failure', () => {
    // DriftMart `genuine_price_change`. The world moved. Nothing here should
    // hard-fail, because hard-failing would send a working collector to be
    // rewritten.
    const changed = { ...HEALTHY_ROW, price: { value: 229, currency: 'USD' } };
    const results = validateRun({ rows: [changed], contract });
    expect(hasHardFailure(results)).toBe(false);
  });

  it('reports an empty result as a failure rather than silence', () => {
    const results = validateRun({ rows: [], contract });
    const empty = results.find((r) => r.checkId === 'structure:empty_result');
    expect(empty?.status).toBe('fail');
    expect(empty?.explanation).toContain('nothing found');
  });

  it('surfaces an explicit collector error', () => {
    const results = validateRun({
      rows: [{ error: 'Parse error: value must be finite number', error_code: 'parse_error' }],
      contract,
    });
    const failure = results.find((r) => r.checkId === 'structure:collector_error');
    expect(failure?.status).toBe('fail');
  });

  it('catches pagination collapse through duplicate identifiers', () => {
    // DriftMart `pagination_collapse`. Row count is plausible and every row is
    // individually valid; only the distinct-value ratio gives it away.
    const repeated = [HEALTHY_ROW, HEALTHY_ROW, HEALTHY_ROW];
    const results = validateRun({ rows: repeated, contract });
    const unique = results.find((r) => r.checkId === 'invariant:unique:sku');
    expect(unique?.status).toBe('fail');
    expect(unique?.explanation).toContain('same page repeatedly');
  });

  it('catches a missing required field', () => {
    const { availability, ...withoutAvailability } = HEALTHY_ROW;
    void availability;
    const results = validateRun({ rows: [withoutAvailability], contract });
    expect(hasHardFailure(results)).toBe(true);
  });

  it('disables statistical checks until the baseline is large enough', () => {
    const thin = learnContract('c_test', baseline(2), INVARIANTS);
    const results = validateRun({ rows: [HEALTHY_ROW], contract: thin });
    const gate = results.find((r) => r.checkId === 'learned:insufficient_baseline');
    expect(gate?.status).toBe('unknown');
  });
});

describe('aggregateChecks', () => {
  const contract = learnContract('c_test', baseline(10), INVARIANTS);

  it('excludes unevaluable checks from the score instead of counting them as passes', () => {
    const results = validateRun({ rows: [HEALTHY_ROW], contract });
    const summary = aggregateChecks(results);
    expect(summary.evaluated).toBeLessThanOrEqual(summary.total);
    expect(summary.weightedFailure).toBe(0);
  });

  it('scores a drifted run above a healthy one', () => {
    const healthy = aggregateChecks(validateRun({ rows: [HEALTHY_ROW], contract }));
    const drifted = aggregateChecks(
      validateRun({ rows: [{ ...HEALTHY_ROW, price: { value: 25, currency: 'USD' } }], contract }),
    );
    expect(drifted.weightedFailure).toBeGreaterThan(healthy.weightedFailure);
  });
});


describe('a baseline that never varied', () => {
  /**
   * The worst bug this project has had, because it hid on exactly the sources
   * anyone would trust most.
   *
   * `robustZScore` returns null when the spread is zero and documents that the
   * caller must treat it as "cannot judge" rather than "passed". The validator
   * did neither: it emitted no check at all. Since the witness is woken only by
   * a `fail` or a `warn`, a price that had read 249 on every single observation
   * could come back as 99 and be published as verified with the second sensor
   * never asked. The steadier the source, the blinder the check.
   */
  function constantBaseline(value: number): CollectorContract {
    return learnContract(
      'col-1',
      Array.from({ length: 8 }, () => ({
        rows: [{ price: { value, currency: 'USD' } }],
        observedAt: new Date().toISOString(),
      })),
      [{ kind: 'required', field: 'price' }],
    );
  }

  it('warns when a value departs from a baseline that has never moved', () => {
    const checks = validateRun({
      rows: [{ price: { value: 99, currency: 'USD' } }],
      contract: constantBaseline(249),
    });

    const numeric = checks.find((check) => check.checkId === 'learned:numeric:price.value');
    expect(numeric?.status).toBe('warn');
    expect(numeric?.explanation).toContain('every observation until now');
  });

  it('wakes the witness, which is the whole point of the warn', () => {
    // `observeOnce` fetches the second sensor when any check fails or warns.
    // Before the fix nothing was emitted at all, so this condition was false
    // and the wrong value went straight into the verified feed.
    const checks = validateRun({
      rows: [{ price: { value: 99, currency: 'USD' } }],
      contract: constantBaseline(249),
    });

    expect(checks.some((check) => check.status === 'fail' || check.status === 'warn')).toBe(true);
  });

  it('warns rather than fails, because a constant baseline is not proof of anything', () => {
    // A steady price genuinely can move. The warn buys one witness read and
    // decides nothing; the classifier resolves it as a source change or as
    // drift on the evidence.
    const checks = validateRun({
      rows: [{ price: { value: 99, currency: 'USD' } }],
      contract: constantBaseline(249),
    });

    expect(checks.find((check) => check.checkId === 'learned:numeric:price.value')?.status).not.toBe(
      'fail',
    );
  });

  it('stays quiet when the value has not moved', () => {
    const checks = validateRun({
      rows: [{ price: { value: 249, currency: 'USD' } }],
      contract: constantBaseline(249),
    });

    expect(checks.find((check) => check.checkId === 'learned:numeric:price.value')).toBeUndefined();
  });

  it('still uses the spread when the baseline has one', () => {
    const varied = learnContract(
      'col-1',
      [249, 250, 251, 249, 250, 251, 249, 250].map((value) => ({
        rows: [{ price: { value, currency: 'USD' } }],
        observedAt: new Date().toISOString(),
      })),
      [{ kind: 'required', field: 'price' }],
    );

    const checks = validateRun({ rows: [{ price: { value: 99, currency: 'USD' } }], contract: varied });
    const numeric = checks.find((check) => check.checkId === 'learned:numeric:price.value');

    expect(numeric?.status).toBe('warn');
    expect(numeric?.explanation).toContain('robust deviations');
  });
});
