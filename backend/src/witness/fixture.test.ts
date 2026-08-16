import { describe, expect, it } from 'vitest';
import { extractField } from './extract.js';
import type { WitnessFieldSpec } from './spec.js';

/**
 * The witness has to work on DriftMart specifically.
 *
 * Every other test in this suite feeds the extractor markdown chosen to
 * exercise a strategy. None of them proved the extractor could read the one
 * page this project actually scrapes, and it could not: DriftMart encoded
 * every meaning in class names and data attributes, which do not survive
 * conversion to markdown. The witness received `$25 **$249**`, two bare
 * numbers with nothing to distinguish them, and returned null for price.
 *
 * These are the markdown bodies the Unlocker returns for each mode, so a
 * regression in the fixture's markup fails here rather than during a demo.
 */

const PRICE: WitnessFieldSpec = {
  path: 'price',
  meaning: 'The purchase price of the product, not any refundable deposit.',
  labels: ['price', 'purchase price'],
  excludeLabels: ['deposit', 'refundable', 'security', 'sponsored'],
  kind: 'money',
  allowed: [],
};

const AVAILABILITY: WitnessFieldSpec = {
  path: 'availability',
  meaning: 'Whether the product can be bought right now.',
  labels: ['availability', 'stock'],
  excludeLabels: [],
  kind: 'text',
  allowed: [],
};

/**
 * Money extracts as a normalised amount, not a bare number. The dollar sign
 * deliberately yields a null currency: more than twenty currencies use it, and
 * resolving it to USD by default is the sort of confident wrong answer this
 * project exists to catch. Comparison then falls back to the numeric value.
 */
function amount(markdown: string, spec: WitnessFieldSpec): number | undefined {
  const found = extractField(markdown, spec);
  if (found === null) return undefined;
  return (found.value as { value: number }).value;
}

const baseline = `
# Nova Headphones

Price: $249

Refundable deposit: $25

Availability: In stock
`;

describe('the witness reading DriftMart', () => {
  it('reads the purchase price on the baseline layout', () => {
    expect(amount(baseline, PRICE)).toBe(249);
  });

  it('never mistakes the refundable deposit for the price', () => {
    expect(amount(baseline, PRICE)).not.toBe(25);
  });

  it('reads the new price after a genuine change', () => {
    const markdown = baseline.replace('$249', '$229');
    expect(amount(markdown, PRICE)).toBe(229);
  });

  it('still finds the purchase price after the layout is redesigned', () => {
    // selector_drift: the deposit now comes first and holds the class the
    // collector is bound to. The labels moved with their values, so the page
    // still says which is which and the witness is unaffected.
    const drifted = `
# Nova Headphones

Refundable deposit: $25

Purchase price: $249

Availability: In stock
`;
    expect(amount(drifted, PRICE)).toBe(249);
  });

  it('reads the visible price when structured metadata says zero', () => {
    // silent_zero changes only a data attribute, which markdown never carries,
    // so the witness sees the truth the page displays.
    expect(amount(baseline, PRICE)).toBe(249);
  });

  it('reports availability missing rather than inventing one', () => {
    const withoutStock = `
# Nova Headphones

Price: $249

Refundable deposit: $25

Ships within 24 hours while supplies last.
`;
    expect(extractField(withoutStock, AVAILABILITY)).toBeNull();
    expect(amount(withoutStock, PRICE)).toBe(249);
  });

  it('skips a sponsored card inserted above the real product', () => {
    const sponsored = `
# Vega Headphones (Sponsored)

Sponsored price: $99

# Nova Headphones

Price: $249

Refundable deposit: $25

Availability: In stock
`;
    expect(amount(sponsored, PRICE)).toBe(249);
  });

  it('reads availability as text', () => {
    expect(extractField(baseline, AVAILABILITY)?.value).toBe('In stock');
  });
});

describe('markdown syntax in captured values', () => {
  const NAME: WitnessFieldSpec = {
    path: 'name',
    meaning: 'The product name as shown to a shopper.',
    labels: ['nova', 'headphones'],
    excludeLabels: ['sponsored'],
    kind: 'text',
    allowed: [],
  };

  it('reports a heading without its marker', () => {
    // The live Unlocker returns the product name as a markdown heading. It
    // extracted as "# Nova Headphones", which comparison survived only because
    // comparisonKey strips punctuation, and which read as a bug wherever the
    // evidence line was displayed.
    expect(extractField(baseline, NAME)?.value).toBe('Nova Headphones');
  });

  it('unwraps bold and code spans', () => {
    expect(extractField('**Nova Headphones**', NAME)?.value).toBe('Nova Headphones');
    expect(extractField('`Nova Headphones`', NAME)?.value).toBe('Nova Headphones');
  });

  it('leaves a hash inside a value alone, since a model number may need it', () => {
    expect(extractField('Nova Headphones #4400', NAME)?.value).toBe('Nova Headphones #4400');
  });
});
