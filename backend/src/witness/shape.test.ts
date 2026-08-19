import { describe, expect, it } from 'vitest';
import { compareShapes, isSamePage, pageShape, SAME_PAGE_THRESHOLD } from './shape.js';

/**
 * The check has to survive both directions of being wrong.
 *
 * If it fires on a page whose price merely changed, it turns real detections
 * into "a human should look" and the system becomes noise. If it fails to fire
 * on a consent wall, the witness gets to testify about a document it never
 * read, and a working collector is accused on that testimony. The first half
 * of these tests defends the first case, the second half the second.
 */

const PRODUCT = [
  '# DriftMart',
  '',
  '## Nova Headphones',
  '',
  'Purchase price: $249',
  'Refundable deposit: $25',
  'Availability: In stock',
  'SKU: NOVA-001',
  '',
  '[Add to basket](/cart/add/NOVA-001)',
].join('\n');

const PRICE_CHANGED = PRODUCT.replace('$249', '$229');

const CONSENT_WALL = [
  '# Before you continue',
  '',
  'We and our partners use cookies to personalise content.',
  '',
  '[Accept all](/consent/accept)',
  '[Manage options](/consent/manage)',
].join('\n');

const CHECKING_BROWSER = 'Checking your browser before accessing the site.\n\nPlease wait.';

const SOFT_404 = ['# Page not found', '', 'The product you were looking for is unavailable.'].join(
  '\n',
);

describe('reading a page down to its structure', () => {
  it('keeps the headings, labels and counts and discards every value', () => {
    const shape = pageShape(PRODUCT);

    expect(shape.headings).toEqual([1, 2]);
    expect(shape.labels).toEqual(['availability', 'purchase price', 'refundable deposit', 'sku']);
    expect(shape.links).toBe(1);
    expect(shape.lines).toBe(7);
  });

  it('does not mistake a sentence containing a colon for a field label', () => {
    const shape = pageShape(
      'This is a long sentence that happens to contain a colon somewhere: and then continues.',
    );
    expect(shape.labels).toEqual([]);
  });

  it('treats a label the same however it is cased or emphasised', () => {
    expect(pageShape('**Purchase Price:** $249').labels).toEqual(
      pageShape('purchase price: $249').labels,
    );
  });
});

describe('a page that is still the same page', () => {
  it('scores near identical when only a value changed', () => {
    const comparison = compareShapes(pageShape(PRODUCT), pageShape(PRICE_CHANGED));

    expect(comparison.similarity).toBeGreaterThan(0.95);
    expect(isSamePage(comparison)).toBe(true);
    expect(comparison.notes).toEqual([]);
  });

  it('survives a section being moved, because reordering is not a new document', () => {
    const reordered = [
      '# DriftMart',
      '',
      'Availability: In stock',
      'SKU: NOVA-001',
      '',
      '## Nova Headphones',
      '',
      'Purchase price: $249',
      'Refundable deposit: $25',
      '',
      '[Add to basket](/cart/add/NOVA-001)',
    ].join('\n');

    expect(isSamePage(compareShapes(pageShape(PRODUCT), pageShape(reordered)))).toBe(true);
  });

  it('survives one field being added or dropped', () => {
    const withExtra = `${PRODUCT}\nDispatch: within 24 hours`;
    expect(isSamePage(compareShapes(pageShape(PRODUCT), pageShape(withExtra)))).toBe(true);
  });
});

describe('a page that is not the page at all', () => {
  it('rejects a consent wall', () => {
    const comparison = compareShapes(pageShape(PRODUCT), pageShape(CONSENT_WALL));

    expect(isSamePage(comparison)).toBe(false);
    expect(comparison.reason).toContain('none of the 4 labelled fields');
  });

  it('rejects an interstitial', () => {
    expect(isSamePage(compareShapes(pageShape(PRODUCT), pageShape(CHECKING_BROWSER)))).toBe(false);
  });

  it('rejects a soft 404 that answered 200', () => {
    const comparison = compareShapes(pageShape(PRODUCT), pageShape(SOFT_404));

    expect(isSamePage(comparison)).toBe(false);
    expect(comparison.similarity).toBeLessThan(SAME_PAGE_THRESHOLD);
  });

  it('rejects an empty body', () => {
    expect(isSamePage(compareShapes(pageShape(PRODUCT), pageShape('')))).toBe(false);
  });

  it('names the labels that went missing, so the rejection can be checked', () => {
    const comparison = compareShapes(pageShape(PRODUCT), pageShape(CONSENT_WALL));

    expect(comparison.notes.join(' ')).toContain('purchase price');
    expect(comparison.parts.labels).toBe(0);
  });
});

describe('the score itself', () => {
  it('is 1 for a page compared against itself', () => {
    expect(compareShapes(pageShape(PRODUCT), pageShape(PRODUCT)).similarity).toBe(1);
  });

  it('treats two structureless bodies as agreeing rather than dividing by zero', () => {
    const comparison = compareShapes(pageShape('plain text'), pageShape('other plain text'));

    expect(Number.isFinite(comparison.similarity)).toBe(true);
    expect(comparison.parts.labels).toBe(1);
    expect(comparison.parts.headings).toBe(1);
  });
});

describe('the labels are decisive on their own', () => {
  /**
   * A redesign that renames every label is reported as a different page, and
   * that is the right answer rather than a tolerated inaccuracy. The witness
   * finds fields by their labels, so if every label was renamed it cannot read
   * this page either, and the run was never going to be adjudicable. Saying
   * which labels disappeared tells the operator exactly what to fix, which
   * beats an unexplained incomparable.
   */
  it('reports a wholesale relabelling as a different page, and names the cause', () => {
    const relabelled = [
      '# DriftMart',
      '',
      '## Nova Headphones',
      '',
      'Price now: $249',
      'Deposit held: $25',
      'Stock: In stock',
      'Code: NOVA-001',
      '',
      '[Basket](/cart/add/NOVA-001)',
    ].join('\n');

    const comparison = compareShapes(pageShape(PRODUCT), pageShape(relabelled));

    expect(comparison.samePage).toBe(false);
    expect(comparison.notes.join(' ')).toContain('purchase price');
  });

  it('does not treat a single renamed label as a different page', () => {
    const oneRenamed = PRODUCT.replace('SKU:', 'Product code:');

    expect(compareShapes(pageShape(PRODUCT), pageShape(oneRenamed)).samePage).toBe(true);
  });

  it('stands down when the verified reading had no structure to compare against', () => {
    // Fail open. A first observation must never be blocked by the absence of
    // its own history.
    const comparison = compareShapes(pageShape('just a sentence'), pageShape(PRODUCT));

    expect(comparison.samePage).toBe(true);
    expect(comparison.reason).toContain('too little structure');
  });
});
