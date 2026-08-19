import { describe, expect, it } from 'vitest';
import { findProduct, queryFieldName, resultHtml, FEATURED } from './search.js';

/**
 * The search fixture exists to produce one specific failure: an interaction
 * where every step succeeds and the answer is still wrong. These lock in the
 * two properties that make that possible, because if either drifts the fault
 * becomes loud and stops demonstrating anything.
 */

describe('the search fixture', () => {
  it('returns the searched product when the term arrives', () => {
    const { product, matched } = findProduct('Nova');
    expect(matched).toBe(true);
    expect(product.name).toBe('Nova Headphones');
    expect(product.price).toBe(249);
  });

  /**
   * The heart of it. A term the server never received must not produce an
   * error or an empty page: it produces a real product at a real price, which
   * is what makes the failure invisible to every check downstream.
   */
  it('falls back to a featured product rather than failing, when no term arrives', () => {
    const { product, matched } = findProduct(undefined);
    expect(matched).toBe(false);
    expect(product).toEqual(FEATURED);
    expect(product.price).toBeGreaterThan(0);
    expect(product.availability).toBe('In stock');
  });

  it('renames only the submitted field in search_drift, never the id', () => {
    expect(queryFieldName('baseline')).toBe('q');
    expect(queryFieldName('search_drift')).toBe('query');
  });

  /**
   * The fallback card must be structurally identical to a real hit. If it
   * looked different, a parser could tell them apart and the drift would stop
   * being silent.
   */
  it('renders the fallback with the same markup as a match', () => {
    const hit = resultHtml(findProduct('Nova').product, true);
    const miss = resultHtml(findProduct('').product, false);

    for (const marker of ['class="result"', 'class="result-title"', 'class="selling-price"', 'class="stock"']) {
      expect(hit).toContain(marker);
      expect(miss).toContain(marker);
    }
  });

  it('gives the fallback a different product and price from the searched one', () => {
    const searched = findProduct('Nova').product;
    const fallback = findProduct('').product;
    expect(fallback.name).not.toBe(searched.name);
    expect(fallback.price).not.toBe(searched.price);
  });
});
