import { parseDeadline } from '../acquire/dates.js';
import type { Opportunity } from './types.js';

/**
 * What a verified opportunity asks a student to actually do.
 *
 * The world was where this product stopped. A student got a list of records
 * that had survived two sensors, which is worth something and is still only a
 * list. Nothing downstream of the verification ever changed shape when a
 * source changed, so the strongest thing this system knows, that a fact moved
 * and which of the two readings moved it, had nowhere to land.
 *
 * A mission is that landing place. It is a state machine over one opportunity,
 * derived entirely from published facts, and it is rebuilt whenever those
 * facts change. When a source genuinely adds a requirement, the mission gets
 * harder and says so. When a collector alone claims a requirement vanished,
 * the mission does not move, because the trust engine never published the
 * claim, and the student's checklist does not quietly lose an item that the
 * page still asks for.
 *
 * That second case is the entire argument. A checklist that silently drops a
 * required document because an extractor drifted is worse than no checklist,
 * and it fails in the way this project exists to catch: plausibly, quietly,
 * and with valid JSON all the way down.
 */

/** How far along a student is, in the order the steps actually happen. */
export type MissionState =
  /** Found and read once. Not yet corroborated, so not yet actionable. */
  | 'discovered'
  /** Two sensors agree on the facts that matter. */
  | 'verified'
  /** The stated requirements are met, or none disqualify. */
  | 'eligible'
  /** Every required document is held. Nothing left but to submit. */
  | 'application_ready'
  /** Something prevents applying that effort cannot fix today. */
  | 'blocked'
  /** The student says they have applied. */
  | 'submitted';

export interface MissionDocument {
  name: string;
  /**
   * `held` when the student has it, `missing` when they do not, and `disputed`
   * when the sensors do not agree on whether the source still asks for it.
   *
   * A disputed requirement stays on the list. Dropping it would be acting on a
   * reading that was never good enough to publish.
   */
  status: 'held' | 'missing' | 'disputed';
}

export interface Mission {
  opportunityId: string;
  title: string;
  provider: string;
  applicationUrl: string;

  state: MissionState;
  /** Plain language naming the evidence for the state, shown beside it. */
  stateReason: string;

  documents: MissionDocument[];
  readiness: {
    held: number;
    total: number;
    /** Whole percent, floored. Zero requirements reads as complete. */
    percent: number;
  };

  deadline: {
    /** As the source wrote it, and as two sensors confirmed it. */
    raw: string | null;
    /** Parsed, when it could be. */
    at: number | null;
    /** The date this system tells the student to be finished by. */
    safety: number | null;
    daysRemaining: number | null;
  };

  /** Reasons an application cannot proceed, most serious first. */
  blockers: string[];

  /**
   * Fields the two sensors did not agree on, carried onto the mission.
   *
   * Present so the student is told which parts of their own plan are being
   * held at the last confirmed value rather than being shown a fresh number
   * that only one sensor supports.
   */
  disputed: string[];

  confirmedBy: string;
  lastVerifiedAt: string;
}

/**
 * Days before the published deadline that this system treats as the real one.
 *
 * Three, because a deadline is a wall and every part of an application that
 * involves another person, a reference, a transcript office, a portal under
 * load on its last day, runs late. Telling a student the true date and nothing
 * else is accurate and not useful.
 */
const SAFETY_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Requirements whose absence makes an application impossible, not merely harder. */
const BLOCKING_FIELDS = ['application_url'];

export interface MissionInput {
  opportunity: Opportunity;
  /** Documents the student already holds, matched case-insensitively. */
  held?: readonly string[];
  /** Set once the student says they have applied. */
  submitted?: boolean;
  now?: number;
}

export function buildMission(input: MissionInput): Mission {
  const { opportunity } = input;
  const now = input.now ?? Date.now();
  const held = new Set((input.held ?? []).map((name) => name.trim().toLowerCase()));
  const disputed = [...(opportunity.trust.fieldsDegraded ?? [])];

  /*
   * A disputed document list is still a document list.
   *
   * When `required_documents` is among the degraded fields, what is shown is
   * the last reading both sensors supported. It is marked rather than dropped,
   * because the alternative is a checklist that quietly shrinks whenever an
   * extractor slips, which is the failure this product exists to prevent.
   */
  const documentsDisputed = disputed.some((field) => /document/i.test(field));

  const documents: MissionDocument[] = opportunity.requiredDocuments.map((name) => ({
    name,
    status: documentsDisputed
      ? 'disputed'
      : held.has(name.trim().toLowerCase())
        ? 'held'
        : 'missing',
  }));

  const heldCount = documents.filter((document) => document.status === 'held').length;
  const total = documents.length;

  const at = opportunity.deadlineRaw === null ? null : parseDeadline(opportunity.deadlineRaw);
  const safety = at === null ? null : at - SAFETY_DAYS * DAY_MS;
  const daysRemaining = at === null ? null : Math.floor((at - now) / DAY_MS);

  const blockers = findBlockers(opportunity, daysRemaining, disputed);
  const state = decideState({
    opportunity,
    blockers,
    heldCount,
    total,
    submitted: input.submitted === true,
  });

  return {
    opportunityId: opportunity.id,
    title: opportunity.title,
    provider: opportunity.provider,
    applicationUrl: opportunity.applicationUrl,
    state: state.state,
    stateReason: state.reason,
    documents,
    readiness: {
      held: heldCount,
      total,
      // No stated requirements is not the same as no progress. A source that
      // lists none has asked for nothing, and the honest reading of that is
      // complete rather than zero.
      percent: total === 0 ? 100 : Math.floor((heldCount / total) * 100),
    },
    deadline: { raw: opportunity.deadlineRaw, at, safety, daysRemaining },
    blockers,
    disputed,
    confirmedBy: opportunity.trust.confirmedBy,
    lastVerifiedAt: opportunity.trust.lastVerifiedAt,
  };
}

/** Reasons this cannot proceed, worst first. */
function findBlockers(
  opportunity: Opportunity,
  daysRemaining: number | null,
  disputed: readonly string[],
): string[] {
  const blockers: string[] = [];

  if (opportunity.applicationStatus === 'closed') {
    blockers.push(
      opportunity.statusReason ?? 'The source reports that applications have closed.',
    );
  }

  /*
   * Nowhere to apply is a blocker even when everything else is perfect.
   *
   * A listing can carry a correct deadline, real funding and a full document
   * list and still be unusable, and sending a student to a dead end after they
   * prepared for it is a worse outcome than never showing it.
   */
  if (opportunity.applicationUrl.trim() === '') {
    blockers.push('The source no longer publishes a way to apply.');
  } else if (disputed.some((field) => BLOCKING_FIELDS.includes(field))) {
    blockers.push(
      'The two sensors disagree about where to apply, so the link is held at its last confirmed value.',
    );
  }

  if (daysRemaining !== null && daysRemaining < 0) {
    blockers.push('The published deadline has passed.');
  }

  return blockers;
}

function decideState(input: {
  opportunity: Opportunity;
  blockers: readonly string[];
  heldCount: number;
  total: number;
  submitted: boolean;
}): { state: MissionState; reason: string } {
  const { opportunity, blockers, heldCount, total, submitted } = input;

  if (submitted) {
    return { state: 'submitted', reason: 'You marked this as applied.' };
  }

  if (blockers.length > 0) {
    return { state: 'blocked', reason: blockers[0] ?? 'This application cannot proceed.' };
  }

  /*
   * Corroboration gates everything after it.
   *
   * A record read once by one sensor may be right, and nothing has checked it.
   * Building a plan on it would extend this system's confidence past the point
   * it has earned, which is the specific thing it refuses to do everywhere
   * else.
   */
  if (opportunity.trust.status === 'discovered' || opportunity.trust.confirmedBy === 'single_sensor') {
    return {
      state: 'discovered',
      reason: 'Read once by one sensor. Not yet corroborated, so not yet worth planning around.',
    };
  }

  /*
   * A record on hold is not a record that has been confirmed.
   *
   * Falling through to "the facts have been confirmed" was exactly wrong for a
   * quarantined opportunity, because the facts are the thing under dispute.
   * What is true is narrower and worth saying precisely: the values shown are
   * the last ones both sensors supported, and the newer reading was not good
   * enough to publish.
   */
  if (opportunity.trust.fieldsDegraded.length > 0 || opportunity.trust.status === 'quarantined') {
    return {
      state: 'verified',
      reason:
        'Some facts are disputed. What is shown is the last reading both sensors confirmed, so readiness is not claimed.',
    };
  }

  if (opportunity.trust.status === 'stale') {
    return {
      state: 'verified',
      reason: 'Confirmed once, and not rechecked since. Open the official page before you rely on it.',
    };
  }

  if (total > 0 && heldCount >= total) {
    return {
      state: 'application_ready',
      reason: 'Every document this source asks for is in hand.',
    };
  }

  if (opportunity.trust.status === 'verified' || opportunity.trust.status === 'partially_verified') {
    return {
      state: 'eligible',
      reason:
        total === 0
          ? 'Confirmed by two sensors. This source publishes no document list.'
          : `Confirmed by two sensors. ${total - heldCount} of ${total} documents still to gather.`,
    };
  }

  return { state: 'verified', reason: 'The facts have been confirmed.' };
}

/** One difference between two readings of the same mission. */
export interface MissionChange {
  field: string;
  before: string;
  after: string;
  /**
   * Whether this made the application harder.
   *
   * Named because the useful alert is not "something changed", it is "the bar
   * moved and you have less room than you thought".
   */
  harder: boolean;
}

/**
 * What changed for the student between two readings.
 *
 * This is where a source change becomes visible as a consequence rather than
 * as a log line. A foundation adding a reference requirement is not a diff in
 * a database, it is a person who now has to ask two academics for a letter,
 * and the number that says how ready they are has to move.
 */
export function diffMissions(before: Mission, after: Mission): MissionChange[] {
  const changes: MissionChange[] = [];

  if (before.readiness.percent !== after.readiness.percent) {
    changes.push({
      field: 'readiness',
      before: `${before.readiness.percent}%`,
      after: `${after.readiness.percent}%`,
      harder: after.readiness.percent < before.readiness.percent,
    });
  }

  const had = new Set(before.documents.map((document) => document.name));
  const has = new Set(after.documents.map((document) => document.name));

  for (const document of after.documents) {
    if (!had.has(document.name)) {
      changes.push({ field: 'document', before: 'not required', after: document.name, harder: true });
    }
  }
  for (const document of before.documents) {
    if (!has.has(document.name)) {
      changes.push({ field: 'document', before: document.name, after: 'no longer required', harder: false });
    }
  }

  if (before.deadline.raw !== after.deadline.raw) {
    changes.push({
      field: 'deadline',
      before: before.deadline.raw ?? 'not published',
      after: after.deadline.raw ?? 'not published',
      harder:
        before.deadline.at !== null && after.deadline.at !== null && after.deadline.at < before.deadline.at,
    });
  }

  if (before.state !== after.state) {
    changes.push({
      field: 'state',
      before: before.state,
      after: after.state,
      harder: after.state === 'blocked',
    });
  }

  return changes;
}
