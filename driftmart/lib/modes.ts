/**
 * DriftMart page modes.
 *
 * DriftMart is a controlled fault-injection fixture. It is not a real store
 * and its incidents are not spontaneous external failures. Both the README and
 * the demo video must say so.
 *
 * The single most important property here: the live product page and the
 * permanent fixture pages render from the *same* definitions below. If the
 * fixtures drifted from what the live page actually served, the regression
 * corpus would be testing something that never happened, and the approval gate
 * would be verifying a fiction.
 */

export const MODE_IDS = [
  'baseline',
  'genuine_price_change',
  'selector_drift',
  'silent_zero',
  'missing_field',
  'sponsored_insertion',
  'pagination_collapse',
  'search_drift',
  // Opportunity faults. The retail modes above were the original corpus and
  // stay exactly as they were, because the regression gate replays against
  // them. These four say the same things in the vocabulary Doorway actually
  // serves, so a student looking at the demonstration sees a deadline they
  // would have planned around rather than a headphone price.
  'deadline_drift',
  'deadline_sentinel',
  'deadline_extended',
  'sponsored_opportunity',
  'application_link_removed',
] as const;

/** The opportunity faults, separated so a page can ask for only those. */
export const OPPORTUNITY_MODE_IDS = [
  'deadline_drift',
  'deadline_sentinel',
  'deadline_extended',
  'sponsored_opportunity',
  'application_link_removed',
] as const;

export type OpportunityModeId = (typeof OPPORTUNITY_MODE_IDS)[number];

export function isOpportunityModeId(value: string): value is OpportunityModeId {
  return (OPPORTUNITY_MODE_IDS as readonly string[]).includes(value);
}

export type ModeId = (typeof MODE_IDS)[number];

/**
 * The retail corpus only.
 *
 * `MODES` below is keyed by this rather than by `ModeId`, so adding an
 * opportunity fault cannot silently oblige somebody to invent headphone markup
 * for it. The two corpora describe different pages and are kept apart.
 */
export type RetailModeId = Exclude<ModeId, OpportunityModeId>;

export function isModeId(value: string): value is ModeId {
  return (MODE_IDS as readonly string[]).includes(value);
}

/** What a correct collector should extract from a given mode. */
export interface ExpectedRecord {
  name: string;
  price: number;
  deposit: number | null;
  currency: string;
  availability: 'in_stock' | 'out_of_stock' | 'preorder';
}

export interface ModeDefinition {
  id: ModeId;
  /** One line shown on the admin panel and in the demo. */
  label: string;
  /**
   * Whether a correct collector's output should change in this mode.
   *
   * This is the field that makes NOTICE more than a diff tool. In
   * `genuine_price_change` the extraction is fine and the world moved, so the
   * correct action is to record a source change and leave the collector alone.
   * In `selector_drift` the world is unchanged and the extraction moved, which
   * is the only case that should ever reach Self-Healing.
   */
  semanticChange: boolean;
  /** What a correct collector should return when this mode is live. */
  expected: ExpectedRecord;
  /** The markup served. Kept as data so live and fixture cannot diverge. */
  html: string;
}

const BASELINE_EXPECTED: ExpectedRecord = {
  name: 'Nova Headphones',
  price: 249,
  deposit: 25,
  currency: 'USD',
  availability: 'in_stock',
};

export const MODES: Readonly<Record<RetailModeId, ModeDefinition>> = {
  baseline: {
    id: 'baseline',
    label: 'Baseline. Correct extraction, stable layout.',
    semanticChange: false,
    expected: BASELINE_EXPECTED,
    html: `
<div class="product">
  <h1 class="product-title">Nova Headphones</h1>
  <p class="row"><span class="label">Price:</span> <span class="selling-price" data-testid="price">$249</span></p>
  <p class="row"><span class="label">Refundable deposit:</span> <span class="security-deposit">$25</span></p>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</div>`.trim(),
  },

  genuine_price_change: {
    id: 'genuine_price_change',
    label: 'The price really changed. The collector is fine and must not be healed.',
    semanticChange: true,
    expected: { ...BASELINE_EXPECTED, price: 229 },
    html: `
<div class="product">
  <h1 class="product-title">Nova Headphones</h1>
  <p class="row"><span class="label">Price:</span> <span class="selling-price" data-testid="price">$229</span></p>
  <p class="row"><span class="label">Refundable deposit:</span> <span class="security-deposit">$25</span></p>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</div>`.trim(),
  },

  selector_drift: {
    id: 'selector_drift',
    // The visible meaning is unchanged: purchase price is still $249. Only the
    // DOM moved. A collector bound to the old position now reads the deposit,
    // producing schema-valid, plausible, wrong output.
    label: 'Layout redesigned. Meaning unchanged. A brittle collector reads the deposit as price.',
    semanticChange: false,
    expected: BASELINE_EXPECTED,
    // The visible labels move with their values, which is what a real redesign
    // does. That is precisely why the witness survives it and the collector
    // does not: the collector is bound to `.selling-price`, which now wraps
    // the deposit, while the page still says in plain words which is which.
    html: `
<section data-product="Nova Headphones">
  <h1 class="product-title">Nova Headphones</h1>
  <div class="payment-summary">
    <p class="row"><span class="label">Refundable deposit:</span> <span class="selling-price" data-type="refundable">$25</span></p>
    <p class="row"><span class="label">Purchase price:</span> <strong data-type="purchase-price">$249</strong></p>
  </div>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</section>`.trim(),
  },

  silent_zero: {
    id: 'silent_zero',
    label: 'Structured metadata says 0 USD while the visible price is correct.',
    semanticChange: false,
    expected: BASELINE_EXPECTED,
    html: `
<div class="product">
  <h1 class="product-title">Nova Headphones</h1>
  <p class="row"><span class="label">Price:</span> <span class="selling-price" data-testid="price" data-amount="0" data-currency="USD">$249</span></p>
  <p class="row"><span class="label">Refundable deposit:</span> <span class="security-deposit">$25</span></p>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</div>`.trim(),
  },

  missing_field: {
    id: 'missing_field',
    label: 'Availability disappears from its usual location.',
    semanticChange: false,
    expected: BASELINE_EXPECTED,
    html: `
<div class="product">
  <h1 class="product-title">Nova Headphones</h1>
  <p class="row"><span class="label">Price:</span> <span class="selling-price" data-testid="price">$249</span></p>
  <p class="row"><span class="label">Refundable deposit:</span> <span class="security-deposit">$25</span></p>
  <p class="delivery-note">Ships within 24 hours while supplies last.</p>
</div>`.trim(),
  },

  sponsored_insertion: {
    id: 'sponsored_insertion',
    label: 'A sponsored card is inserted above the organic product.',
    semanticChange: false,
    expected: BASELINE_EXPECTED,
    html: `
<div class="sponsored" data-sponsored="true">
  <h1 class="product-title">Vega Headphones (Sponsored)</h1>
  <p class="row"><span class="label">Sponsored price:</span> <span class="selling-price" data-testid="price">$99</span></p>
</div>
<div class="product">
  <h1 class="product-title">Nova Headphones</h1>
  <p class="row"><span class="label">Price:</span> <span class="selling-price" data-testid="price">$249</span></p>
  <p class="row"><span class="label">Refundable deposit:</span> <span class="security-deposit">$25</span></p>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</div>`.trim(),
  },

  /**
   * The fault lives on /search, not on this page.
   *
   * The product page is deliberately identical to baseline: nothing about the
   * product markup is wrong in this mode. What moves is the search form's
   * field name, so a collector that types into the box and clicks the button
   * completes every step, submits a term the server ignores, and scrapes the
   * featured product instead of the one it searched for.
   *
   * A layout fault and an interaction fault produce the same symptom, a
   * plausible price for the wrong thing, and neither raises an error. This
   * mode exists so the second kind can be demonstrated too.
   */
  search_drift: {
    id: 'search_drift',
    label: 'Search form renames its field. The box still works; the term is dropped.',
    semanticChange: false,
    expected: BASELINE_EXPECTED,
    html: `
<div class="product">
  <h1 class="product-title">Nova Headphones</h1>
  <p class="row"><span class="label">Price:</span> <span class="selling-price" data-testid="price">$249</span></p>
  <p class="row"><span class="label">Refundable deposit:</span> <span class="security-deposit">$25</span></p>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</div>`.trim(),
  },

  pagination_collapse: {
    id: 'pagination_collapse',
    label: 'Pagination parameter changes but the content repeats.',
    semanticChange: false,
    expected: BASELINE_EXPECTED,
    html: `
<div class="product">
  <h1 class="product-title">Nova Headphones</h1>
  <p class="row"><span class="label">Price:</span> <span class="selling-price" data-testid="price">$249</span></p>
  <p class="row"><span class="label">Refundable deposit:</span> <span class="security-deposit">$25</span></p>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</div>
<nav class="pager"><a href="?page=2">Next</a></nav>`.trim(),
  },
};

/**
 * The retail page for a given mode.
 *
 * An opportunity fault leaves the product page at baseline, mirroring the way
 * a retail fault leaves the opportunity page alone. One process serves both
 * fixtures, and a demonstration should not change underneath a visitor because
 * somebody switched the other page in another tab.
 */
export function getMode(id: ModeId): ModeDefinition {
  return isOpportunityModeId(id) ? MODES.baseline : MODES[id];
}
