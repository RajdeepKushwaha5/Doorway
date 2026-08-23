import { describe, expect, it } from 'vitest';
import { deduplicate } from './opportunities.js';
import type { Opportunity } from './types.js';

/**
 * Found in a live search.
 *
 * Two opportunities the fleet had verified with two sensors came back marked
 * `discovered`, because a page read once seconds ago has a newer timestamp
 * than a snapshot two sensors agreed on an hour earlier. Recency is not
 * trustworthiness, and preferring it served a student the weakest available
 * evidence for records that were fully corroborated.
 */

function record(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: 'a',
    collectorId: 'c',
    sourceUrl: 'https://example.org/f',
    title: 'AI Research Fellowship',
    provider: 'Example Foundation',
    type: 'fellowship',
    summary: '',
    eligibility: [],
    interests: [],
    funding: { amount: null, currency: null, coverage: [], level: 'full' },
    deadline: null,
    deadlineRaw: '18 September 2026',
    applicationStatus: 'open',
    statusReason: null,
    locations: [],
    remote: null,
    requiredDocuments: [],
    applicationUrl: 'https://example.org/apply',
    trust: {
      status: 'verified',
      confirmedBy: 'two_sensors',
      lastVerifiedAt: '2026-08-22T10:00:00Z',
      incidentId: null,
      fieldsDegraded: [],
      verdict: null,
    },
    ...overrides,
  };
}

describe('collapsing two readings of one opportunity', () => {
  const verified = record({});
  const justFound = record({
    id: 'b',
    trust: {
      status: 'discovered',
      confirmedBy: 'single_sensor',
      // An hour newer, which is exactly the trap.
      lastVerifiedAt: '2026-08-22T11:00:00Z',
      incidentId: null,
      fieldsDegraded: [],
      verdict: null,
    },
  });

  it('keeps the two-sensor record over a newer single-sensor one', () => {
    expect(deduplicate([verified, justFound])[0]?.trust.confirmedBy).toBe('two_sensors');
    expect(deduplicate([justFound, verified])[0]?.trust.confirmedBy).toBe('two_sensors');
  });

  it('still prefers the newer of two equally corroborated records', () => {
    const older = record({ id: 'x', trust: { ...verified.trust, lastVerifiedAt: '2026-08-20T10:00:00Z' } });
    const newer = record({ id: 'y', trust: { ...verified.trust, lastVerifiedAt: '2026-08-22T10:00:00Z' } });
    expect(deduplicate([older, newer])[0]?.id).toBe('y');
  });

  it('does not collapse different opportunities', () => {
    const other = record({ id: 'z', title: 'A Different Fellowship' });
    expect(deduplicate([verified, other])).toHaveLength(2);
  });
});
