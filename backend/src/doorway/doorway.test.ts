import { describe, expect, it } from 'vitest';
import type { CollectorRecord, IncidentRecord, VerifiedSnapshot } from '../store/index.js';
import { buildWorld } from './matching.js';
import type { DoorwayProfile, Opportunity } from './types.js';
import { opportunitiesFromSnapshots } from './opportunities.js';
import { draftToOpportunity, isPublishableDraft } from './discovered.js';
import type { OpportunityDraft } from '../acquire/read.js';

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

/**
 * The fault fixture is not somebody's opportunity.
 *
 * A controlled page we host exists so the proof walkthrough can break it on
 * demand. It verifies cleanly, so it arrived in a student's results alongside
 * genuine fellowships, offering a door that leads to a page we wrote. Labelling
 * it "controlled fixture" in the provider name was not enough: a student
 * scanning a list reads titles and deadlines, and by the time they notice the
 * label they have already clicked.
 */
describe('keeping the fixture out of a student\'s results', () => {
  const collector = (id: string, domain: string): CollectorRecord => ({
    id,
    brightDataCollectorId: `c_${id}`,
    name: id,
    targetDomain: domain,
    status: 'active',
    schedule: null,
    watchUrls: [`https://${domain}/x`],
    witnessSpecs: [],
    invariants: [],
    protectedFields: [],
    goldenCases: [],
    acquisitionContext: {},
    autoPromote: 'never',
    freshnessMinutes: null,
    currency: null,
    createdAt: new Date().toISOString(),
  });

  const snapshot = (collectorId: string, domain: string): VerifiedSnapshot => ({
    collectorId,
    url: `https://${domain}/x`,
    data: {
      title: 'A Fellowship',
      provider: 'Someone',
      opportunity_type: 'fellowship',
      application_url: `https://${domain}/apply`,
    },
    contractVersion: 1,
    verifiedAt: new Date().toISOString(),
    contentHash: '',
    shape: null,
    confirmedBy: 'two_sensors',
  });

  it('drops records whose source is the lab, and keeps the rest', () => {
    process.env['DOORWAY_LAB_HOST'] = 'doorway-lab.onrender.com';
    try {
      const found = opportunitiesFromSnapshots(
        [snapshot('lab', 'doorway-lab.onrender.com'), snapshot('real', 'research.adobe.com')],
        [collector('lab', 'doorway-lab.onrender.com'), collector('real', 'research.adobe.com')],
        [],
      );
      expect(found.map((o) => o.sourceUrl)).toEqual(['https://research.adobe.com/x']);
    } finally {
      delete process.env['DOORWAY_LAB_HOST'];
    }
  });

  it('keeps everything when no lab host is configured', () => {
    delete process.env['DOORWAY_LAB_HOST'];
    const found = opportunitiesFromSnapshots(
      [snapshot('lab', 'doorway-lab.onrender.com')],
      [collector('lab', 'doorway-lab.onrender.com')],
      [],
    );
    expect(found).toHaveLength(1);
  });
});

/**
 * The type toggles were being scored rather than obeyed.
 *
 * A student who unticks Fellowships and asks for Internships is not saying
 * "prefer internships"; they are saying they do not want the other thing. The
 * type only contributed to a match score, so a fellowship still appeared,
 * marked twenty percent, in a search for internships. A filter that can be
 * overruled by a score is not a filter.
 */
describe('the type toggles', () => {
  const profile: DoorwayProfile = {
    country: 'India',
    educationLevel: 'Undergraduate',
    interests: ['artificial intelligence'],
    skills: [],
    opportunityTypes: ['internship'],
    fundingRequirement: 'any',
    locations: [],
  };

  const opportunity = (type: Opportunity['type'], id: string): Opportunity => ({
    id,
    collectorId: 'c',
    sourceUrl: `https://a.test/${id}`,
    title: `An ${type}`,
    provider: 'A',
    type,
    summary: 'artificial intelligence',
    eligibility: [],
    interests: [],
    funding: { amount: null, currency: null, coverage: [], level: 'unspecified' },
    deadline: null,
    deadlineRaw: null,
    locations: [],
    remote: null,
    requiredDocuments: [],
    applicationUrl: `https://a.test/${id}/apply`,
    trust: {
      status: 'discovered',
      confirmedBy: 'single_sensor',
      lastVerifiedAt: new Date().toISOString(),
      incidentId: null,
      fieldsDegraded: [],
    },
  });

  it('shows only what was asked for', () => {
    const world = buildWorld(profile, [
      opportunity('internship', 'a'),
      opportunity('fellowship', 'b'),
    ]);
    expect(world.matches).toHaveLength(1);
    expect(world.matches[0]?.opportunity.type).toBe('internship');
  });

  it('treats an untouched form as no filter rather than as nothing', () => {
    const world = buildWorld({ ...profile, opportunityTypes: [] }, [
      opportunity('internship', 'a'),
      opportunity('fellowship', 'b'),
    ]);
    expect(world.matches).toHaveLength(2);
  });
});

describe('live platform records', () => {
  const draft = (over: Partial<OpportunityDraft>): OpportunityDraft => ({
    sourceUrl: 'https://example.test/hackathon',
    host: 'example.test',
    title: 'AI Hackathon',
    provider: 'Example',
    type: 'hackathon',
    summary: '',
    deadlineRaw: null,
    fundingLevel: null,
    eligibility: null,
    official: true,
    foundVia: 'test',
    missing: [],
    sensorCount: 1,
    corroboration: 'text_only',
    structuredDeadline: null,
    applicationStatus: 'unknown',
    statusReason: null,
    readAt: '2026-08-22T00:00:00.000Z',
    ...over,
  });

  it('does not mistake Devpost navigation copy for the organiser', () => {
    const result = draftToOpportunity(
      draft({
        host: 'summer.devpost.com',
        provider: 'Drive innovation, collaboration, and retention within your organization',
      }),
    );
    expect(result.provider).toBe('Devpost');
  });

  it('reclassifies an older indexed record when its explicit deadline has passed', () => {
    const result = draftToOpportunity(
      draft({
        summary: 'Registration Deadline: 15th July 2026',
        applicationStatus: 'unknown',
      }),
    );
    expect(result.deadline).toBe('2026-07-15');
    expect(result.applicationStatus).toBe('closed');
  });

  it('cleans escaped markdown out of a live title', () => {
    expect(draftToOpportunity(draft({ title: '\\# Register now' })).title).toBe('Register now');
  });

  it('keeps legacy listing pages out after parser rules improve', () => {
    expect(isPublishableDraft(draft({ title: 'Register for an upcoming hackathon' }))).toBe(false);
  });

  it('prefers a fresher complete reading over an equal-trust cached copy', () => {
    const cached = draftToOpportunity(
      draft({ title: 'Into the Scrape-Verse', provider: 'WeMakeDevs', readAt: '2026-08-20T00:00:00.000Z' }),
    );
    const fresh = draftToOpportunity(
      draft({
        title: 'Into the Scrape-Verse',
        provider: 'WeMakeDevs',
        deadlineRaw: 'August 17-23, 2026',
        applicationStatus: 'open',
        readAt: '2026-08-22T00:00:00.000Z',
      }),
    );
    const world = buildWorld(
      {
        country: 'India',
        educationLevel: 'Undergraduate',
        interests: [],
        skills: [],
        opportunityTypes: ['hackathon'],
        fundingRequirement: 'any',
        locations: [],
      },
      [cached, fresh],
    );
    expect(world.matches).toHaveLength(1);
    expect(world.matches[0]?.opportunity.deadline).toBe('2026-08-23');
  });
});
