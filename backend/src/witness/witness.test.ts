import { describe, expect, it } from 'vitest';
import { extractField } from './extract.js';
import { findCrossFieldMatch, observeMarkdown, reconcile } from './compare.js';
import type { WitnessFieldSpec, WitnessObservation } from './spec.js';

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

/**
 * The label is not the value, except when it is.
 *
 * Rendered to markdown, a `<dl>` puts the term on one line and its description
 * on another. That is how government portals, university pages and foundation
 * sites publish structured facts, which is most of what Doorway is pointed at.
 *
 * A text field made this mistake silently. `coerce` accepts a label as valid
 * text, so with no separator on the line the witness answered with the question:
 * it read `deadline_raw` as "Application deadline" and reported drift against a
 * collector that had read the date correctly. On a live run against a real
 * Bright Data collector that produced a false `extractor_drift`, which
 * quarantined a genuine opportunity.
 *
 * Money and number were never affected, because "Application deadline" does not
 * coerce to a number and the next-line fallback got its turn. Only text hid it.
 */
describe('definition lists', () => {
  const DEFINITION_MARKDOWN = `
# Open AI Research Fellowship

Funding

Fully funded

Application deadline

18 September 2026

Location: India
`.trim();

  const deadlineSpec: WitnessFieldSpec = {
    path: 'deadline_raw',
    meaning: 'the date applications close',
    labels: ['application deadline', 'deadline'],
    excludeLabels: ['early interest', 'notification'],
    kind: 'text',
    allowed: [],
  };

  const fundingSpec: WitnessFieldSpec = {
    path: 'funding_level',
    meaning: 'how much of the cost the award covers',
    labels: ['funding', 'award'],
    excludeLabels: [],
    kind: 'text',
    allowed: [],
  };

  it('reads the description below the term, not the term', () => {
    const deadline = extractField(DEFINITION_MARKDOWN, deadlineSpec);
    expect(deadline?.value).toBe('18 September 2026');

    const funding = extractField(DEFINITION_MARKDOWN, fundingSpec);
    expect(funding?.value).toBe('Fully funded');
  });

  it('still takes the value beside the label when the line carries one', () => {
    const spec: WitnessFieldSpec = {
      path: 'location',
      meaning: 'where the opportunity is held',
      labels: ['location'],
      excludeLabels: [],
      kind: 'text',
      allowed: [],
    };
    expect(extractField(DEFINITION_MARKDOWN, spec)?.value).toBe('India');
  });

  /**
   * The guard must not fire when the label genuinely is the value. A spec can
   * name a product's own title to find it, and there the bare line is right.
   */
  it('keeps a bare line whose neighbour is another labelled field', () => {
    const spec: WitnessFieldSpec = {
      path: 'name',
      meaning: 'The product title',
      labels: ['Nova Headphones', 'product'],
      excludeLabels: [],
      kind: 'text',
      allowed: [],
    };
    expect(extractField(DRIFTMART_MARKDOWN, spec)?.value).toBe('Nova Headphones');
  });
});

/**
 * A sentence that contains a label is not a label.
 *
 * Looking only at the line underneath was not enough, and a real page proved
 * it. Adobe's fellowship page says, in a bullet:
 *
 *   * Applications are closed for the Adobe India AI Research Fellowship
 *   # Who this fellowship is for
 *
 * The first line matches "applications close", carries no separator, and is
 * followed by a heading that is not its own `Label: value`. Every condition for
 * reading downward was satisfied, so the witness returned "Who this fellowship
 * is for" as the closing date and reported drift against a collector that had
 * read the sentence correctly.
 *
 * The fixture case and this one differ on how much of the line the label
 * accounts for, not on what follows.
 */
describe('a label inside a sentence', () => {
  const deadlineSpec: WitnessFieldSpec = {
    path: 'deadline_raw',
    meaning: 'the date applications close',
    // The spec as registered against the real page, including the phrase
    // that actually matched.
    labels: ['application deadline', 'applications close', 'applications are closed', 'deadline'],
    excludeLabels: ['notification', 'result'],
    kind: 'text',
    allowed: [],
  };

  it('keeps the sentence when the label is only part of it', () => {
    const page = [
      '# Adobe India AI Research Fellowship',
      '',
      '* Applications are closed for the Adobe India AI Research Fellowship',
      '',
      '# Who this fellowship is for',
    ].join('\n');

    expect(extractField(page, deadlineSpec)?.value).toBe(
      'Applications are closed for the Adobe India AI Research Fellowship',
    );
  });

  it('still reads downward when the line is only the label', () => {
    const page = ['Application deadline', '', '18 September 2026', '', 'Location: India'].join('\n');
    expect(extractField(page, deadlineSpec)?.value).toBe('18 September 2026');
  });
});

/**
 * Two spellings of one date are one date.
 *
 * Text was compared as text, which is right for a title and wrong for a closing
 * date. A collector reading "18 September 2026" and a witness reading
 * "2026-09-18" are agreeing, and comparing the strings called that drift. It
 * would have quarantined correct records on the strength of two publishers
 * formatting a date differently, which is most of them.
 *
 * Found by routing discovery through this reconciler instead of its own copy:
 * the bug was latent for watched sources the whole time, and nothing had put
 * two differently formatted dates in front of it.
 */
describe('comparing dates by the day they mean', () => {
  const dateSpec: WitnessFieldSpec = {
    path: 'deadline_raw',
    meaning: 'the date applications close',
    labels: ['deadline'],
    excludeLabels: [],
    kind: 'text',
    allowed: [],
    shape: 'date',
  };

  const observed = (value: string): WitnessObservation => ({
    url: 'https://a.test/x',
    fetchedAt: new Date().toISOString(),
    contentHash: 'x',
    excerpt: value,
    values: [
      { path: 'deadline_raw', value, confidence: 0.9, evidence: { line: value, lineNumber: 1, strategy: 'json-ld' } },
    ],
    notFound: [],
    shape: { headings: [], labels: [], lines: 0, links: 0, tables: 0, images: 0, words: 0 },
  });

  it('agrees across formats', () => {
    const summary = reconcile({ deadline_raw: '18 September 2026' }, observed('2026-09-18'), [dateSpec]);
    expect(summary.agreed).toContain('deadline_raw');
  });

  it('still disagrees on genuinely different days', () => {
    const summary = reconcile({ deadline_raw: '18 September 2026' }, observed('2026-10-30'), [dateSpec]);
    expect(summary.disagreed).toContain('deadline_raw');
  });

  /* A spec that did not declare itself a date compares exactly as before. */
  it('leaves ordinary text comparison alone', () => {
    const plain: WitnessFieldSpec = { ...dateSpec, shape: undefined };
    const summary = reconcile({ deadline_raw: '18 September 2026' }, observed('2026-09-18'), [plain]);
    expect(summary.agreed).not.toContain('deadline_raw');
  });
});
