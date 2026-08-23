import type { IncidentState } from '../shared/index.js';

/**
 * Legal incident transitions.
 *
 * Declared as data rather than scattered through the worker so the lifecycle
 * can be tested exhaustively and so an illegal transition is a caught error
 * rather than a corrupted row. The approval path in particular must be
 * impossible to reach by accident: nothing can move to `approving` except from
 * `awaiting_approval`, which is only reachable after candidate verification.
 */
const TRANSITIONS: Readonly<Record<IncidentState, readonly IncidentState[]>> = {
  observed: ['validating'],
  validating: ['healthy', 'witness_pending', 'classifying'],
  healthy: [],
  witness_pending: ['classifying', 'inconclusive'],
  classifying: [
    'healthy',
    'genuine_change',
    'access_retry',
    'inconclusive',
    'drift_confirmed',
  ],
  genuine_change: [],
  access_retry: ['validating', 'inconclusive'],
  inconclusive: ['validating', 'witness_pending'],
  drift_confirmed: ['healing'],
  healing: ['awaiting_candidate', 'repair_rejected'],
  awaiting_candidate: ['verifying_candidate', 'repair_rejected'],
  verifying_candidate: ['awaiting_approval', 'repair_rejected'],
  // A rejected repair may be retried, within the attempt ceiling.
  repair_rejected: ['healing', 'rollback_or_escalate'],
  awaiting_approval: ['approving', 'repair_rejected'],
  approving: ['verifying_production'],
  verifying_production: ['resolved', 'rollback_or_escalate'],
  resolved: [],
  rollback_or_escalate: [],
};

/** States from which no further automatic progress is possible. */
export const TERMINAL_STATES: ReadonlySet<IncidentState> = new Set([
  'healthy',
  'genuine_change',
  'resolved',
  'rollback_or_escalate',
]);

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: IncidentState,
    readonly to: IncidentState,
  ) {
    super(`illegal incident transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(from: IncidentState, to: IncidentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionRecord {
  from: IncidentState;
  to: IncidentState;
  at: string;
  actor: 'system' | 'user' | 'brightdata';
  reason: string;
  /** Identifiers of the evidence that justified this move. */
  evidenceRefs: string[];
}

/**
 * Apply a transition, recording who did it and why.
 *
 * @throws IllegalTransitionError when the move is not permitted.
 */
export function transition(
  from: IncidentState,
  to: IncidentState,
  details: { actor: TransitionRecord['actor']; reason: string; evidenceRefs?: string[] },
): TransitionRecord {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
  return {
    from,
    to,
    at: new Date().toISOString(),
    actor: details.actor,
    reason: details.reason,
    evidenceRefs: details.evidenceRefs ?? [],
  };
}

/**
 * Whether an action has already been applied, by looking at recorded history.
 *
 * The worker can restart mid-heal, and Bright Data jobs outlive a process.
 * Without this, a restart between "approve sent" and "approval recorded"
 * approves a repair twice.
 */
export function alreadyEntered(
  history: readonly TransitionRecord[],
  state: IncidentState,
): boolean {
  return history.some((record) => record.to === state);
}

/** The current state implied by a transition history. */
export function currentState(history: readonly TransitionRecord[]): IncidentState {
  return history.length === 0 ? 'observed' : (history[history.length - 1]?.to ?? 'observed');
}
