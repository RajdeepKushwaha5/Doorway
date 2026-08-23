/**
 * How funding is written for a reader, in one place.
 *
 * The search results formatted this and the proof page did not, so the record
 * that is supposed to demonstrate the system's care about presentation read
 * "Funding: full". Two renderings of one field is the same arrangement that
 * cost the deadlines: both were right when written, one was improved.
 */
export interface FundingFacts {
  amount: number | null;
  currency: string | null;
  /**
   * `full`, `partial` or `unspecified` where the source says so, and
   * whatever the source actually printed where it does not.
   *
   * Typed as a plain string on purpose. Writing the three known values as a
   * union alongside `string` reads like a checked set but is exactly `string`
   * to the compiler, which promises a reader a guarantee the data cannot
   * keep.
   */
  level: string;
}

export function fundingLabel(funding: FundingFacts): string {
  if (funding.amount !== null && funding.currency !== null) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: funding.currency,
      maximumFractionDigits: 0,
    }).format(funding.amount);
  }
  if (funding.level === 'full') return 'Fully funded';
  if (funding.level === 'partial') return 'Partial funding';
  return 'Not stated';
}
