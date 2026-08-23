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

/**
 * Found in the live demo, on 23 August 2026.
 *
 * A search for AI fellowships returned "Transforming Society through AI
 * Fellowship" twice. Both were the same programme on the same host. They
 * survived deduplication because the provider had been read two different
 * ways: one page yielded the organisation, `CPRG and AI4India`, and the other
 * fell back to the bare hostname, `cprgindia.org`.
 *
 * Keying on the provider makes deduplication only as reliable as the weakest
 * extraction on the page. The host is the same whatever the extractor managed
 * to read, which is the property the key needs.
 */
describe('the same programme read two different ways', () => {
  const base = {
    title: 'Transforming Society through AI Fellowship',
    sourceUrl: 'https://cprgindia.org/fellowship',
    trust: {
      status: 'discovered' as const,
      confirmedBy: 'single_sensor' as const,
      lastVerifiedAt: '2026-08-23T03:00:00Z',
      incidentId: null,
      fieldsDegraded: [],
      verdict: null,
    },
  };

  it('collapses when one read the organisation and the other fell back to the host', () => {
    const named = record({ ...base, id: 'named', provider: 'CPRG and AI4India' });
    const fallback = record({
      ...base,
      id: 'fallback',
      provider: 'cprgindia.org',
      sourceUrl: 'https://cprgindia.org/fellowship/apply',
    });
    expect(deduplicate([named, fallback])).toHaveLength(1);
  });

  it('prefers the reading that names the organisation over the bare host', () => {
    const named = record({ ...base, id: 'named', provider: 'CPRG and AI4India' });
    const fallback = record({ ...base, id: 'fallback', provider: 'cprgindia.org' });
    // A hostname is what we print when nobody told us who runs the programme.
    // Between two otherwise equal readings, the one that knows is better.
    expect(deduplicate([fallback, named])[0]?.provider).toBe('CPRG and AI4India');
    expect(deduplicate([named, fallback])[0]?.provider).toBe('CPRG and AI4India');
  });

  it('still keeps genuinely different programmes on one host', () => {
    // La Trobe list two scholarships whose titles differ only by a suffix.
    // Collapsing those would hide a real opportunity.
    const plain = record({
      ...base,
      id: 'plain',
      title: 'La Trobe Artificial Intelligence Scholarship',
      sourceUrl: 'https://latrobe.edu.au/a',
      provider: 'latrobe.edu.au',
    });
    const thirty = record({
      ...base,
      id: 'thirty',
      title: 'La Trobe Artificial Intelligence Scholarship 30%',
      sourceUrl: 'https://latrobe.edu.au/b',
      provider: 'La Trobe University',
    });
    expect(deduplicate([plain, thirty])).toHaveLength(2);
  });
});
