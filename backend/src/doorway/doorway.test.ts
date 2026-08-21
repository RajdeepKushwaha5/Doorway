import { describe, expect, it } from 'vitest';
import type { CollectorRecord, IncidentRecord, VerifiedSnapshot } from '../store/index.js';
import { buildWorld } from './matching.js';
import { opportunitiesFromSnapshots } from './opportunities.js';

const collector: CollectorRecord = {
  id: 'col-doorway',
  brightDataCollectorId: 'c_doorway',
  name: 'Opportunity source',
  targetDomain: 'example.org',
  status: 'active',
  schedule: null,
  watchUrls: ['https://example.org/fellowship'],
  witnessSpecs: [],
  invariants: [],
  protectedFields: ['deadline', 'funding'],
  goldenCases: [],
  acquisitionContext: {},
  autoPromote: 'never',
  freshnessMinutes: 1_440,
  currency: null,
  createdAt: '2026-08-20T00:00:00.000Z',
};

const snapshot: VerifiedSnapshot = {
  collectorId: collector.id,
  url: collector.watchUrls[0]!,
  data: {
    title: 'Open AI Research Fellowship',
    provider: 'Example Foundation',
    opportunity_type: 'fellowship',
    summary: 'A fully funded artificial intelligence research programme.',
    interests: ['artificial intelligence', 'research'],
    eligibility: ['Undergraduate students may apply'],
    funding_level: 'fully funded',
    deadline: '2026-09-18',
    locations: ['India'],
    application_url: 'https://example.org/apply',
  },
  contractVersion: 2,
  verifiedAt: '2026-08-20T00:00:00.000Z',
  contentHash: 'abc',
  shape: null,
  confirmedBy: 'two_sensors',
};

describe('Doorway opportunity projection', () => {
  it('projects a verified Scraper Studio row into an opportunity', () => {
    const opportunities = opportunitiesFromSnapshots(
      [snapshot],
      [collector],
      [],
      Date.parse('2026-08-20T01:00:00.000Z'),
    );

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      title: 'Open AI Research Fellowship',
      provider: 'Example Foundation',
      type: 'fellowship',
      trust: { status: 'verified', confirmedBy: 'two_sensors' },
    });
  });

  it('quarantines only the opportunity whose source has an open incident', () => {
    const incident: IncidentRecord = {
      id: 'inc-doorway',
      collectorId: collector.id,
      runId: 'run-1',
      classification: 'extractor_drift',
      confidence: 0.98,
      affectedFields: ['deadline'],
      evidence: ['witness disagreed'],
      witness: null,
      repairPrompt: null,
      screenshotId: null,
      history: [],
      gateResults: [],
      quarantined: true,
      acquisition: null,
      pageIdentity: null,
      createdAt: '2026-08-20T00:30:00.000Z',
      resolvedAt: null,
    };
    const opportunities = opportunitiesFromSnapshots(
      [snapshot],
      [collector],
      [incident],
      Date.parse('2026-08-20T01:00:00.000Z'),
    );

    expect(opportunities[0]?.trust).toMatchObject({
      status: 'quarantined',
      incidentId: 'inc-doorway',
      fieldsDegraded: ['deadline'],
    });
  });

  it('builds an explainable world without inventing eligibility', () => {
    const opportunities = opportunitiesFromSnapshots(
      [snapshot],
      [collector],
      [],
      Date.parse('2026-08-20T01:00:00.000Z'),
    );
    const world = buildWorld(
      {
        country: 'India',
        educationLevel: 'Undergraduate',
        interests: ['artificial intelligence'],
        skills: [],
        opportunityTypes: ['fellowship'],
        fundingRequirement: 'full',
        locations: [],
      },
      opportunities,
      new Date('2026-08-20T01:00:00.000Z'),
    );

    expect(world.matches[0]?.score).toBeGreaterThan(80);
    expect(world.matches[0]?.explanation).toContain('Source states full funding');
    expect(world.stats).toMatchObject({ opportunities: 1, verified: 1, closingSoon: 1 });
  });
});


describe('reading what a source actually said', () => {
  /**
   * Both of these produced a demonstrably wrong answer on the flagship
   * opportunity. It scored 70% and "eligible: unknown" against a page that
   * states everything needed to answer both questions.
   */
  const at = Date.parse('2026-08-20T01:00:00.000Z');

  /** The same source, with one field swapped. */
  function withData(data: Record<string, unknown>): VerifiedSnapshot {
    return { ...snapshot, data: { ...(snapshot.data as Record<string, unknown>), ...data } };
  }

  const profile = {
    country: 'India',
    educationLevel: 'undergraduate',
    interests: ['Artificial intelligence'],
    skills: [],
    opportunityTypes: ['fellowship' as const],
    fundingRequirement: 'full' as const,
    locations: ['India'],
  };

  it('reads full funding from coverage, not only from the words "fully funded"', () => {
    const [opportunity] = opportunitiesFromSnapshots(
      [
        withData({
          funding_level: '',
          summary: 'A research programme.',
          funding: { amount: 250_000, currency: 'INR', coverage: ['tuition', 'travel'] },
        }),
      ],
      [collector],
      [],
      at,
    );

    expect(opportunity?.funding.level).toBe('full');
  });

  it('calls a narrower coverage partial rather than full', () => {
    const [opportunity] = opportunitiesFromSnapshots(
      [
        withData({
          funding_level: '',
          summary: 'A research programme.',
          funding: { amount: 50_000, currency: 'INR', coverage: ['tuition'] },
        }),
      ],
      [collector],
      [],
      at,
    );

    expect(opportunity?.funding.level).toBe('partial');
  });

  it('leaves an amount with no stated scope unspecified rather than guessing', () => {
    const [opportunity] = opportunitiesFromSnapshots(
      [withData({ funding_level: '', summary: 'A research programme.', funding: { amount: 250_000, currency: 'INR', coverage: [] } })],
      [collector],
      [],
      at,
    );

    expect(opportunity?.funding.level).toBe('unspecified');
  });

  it('finds the subject when the page only uses the short form', () => {
    // "AI Research Fellowship" does not contain "artificial intelligence",
    // which is how a real page writes it.
    const world = buildWorld(
      profile,
      opportunitiesFromSnapshots(
        [withData({ title: 'AI Research Fellowship', interests: [], summary: 'A funded AI research programme.' })],
        [collector],
        [],
        at,
      ),
      new Date(at),
    );

    const match = world.matches[0];
    expect(match?.explanation.join(' ')).toContain('Artificial intelligence');
    expect(match?.unknownRequirements.join(' ')).not.toContain('subject areas');
  });

  it('says the page did not mention it, rather than blaming the source for our parsing', () => {
    const world = buildWorld(
      { ...profile, interests: ['Marine biology'] },
      opportunitiesFromSnapshots(
        [withData({ interests: [], summary: 'A funded AI research programme.' })],
        [collector],
        [],
        at,
      ),
      new Date(at),
    );

    expect(world.matches[0]?.unknownRequirements.join(' ')).toContain('does not mention Marine biology');
  });
});
