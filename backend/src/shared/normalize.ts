/**
 * Value normalization.
 *
 * The collector emits structured JSON. The witness emits prose. Comparing them
 * only works if both sides are reduced to the same canonical form first, and
 * most false incidents come from normalization gaps rather than real drift:
 * `"£53.74"` versus `53.74`, `"In stock (20 available) In stock"` versus
 * `"in_stock"`, `1.234,56` versus `1234.56`.
 *
 * Every function here is pure and total. Anything unparseable returns a null
 * result rather than throwing or guessing, because a wrong guess here becomes a
 * wrong repair prompt downstream.
 */

/** A currency amount reduced to a comparable form. */
export interface NormalizedMoney {
  /** Numeric magnitude. Always a finite number. */
  value: number;
  /** ISO 4217 code when determinable, otherwise null. */
  currency: string | null;
  /** The input this was derived from, kept for evidence display. */
  raw: string;
}

/**
 * Symbols that map unambiguously to one currency.
 *
 * `$` is deliberately absent. It is used by more than twenty currencies, and
 * resolving it to USD by default is exactly the kind of silent wrong answer
 * this project exists to catch. Callers that know the currency should pass a
 * hint instead.
 */
const UNAMBIGUOUS_SYMBOLS: ReadonlyMap<string, string> = new Map([
  ['£', 'GBP'],
  ['€', 'EUR'],
  ['¥', 'JPY'],
  ['₹', 'INR'],
  ['₽', 'RUB'],
  ['₩', 'KRW'],
  ['₪', 'ILS'],
  ['₦', 'NGN'],
  ['₫', 'VND'],
  ['฿', 'THB'],
  ['₴', 'UAH'],
  ['₺', 'TRY'],
]);

const ISO_CODE = /\b([A-Z]{3})\b/;

/**
 * Parse a number that may use either decimal convention.
 *
 * Both `1,234.56` and `1.234,56` appear on real pages, sometimes on the same
 * site under different locales, and a single-separator value like `1,199` is
 * genuinely ambiguous between one thousand one hundred and ninety nine, and
 * one point one nine nine.
 *
 * The rules, in order:
 *
 * 1. Both separators present: the one appearing last is the decimal separator.
 * 2. One separator appearing once, followed by exactly three digits: treat it
 *    as a thousands separator. Money is rarely quoted to three decimals, and
 *    `₹1,199` is far more likely to be 1199 than 1.199.
 * 3. One separator appearing once, followed by any other digit count: decimal.
 * 4. One separator repeated: thousands grouping, but only if every group after
 *    the first is exactly three digits. This rejects version strings like
 *    `1.2.3` instead of silently reading them as 123.
 *
 * @returns The parsed number, or null when the input is not a single number.
 */
export function parseLooseNumber(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  // Strip everything that cannot be part of a number, keeping separators.
  const cleaned = trimmed.replace(/[^0-9.,\-]/g, '');
  if (cleaned === '' || !/[0-9]/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  const digitsAndSeparators = cleaned.replace(/-/g, '');

  const commaCount = (digitsAndSeparators.match(/,/g) ?? []).length;
  const dotCount = (digitsAndSeparators.match(/\./g) ?? []).length;

  let canonical: string;

  if (commaCount === 0 && dotCount === 0) {
    canonical = digitsAndSeparators;
  } else if (commaCount > 0 && dotCount > 0) {
    // Rule 1: mixed separators, the last one is the decimal point.
    const decimalSeparator =
      digitsAndSeparators.lastIndexOf(',') > digitsAndSeparators.lastIndexOf('.') ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    const parts = digitsAndSeparators.split(decimalSeparator);
    if (parts.length !== 2) return null;
    const whole = (parts[0] ?? '').split(thousandsSeparator).join('');
    canonical = `${whole}.${parts[1] ?? ''}`;
  } else {
    const separator = commaCount > 0 ? ',' : '.';
    const groups = digitsAndSeparators.split(separator);
    const occurrences = groups.length - 1;
    const tail = groups[groups.length - 1] ?? '';

    if (occurrences === 1) {
      // Rules 2 and 3.
      canonical = tail.length === 3 ? groups.join('') : `${groups[0] ?? ''}.${tail}`;
    } else {
      // Rule 4: repeated separator is only valid as thousands grouping.
      const everyGroupIsATriple = groups.slice(1).every((group) => group.length === 3);
      if (!everyGroupIsATriple) return null;
      canonical = groups.join('');
    }
  }

  if (canonical === '' || canonical === '.') return null;

  const parsed = Number(`${negative ? '-' : ''}${canonical}`);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Extract a currency amount from arbitrary text or a structured value.
 *
 * @param input Either a string such as `"£53.74"` or an object such as
 *   `{ value: 53.74, currency: "GBP" }`.
 * @param currencyHint Used only when the input carries no currency of its own.
 *   Supply the collector's declared currency when parsing witness prose.
 */
export function normalizeMoney(input: unknown, currencyHint?: string): NormalizedMoney | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const value = typeof record['value'] === 'number' ? record['value'] : null;
    if (value === null || !Number.isFinite(value)) return null;
    const currency = typeof record['currency'] === 'string' ? record['currency'].toUpperCase() : null;
    return {
      value,
      currency: currency ?? currencyHint?.toUpperCase() ?? null,
      raw: JSON.stringify(input),
    };
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return { value: input, currency: currencyHint?.toUpperCase() ?? null, raw: String(input) };
  }

  if (typeof input !== 'string') return null;

  const raw = input.trim();
  if (raw === '') return null;

  const value = parseLooseNumber(raw);
  if (value === null) return null;

  let currency: string | null = null;
  for (const [symbol, code] of UNAMBIGUOUS_SYMBOLS) {
    if (raw.includes(symbol)) {
      currency = code;
      break;
    }
  }
  if (currency === null) {
    const isoMatch = ISO_CODE.exec(raw.toUpperCase());
    if (isoMatch?.[1] !== undefined) currency = isoMatch[1];
  }

  return { value, currency: currency ?? currencyHint?.toUpperCase() ?? null, raw };
}

/**
 * Collapse whitespace and strip zero-width characters.
 *
 * Real pages produce values like `"In stock (20 available)\n    In stock"`
 * where the same text is duplicated by a screen-reader label. Whitespace
 * differences alone must never register as drift.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reduce text to a comparison key: lowercase, unaccented, punctuation removed.
 *
 * Use for enum-like fields where presentation varies but meaning does not.
 * Do not use for fields where case or punctuation is significant, such as a
 * SKU or a UPC.
 */
export function comparisonKey(input: string): string {
  return normalizeText(input)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

/**
 * Detect the case where a value repeats itself, such as
 * `"In stock (20 available) In stock"`.
 *
 * Returns the deduplicated form, or the original when no repetition is found.
 * Worth normalizing because a collector picking up a duplicated label is a
 * presentation quirk, not a semantic error.
 */
export function collapseSelfRepetition(input: string): string {
  const text = normalizeText(input);
  const words = text.split(' ');
  if (words.length < 2) return text;

  for (let size = Math.floor(words.length / 2); size >= 1; size--) {
    const head = words.slice(0, size).join(' ');
    const tail = words.slice(words.length - size).join(' ');
    if (comparisonKey(head) === comparisonKey(tail) && comparisonKey(head) !== '') {
      return words.slice(0, words.length - size).join(' ').trim();
    }
  }
  return text;
}

/** Outcome of comparing one collector value against one witness value. */
export type ValueAgreement =
  | { kind: 'agree'; note: string }
  | { kind: 'disagree'; note: string }
  | { kind: 'incomparable'; note: string };

/**
 * Compare a collector value against a witness value of the same field.
 *
 * `incomparable` is a first-class outcome and must not be folded into
 * `disagree`. Missing evidence is not evidence of a defect, and treating it as
 * one produces repairs for collectors that were working.
 *
 * @param relativeTolerance Fractional difference tolerated on numbers, to
 *   absorb rounding and tax display differences. Defaults to 0.5%.
 */
export function compareValues(
  collectorValue: unknown,
  witnessValue: unknown,
  relativeTolerance = 0.005,
): ValueAgreement {
  if (collectorValue === null || collectorValue === undefined) {
    return { kind: 'incomparable', note: 'collector produced no value' };
  }
  if (witnessValue === null || witnessValue === undefined) {
    return { kind: 'incomparable', note: 'witness produced no value' };
  }

  const collectorMoney = normalizeMoney(collectorValue);
  const witnessMoney = normalizeMoney(witnessValue);
  if (collectorMoney !== null && witnessMoney !== null) {
    const scale = Math.max(Math.abs(collectorMoney.value), Math.abs(witnessMoney.value), 1);
    const withinTolerance =
      Math.abs(collectorMoney.value - witnessMoney.value) / scale <= relativeTolerance;

    const bothCurrenciesKnown =
      collectorMoney.currency !== null && witnessMoney.currency !== null;
    const currenciesMatch = collectorMoney.currency === witnessMoney.currency;

    if (bothCurrenciesKnown && !currenciesMatch) {
      return {
        kind: 'disagree',
        note: `currency differs: collector ${collectorMoney.currency}, witness ${witnessMoney.currency}`,
      };
    }
    return withinTolerance
      ? { kind: 'agree', note: `numeric match (${collectorMoney.value})` }
      : {
          kind: 'disagree',
          note: `numeric mismatch: collector ${collectorMoney.value}, witness ${witnessMoney.value}`,
        };
  }

  if (typeof collectorValue === 'string' && typeof witnessValue === 'string') {
    const collectorKey = comparisonKey(collapseSelfRepetition(collectorValue));
    const witnessKey = comparisonKey(collapseSelfRepetition(witnessValue));
    if (collectorKey === '' || witnessKey === '') {
      return { kind: 'incomparable', note: 'a value reduced to empty after normalization' };
    }
    if (collectorKey === witnessKey) {
      return { kind: 'agree', note: 'text match after normalization' };
    }
    // Containment is treated as agreement: the witness commonly carries a
    // longer label than the collector's extracted fragment.
    if (collectorKey.includes(witnessKey) || witnessKey.includes(collectorKey)) {
      return { kind: 'agree', note: 'one value contains the other after normalization' };
    }
    return {
      kind: 'disagree',
      note: `text mismatch: collector "${collectorKey}", witness "${witnessKey}"`,
    };
  }

  if (typeof collectorValue === 'boolean' && typeof witnessValue === 'boolean') {
    return collectorValue === witnessValue
      ? { kind: 'agree', note: 'boolean match' }
      : { kind: 'disagree', note: `boolean mismatch: ${collectorValue} vs ${witnessValue}` };
  }

  return {
    kind: 'incomparable',
    note: `type mismatch: collector ${typeof collectorValue}, witness ${typeof witnessValue}`,
  };
}
