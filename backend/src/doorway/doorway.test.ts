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
