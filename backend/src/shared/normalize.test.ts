import { describe, expect, it } from 'vitest';
import {
  collapseSelfRepetition,
  compareValues,
  normalizeMoney,
  normalizeText,
  parseLooseNumber,
} from './normalize.js';

describe('parseLooseNumber', () => {
  it('parses plain decimals', () => {
    expect(parseLooseNumber('53.74')).toBe(53.74);
  });

  it('treats comma as thousands when a dot follows it', () => {
    expect(parseLooseNumber('1,234.56')).toBe(1234.56);
  });

  it('treats dot as thousands when a comma follows it', () => {
    expect(parseLooseNumber('1.234,56')).toBe(1234.56);
  });

  it('strips currency symbols and stray text', () => {
    expect(parseLooseNumber('£53.74')).toBe(53.74);
    expect(parseLooseNumber('  INR 1,199.00 ')).toBe(1199);
  });

  it('returns null rather than guessing on unparseable input', () => {
    expect(parseLooseNumber('')).toBeNull();
    expect(parseLooseNumber('in stock')).toBeNull();
    // A version string must not become a number.
    expect(parseLooseNumber('1.2.3')).toBeNull();
  });

  it('accepts repeated separators only as valid thousands grouping', () => {
    expect(parseLooseNumber('1,234,567')).toBe(1234567);
    // Groups are not triples, so this is not a grouped number.
    expect(parseLooseNumber('1.22.333')).toBeNull();
  });

  it('resolves a lone separator with three trailing digits as thousands', () => {
    // Documented, deliberate ambiguity. `1.234` is 1234 in de-DE and 1.234 in
    // en-US, and nothing in the string itself decides it. Money is rarely
    // quoted to three decimals, so thousands is the safer default.
    //
    // Known limitation: the three-decimal currencies (KWD, BHD, OMR, TND) are
    // parsed wrongly by this rule. Callers handling those must supply an
    // already-structured value rather than prose.
    expect(parseLooseNumber('1.234')).toBe(1234);
    expect(parseLooseNumber('1,199')).toBe(1199);
    // Two trailing digits is unambiguous and stays a decimal.
    expect(parseLooseNumber('1.99')).toBe(1.99);
  });
});

describe('normalizeMoney', () => {
  it('reads unambiguous currency symbols', () => {
    expect(normalizeMoney('£53.74')).toEqual({ value: 53.74, currency: 'GBP', raw: '£53.74' });
    expect(normalizeMoney('₹1,199')).toEqual({ value: 1199, currency: 'INR', raw: '₹1,199' });
  });

  it('refuses to resolve the dollar sign to a currency', () => {
    // More than twenty currencies use `$`. Guessing USD here is precisely the
    // silent wrong answer this project exists to catch.
    expect(normalizeMoney('$249')?.currency).toBeNull();
  });

  it('accepts the structured shape a collector emits', () => {
    const result = normalizeMoney({ value: 53.74, currency: 'GBP' });
    expect(result?.value).toBe(53.74);
    expect(result?.currency).toBe('GBP');
  });

  it('applies a hint only when the input carries no currency', () => {
    expect(normalizeMoney('53.74', 'gbp')?.currency).toBe('GBP');
    expect(normalizeMoney('£53.74', 'USD')?.currency).toBe('GBP');
  });

  it('rejects non-finite values', () => {
    expect(normalizeMoney({ value: Number.NaN, currency: 'GBP' })).toBeNull();
    expect(normalizeMoney(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('collapseSelfRepetition', () => {
  it('collapses the duplicated availability label seen in the kill test', () => {
    // Bright Data returned this exact shape for books.toscrape.com.
    expect(collapseSelfRepetition('In stock (20 available) In stock')).toBe(
      'In stock (20 available)',
    );
  });

  it('leaves genuinely distinct text alone', () => {
    expect(collapseSelfRepetition('In stock (20 available)')).toBe('In stock (20 available)');
  });
});

describe('normalizeText', () => {
  it('collapses whitespace and strips zero-width characters', () => {
    expect(normalizeText('  In stock \n   (20\tavailable) ')).toBe('In stock (20 available)');
    expect(normalizeText('A​B')).toBe('AB');
  });
});

describe('compareValues', () => {
  it('agrees when collector structure matches witness prose', () => {
    const result = compareValues({ value: 53.74, currency: 'GBP' }, '£53.74');
    expect(result.kind).toBe('agree');
  });

  it('flags the silent-corruption case from the kill test', () => {
    // Collector reported 0 USD while the page showed £53.74.
    const result = compareValues({ value: 0, currency: 'USD' }, '£53.74');
    expect(result.kind).toBe('disagree');
  });

  it('flags a currency swap even when the magnitude matches', () => {
    const result = compareValues({ value: 53.74, currency: 'USD' }, '£53.74');
    expect(result.kind).toBe('disagree');
    expect(result.note).toContain('currency differs');
  });

  it('catches the deposit-captured-as-price drift', () => {
    const result = compareValues({ value: 25, currency: 'USD' }, '$249');
    expect(result.kind).toBe('disagree');
  });

  it('tolerates rounding differences', () => {
    expect(compareValues(1199.0, '1199.01').kind).toBe('agree');
    expect(compareValues({ value: 53.74, currency: 'GBP' }, '£53.7').kind).toBe('agree');
  });

  it('does not tolerate a difference beyond the rounding window', () => {
    expect(compareValues(1199.0, '1150.00').kind).toBe('disagree');
  });

  it('reports incomparable rather than disagree when evidence is missing', () => {
    // Missing evidence is not evidence of a defect. Folding this into
    // `disagree` would trigger repairs on collectors that were working.
    expect(compareValues(null, '£53.74').kind).toBe('incomparable');
    expect(compareValues('£53.74', null).kind).toBe('incomparable');
    expect(compareValues({ value: 1 }, 'in stock').kind).toBe('incomparable');
  });

  it('treats containment as agreement for text fields', () => {
    const result = compareValues('In stock', 'In stock (20 available)');
    expect(result.kind).toBe('agree');
  });

  it('ignores self-repetition when comparing text', () => {
    const result = compareValues('In stock (20 available) In stock', 'In stock (20 available)');
    expect(result.kind).toBe('agree');
  });
});
