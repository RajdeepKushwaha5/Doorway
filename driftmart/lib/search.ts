import type { ModeId } from './modes';

/**
 * A search page that cannot be scraped without interacting with it.
 *
 * Every other DriftMart page is one navigation away from its data, which is
 * the easy case and the one every scraper tutorial stops at. Real catalogues
 * are not like that: the value only appears after you type something and press
 * a button, so a collector has to drive the page rather than read it.
 *
 * That matters here for one reason. A multi-step interaction has more ways to
 * fail *quietly* than a single fetch does, and the worst of them is this: the
 * search box keeps its id, the form renames its field, and every step of the
 * interaction still succeeds. Typing works. Clicking works. A page loads. A
 * product renders with a real price. It is simply the wrong product.
 *
 * Nothing errors, nothing is null, the row is schema-valid, and the collector
 * reports success. It is the same silent corruption the rest of this fixture
 * demonstrates, arriving through the interaction rather than the layout.
 */

export interface Product {
  sku: string;
  name: string;
  price: number;
  currency: string;
  availability: string;
}

export const CATALOGUE: readonly Product[] = [
  { sku: 'NOVA-HP', name: 'Nova Headphones', price: 249, currency: 'USD', availability: 'In stock' },
  { sku: 'VEGA-EB', name: 'Vega Earbuds', price: 79, currency: 'USD', availability: 'In stock' },
  { sku: 'ORBIT-SP', name: 'Orbit Speaker', price: 329, currency: 'USD', availability: 'In stock' },
];

/**
 * What the store shows when a search carries no usable term.
 *
 * A real catalogue does exactly this rather than rendering an empty page, and
 * it is precisely why the failure is invisible: the collector gets a product,
 * with a price, on a page that looks like a result.
 */
export const FEATURED = CATALOGUE[1] as Product;

/**
 * The field name the form submits under.
 *
 * `search_drift` renames it while leaving the input's id alone, which is the
 * ordinary shape of a front-end refactor. A collector bound to the id keeps
 * working, and the server stops receiving the term.
 */
export function queryFieldName(mode: ModeId): string {
  return mode === 'search_drift' ? 'query' : 'q';
}

export function findProduct(term: string | undefined): { product: Product; matched: boolean } {
  const needle = (term ?? '').trim().toLowerCase();
  if (needle === '') return { product: FEATURED, matched: false };

  const hit = CATALOGUE.find(
    (item) => item.name.toLowerCase().includes(needle) || item.sku.toLowerCase() === needle,
  );
  return hit === undefined ? { product: FEATURED, matched: false } : { product: hit, matched: true };
}

/** The result card, rendered identically whether the term matched or not. */
export function resultHtml(product: Product, matched: boolean): string {
  return `
<div class="results" data-results="1">
  <p class="result-count">${matched ? '1 result' : 'No exact match. Showing a featured product.'}</p>
  <div class="result" data-sku="${product.sku}">
    <h2 class="result-title">${product.name}</h2>
    <p class="row"><span class="label">Price:</span> <span class="selling-price" data-testid="price">$${String(product.price)}</span></p>
    <p class="row"><span class="label">Availability:</span> <span class="stock">${product.availability}</span></p>
  </div>
</div>`.trim();
}
