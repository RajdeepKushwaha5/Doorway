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
  level: 'full' | 'partial' | 'unspecified' | string;
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
