import { describe, expect, it } from 'vitest';
import { extractField } from './extract.js';
import { findCrossFieldMatch, observeMarkdown, reconcile } from './compare.js';
import type { WitnessFieldSpec } from './spec.js';

/**
 * The DriftMart product page, as Bright Data's markdown path renders it.
 * `selector_drift` keeps these visible values identical and only moves the
 * DOM, which is what makes the witness able to see the truth the collector
 * lost.
 */
const DRIFTMART_MARKDOWN = `
# DriftMart

Nova Headphones

Purchase price: $249
Refundable deposit: $25
Availability: In stock
`.trim();

const SPECS: WitnessFieldSpec[] = [
  {
    path: 'name',
    meaning: 'The product title',
    labels: ['Nova Headphones', 'product'],
    excludeLabels: [],
    kind: 'text',
    allowed: [],
  },
  {
    path: 'price',
    meaning: 'The current non-refundable purchase price',
    labels: ['purchase price', 'price'],
    excludeLabels: ['deposit', 'refundable', 'mrp', 'was'],
    kind: 'money',
    allowed: [],
  },
  {
    path: 'deposit',
    meaning: 'The refundable security deposit',
    labels: ['refundable deposit', 'deposit'],
    excludeLabels: [],
    kind: 'money',
    allowed: [],
  },
  {
    path: 'availability',
    meaning: 'Whether the item can be bought now',
    labels: ['availability', 'in stock'],
    excludeLabels: [],
    kind: 'enum',
    allowed: ['in_stock', 'out_of_stock', 'preorder'],
  },
];

describe('extractField', () => {
  it('reads a labelled price and records where it found it', () => {
    const found = extractField(DRIFTMART_MARKDOWN, SPECS[1]!);
    expect(found?.value).toEqual({ value: 249, currency: null });
    expect(found?.evidence.strategy).toBe('labelled-line');
    expect(found?.evidence.line).toContain('Purchase price');
  });

  it('does not read the deposit as the price', () => {
    // The whole product rests on this. Without excludeLabels a naive
    // extractor takes the first currency amount it sees, agrees with a
    // drifted collector, and NOTICE reports health while the data is wrong.
    const price = extractField(DRIFTMART_MARKDOWN, SPECS[1]!);
    expect((price?.value as { value: number }).value).not.toBe(25);
  });

  it('reads the deposit when that is what was asked for', () => {
    const deposit = extractField(DRIFTMART_MARKDOWN, SPECS[2]!);
    expect((deposit?.value as { value: number }).value).toBe(25);
  });

  it('maps prose to a canonical enum value', () => {
    const availability = extractField(DRIFTMART_MARKDOWN, SPECS[3]!);
    expect(availability?.value).toBe('in_stock');
  });

  it('returns null rather than guessing when the field is absent', () => {
    const missing = extractField('# Some unrelated page\n\nNothing here.', SPECS[1]!);
    expect(missing).toBeNull();
  });

  it('refuses a bare-currency guess when several amounts are candidates', () => {
    const ambiguous = 'Nova Headphones\n\n$249\n$25\n$99\n';
    const spec: WitnessFieldSpec = { ...SPECS[1]!, labels: ['nonexistent-label'] };
    expect(extractField(ambiguous, spec)).toBeNull();
  });

  it('uses a bare currency amount only when it is the only one', () => {
    const single = 'Nova Headphones\n\n$249\n';
    const spec: WitnessFieldSpec = { ...SPECS[1]!, labels: ['nonexistent-label'] };
    const found = extractField(single, spec);
    expect(found?.evidence.strategy).toBe('bare-currency');
    expect(found?.confidence).toBeLessThan(0.5);
  });

  it('reads a markdown table row', () => {
    const table = '| Field | Value |\n| --- | --- |\n| Purchase price | $249 |\n';
    const found = extractField(table, SPECS[1]!);
    expect((found?.value as { value: number }).value).toBe(249);
    expect(found?.evidence.strategy).toBe('table-row');
  });
});

describe('reconcile', () => {
  const observation = observeMarkdown(
    'https://driftmart.example/product/headphones',
    DRIFTMART_MARKDOWN,
    SPECS,
    new Date().toISOString(),
  );

  it('hashes the body so evidence can be shown unedited', () => {
    expect(observation.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('agrees with a healthy collector row', () => {
    const row = {
      name: 'Nova Headphones',
      price: { value: 249, currency: 'USD' },
      deposit: { value: 25, currency: 'USD' },
      availability: 'in_stock',
    };
    const summary = reconcile(row, observation, SPECS);
    expect(summary.disagreed).toHaveLength(0);
    expect(summary.agreementRate).toBe(1);
  });

  it('disagrees when the collector reads the deposit as the price', () => {
    const drifted = {
      name: 'Nova Headphones',
      price: { value: 25, currency: 'USD' },
      deposit: { value: 25, currency: 'USD' },
      availability: 'in_stock',
    };
    const summary = reconcile(drifted, observation, SPECS);
    expect(summary.disagreed).toContain('price');
  });

  it('names the field the collector actually captured', () => {
    // This is what turns "price is wrong" into an instruction the healer can
    // act on: the collector's price equals what the witness read as deposit.
    const drifted = {
      name: 'Nova Headphones',
      price: { value: 25, currency: 'USD' },
      deposit: { value: 25, currency: 'USD' },
      availability: 'in_stock',
    };
    const summary = reconcile(drifted, observation, SPECS);
    expect(findCrossFieldMatch('price', summary)).toContain('deposit');
  });

  it('agrees when the price genuinely changed on both sensors', () => {
    const changedMarkdown = DRIFTMART_MARKDOWN.replace('$249', '$229');
    const changedObservation = observeMarkdown(
      'https://driftmart.example/product/headphones',
      changedMarkdown,
      SPECS,
      new Date().toISOString(),
    );
    const row = {
      name: 'Nova Headphones',
      price: { value: 229, currency: 'USD' },
      deposit: { value: 25, currency: 'USD' },
      availability: 'in_stock',
    };
    const summary = reconcile(row, changedObservation, SPECS);
    expect(summary.disagreed).toHaveLength(0);
  });

  it('counts a missing witness value as incomparable, never as disagreement', () => {
    const sparse = observeMarkdown(
      'https://driftmart.example/product/headphones',
      '# DriftMart\n\nNova Headphones\n',
      SPECS,
      new Date().toISOString(),
    );
    const row = {
      name: 'Nova Headphones',
      price: { value: 249, currency: 'USD' },
      deposit: null,
      availability: 'in_stock',
    };
    const summary = reconcile(row, sparse, SPECS);
    expect(summary.disagreed).toHaveLength(0);
    expect(summary.incomparable.length).toBeGreaterThan(0);
    expect(summary.coverage).toBeLessThan(1);
  });

  it('reports the weakest evidence behind any disagreement', () => {
    const drifted = {
      name: 'Nova Headphones',
      price: { value: 25, currency: 'USD' },
      deposit: { value: 25, currency: 'USD' },
      availability: 'in_stock',
    };
    const summary = reconcile(drifted, observation, SPECS);
    expect(summary.weakestDisagreementConfidence).toBeGreaterThan(0.5);
  });
});
