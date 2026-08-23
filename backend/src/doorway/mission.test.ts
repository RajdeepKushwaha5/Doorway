import { describe, expect, it } from 'vitest';
import { buildMission, diffMissions } from './mission.js';
import type { Opportunity } from './types.js';

/**
 * The mission is where verification stops being a badge and starts being a
 * consequence. These tests are mostly about one thing: what the student's plan
 * does when the source moves, and what it refuses to do when only one sensor
 * says it moved.
 */

const NOW = Date.parse('2026-08-22T00:00:00Z');

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    collectorId: 'col-1',
    sourceUrl: 'https://research.example.org/fellowship',
    title: 'AI Research Fellowship',
    provider: 'Example Research Foundation',
    type: 'fellowship',
    summary: 'A fellowship.',
    eligibility: [],
    interests: ['artificial intelligence'],
    funding: { amount: null, currency: null, coverage: [], level: 'full' },
    deadline: null,
    deadlineRaw: '18 September 2026',
    applicationStatus: 'open',
    statusReason: null,
    locations: [],
    remote: null,
    requiredDocuments: ['Resume', 'Transcript', 'Research statement', 'Recommendation letter'],
    applicationUrl: 'https://research.example.org/fellowship/apply',
    trust: {
      status: 'verified',
      confirmedBy: 'two_sensors',
      lastVerifiedAt: '2026-08-22T00:00:00Z',
      incidentId: null,
      fieldsDegraded: [],
      verdict: null,
    },
    ...overrides,
  };
}

describe('building a mission', () => {
  it('counts only the documents the student actually holds', () => {
    const mission = buildMission({
      opportunity: opportunity(),
      held: ['Resume', 'Transcript'],
      now: NOW,
    });

    expect(mission.readiness).toEqual({ held: 2, total: 4, percent: 50, stated: true });
    expect(mission.state).toBe('eligible');
  });

  it('matches held documents without caring about case or padding', () => {
    const mission = buildMission({
      opportunity: opportunity(),
      held: ['  resume  ', 'TRANSCRIPT'],
      now: NOW,
    });
    expect(mission.readiness.held).toBe(2);
  });

  it('sets a safety deadline ahead of the real one', () => {
    const mission = buildMission({ opportunity: opportunity(), now: NOW });
    expect(mission.deadline.at).toBe(Date.parse('2026-09-18T00:00:00Z'));
    expect(mission.deadline.safety).toBe(Date.parse('2026-09-15T00:00:00Z'));
    expect(mission.deadline.daysRemaining).toBe(27);
  });

  it('reaches application_ready once nothing is missing', () => {
    const mission = buildMission({
      opportunity: opportunity(),
      held: ['Resume', 'Transcript', 'Research statement', 'Recommendation letter'],
      now: NOW,
    });
    expect(mission.state).toBe('application_ready');
  });

  it('does not claim readiness for a list nobody published', () => {
    /*
     * This used to report 100 percent, which is a claim about a document list
     * that was never seen. Not knowing what a programme asks for is not the
     * same as having everything it asks for.
     */
    const mission = buildMission({
      opportunity: opportunity({ requiredDocuments: [] }),
      now: NOW,
    });
    expect(mission.readiness.stated).toBe(false);
    expect(mission.state).toBe('eligible');
    expect(mission.stateReason).toContain('unknown');
  });

  it('marks readiness as stated once the source names its documents', () => {
    const mission = buildMission({ opportunity: opportunity(), held: ['Resume'], now: NOW });
    expect(mission.readiness.stated).toBe(true);
    expect(mission.readiness.percent).toBe(25);
  });
});

describe('what stops an application', () => {
  it('blocks when the source says applications closed', () => {
    const mission = buildMission({
      opportunity: opportunity({
        applicationStatus: 'closed',
        statusReason: 'The source reports that applications have closed.',
      }),
      now: NOW,
    });
    expect(mission.state).toBe('blocked');
    expect(mission.blockers[0]).toContain('closed');
  });

  it('blocks when there is nowhere to apply, however complete the rest is', () => {
    const mission = buildMission({
      opportunity: opportunity({ applicationUrl: '' }),
      held: ['Resume', 'Transcript', 'Research statement', 'Recommendation letter'],
      now: NOW,
    });
    expect(mission.state).toBe('blocked');
    expect(mission.blockers[0]).toContain('no longer publishes a way to apply');
  });

  it('says a passed deadline once, not twice', () => {
    /*
     * Found in production. The closed status and the date arithmetic both
     * fired for the same fact, and the student was shown two blockers that
     * were one problem written two ways.
     */
    const mission = buildMission({
      opportunity: opportunity({
        deadlineRaw: '17 May 2026',
        applicationStatus: 'closed',
        statusReason: 'The published application deadline has passed.',
      }),
      now: NOW,
    });
    expect(mission.blockers).toHaveLength(1);
    expect(mission.blockers[0]).toBe('The published application deadline has passed.');
  });

  it('still reports a passed deadline when the source never said closed', () => {
    const mission = buildMission({
      opportunity: opportunity({ deadlineRaw: '17 May 2026', applicationStatus: 'open' }),
      now: NOW,
    });
    expect(mission.blockers).toEqual(['The published deadline has passed.']);
  });

  it('will not plan around a record only one sensor has read', () => {
    const mission = buildMission({
      opportunity: opportunity({
        trust: {
          status: 'discovered',
          confirmedBy: 'single_sensor',
          lastVerifiedAt: '2026-08-22T00:00:00Z',
          incidentId: null,
          fieldsDegraded: [],
          verdict: null,
        },
      }),
      now: NOW,
    });
    expect(mission.state).toBe('discovered');
    expect(mission.stateReason).toContain('Not yet corroborated');
  });
});

describe('a disputed requirement is held, never dropped', () => {
  /*
   * The argument the whole product rests on, stated as a test.
   *
   * A collector drifts and reports that a source stopped asking for a
   * reference letter. The witness still sees it. A checklist that acted on the
   * collector alone would quietly become incomplete, the student would submit
   * without the letter, and every piece of JSON involved would have been
   * valid.
   */
  const disputed = opportunity({
    trust: {
      status: 'partially_verified',
      confirmedBy: 'two_sensors',
      lastVerifiedAt: '2026-08-22T00:00:00Z',
      incidentId: 'inc-1',
      fieldsDegraded: ['required_documents'],
      verdict: 'extractor_drift',
    },
  });

  it('keeps every requirement on the list', () => {
    const mission = buildMission({ opportunity: disputed, held: ['Resume'], now: NOW });
    expect(mission.documents).toHaveLength(4);
    expect(mission.documents.map((d) => d.name)).toContain('Recommendation letter');
  });

  it('marks them as disputed rather than as satisfied', () => {
    const mission = buildMission({ opportunity: disputed, held: ['Resume'], now: NOW });
    expect(mission.documents.every((d) => d.status === 'disputed')).toBe(true);
    expect(mission.readiness.held).toBe(0);
    expect(mission.disputed).toContain('required_documents');
  });

  it('does not let a drifting extractor make a student look ready', () => {
    const before = buildMission({ opportunity: opportunity(), held: ['Resume'], now: NOW });
    const after = buildMission({ opportunity: disputed, held: ['Resume'], now: NOW });
    expect(after.readiness.percent).toBeLessThanOrEqual(before.readiness.percent);
    expect(after.state).not.toBe('application_ready');
  });

  it('does not call a disputed record confirmed', () => {
    const mission = buildMission({ opportunity: disputed, held: ['Resume'], now: NOW });
    expect(mission.stateReason).toContain('disputed');
    expect(mission.stateReason).not.toContain('The facts have been confirmed');
  });

  it('does not claim a disagreement when the sensors agreed', () => {
    /*
     * From the live run of application_link_removed. Both sensors read the
     * page and both found no apply link, so the verdict was
     * genuine_source_change. Telling a student they disagreed would describe
     * an argument that never happened.
     */
    const mission = buildMission({
      opportunity: opportunity({
        trust: {
          status: 'quarantined',
          confirmedBy: 'two_sensors',
          lastVerifiedAt: '2026-08-22T00:00:00Z',
          incidentId: 'inc-3',
          fieldsDegraded: ['application_url'],
          verdict: 'genuine_source_change',
        },
      }),
      now: NOW,
    });
    expect(mission.state).toBe('blocked');
    expect(mission.blockers[0]).toContain('source has removed the way to apply');
    expect(mission.blockers[0]).not.toContain('disagree');
  });

  it('blocks when the two sensors disagree about where to apply', () => {
    const mission = buildMission({
      opportunity: opportunity({
        trust: {
          status: 'partially_verified',
          confirmedBy: 'two_sensors',
          lastVerifiedAt: '2026-08-22T00:00:00Z',
          incidentId: 'inc-2',
          fieldsDegraded: ['application_url'],
          verdict: 'extractor_drift',
        },
      }),
      now: NOW,
    });
    expect(mission.state).toBe('blocked');
    expect(mission.blockers[0]).toContain('disagree about where to apply');
  });
});

describe('when the source genuinely changes', () => {
  /*
   * Both sensors agree the page now asks for references. Nothing is broken and
   * nothing should be repaired. The student's plan simply got harder, and the
   * number that says how ready they are has to move.
   */
  it('reports the requirement that appeared, and that it made things harder', () => {
    const before = buildMission({
      opportunity: opportunity(),
      held: ['Resume', 'Transcript', 'Research statement'],
      now: NOW,
    });

    const after = buildMission({
      opportunity: opportunity({
        requiredDocuments: [
          'Resume',
          'Transcript',
          'Research statement',
          'Recommendation letter',
          'Two academic references',
        ],
      }),
      held: ['Resume', 'Transcript', 'Research statement'],
      now: NOW,
    });

    expect(before.readiness.percent).toBe(75);
    expect(after.readiness.percent).toBe(60);

    const changes = diffMissions(before, after);
    const added = changes.find((c) => c.after === 'Two academic references');
    expect(added?.harder).toBe(true);

    const readiness = changes.find((c) => c.field === 'readiness');
    expect(readiness).toEqual({
      field: 'readiness',
      before: '75%',
      after: '60%',
      harder: true,
    });
  });

  it('reports a deadline that moved closer as harder, and one that moved out as not', () => {
    const base = buildMission({ opportunity: opportunity(), now: NOW });

    const earlier = buildMission({
      opportunity: opportunity({ deadlineRaw: '1 September 2026' }),
      now: NOW,
    });
    expect(diffMissions(base, earlier).find((c) => c.field === 'deadline')?.harder).toBe(true);

    const later = buildMission({
      opportunity: opportunity({ deadlineRaw: '30 September 2026' }),
      now: NOW,
    });
    expect(diffMissions(base, later).find((c) => c.field === 'deadline')?.harder).toBe(false);
  });

  it('says nothing when nothing changed', () => {
    const mission = buildMission({ opportunity: opportunity(), held: ['Resume'], now: NOW });
    expect(diffMissions(mission, mission)).toEqual([]);
  });
});
