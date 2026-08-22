import { deadlineHasPassed } from '../acquire/dates.js';
import { saysClosed } from '../acquire/plausible.js';
import type { ApplicationStatus } from './types.js';

/**
 * One answer to "can somebody still apply", for every path that asks it.
 *
 * Three places were deciding this independently, over different inputs and in
 * different words. Discovery read the page prose. The watched-source path read
 * a structured field a collector had extracted. The index-to-world path read a
 * draft's summary. Each carried its own list of closure phrases and its own
 * precedence, and all three had to agree for the product to be coherent.
 *
 * They did not have to disagree to be a problem. The two date parsers that cost
 * most of the deadlines in the index were both correct when written; one was
 * improved and the other was not, and the gap sat there silently. Three copies
 * of a rule is the same arrangement with worse odds.
 *
 * The inputs genuinely differ, so this takes whatever signals a caller has and
 * applies one precedence to them. What it will not do is guess: absent every
 * signal the answer is `unknown`, which is shown rather than withheld, because
 * a page that publishes no closing date has told us it does not know either and
 * guessing `open` is the more damaging of the two errors.
 */

export interface LifecycleSignals {
  /**
   * A status the source itself published, such as a collector field reading
   * "Applications closed". The strongest signal available: it is the page
   * answering the question directly rather than us inferring it.
   */
  statusText?: string | null;
  /** Page prose to scan for a closure notice. */
  pageText?: string | null;
  /** The closing date as the page wrote it. */
  deadlineRaw?: string | null;
  /**
   * A decision made further upstream, carried rather than recomputed.
   *
   * Only trusted when it is not `unknown`: an upstream that could not tell
   * should not outrank a date that this one can read.
   */
  declared?: ApplicationStatus | undefined;
}

export interface LifecycleVerdict {
  status: ApplicationStatus;
  /** Plain language naming the evidence, shown beside the record. */
  reason: string;
}

/** Ways a source says the door is shut, in a published status field. */
const STATUS_CLOSED = /\b(closed|ended|expired|complete|completed|finished|concluded)\b/i;

/** Ways a source says applications never close. */
const STATUS_ROLLING = /\b(rolling|year[- ]round|continuous|ongoing|always open)\b/i;

/** Ways a source says the door is open. */
const STATUS_OPEN = /\b(open|opens|accepting|register|registration|live|apply)\b/i;

/** The same, in prose rather than in a field. */
const PROSE_ROLLING = /\b(rolling admissions?|applications? accepted year[- ]round|no deadline|applications? are accepted on a rolling basis)\b/i;
const PROSE_OPEN = /\b(applications? (?:are )?open|registration (?:is )?open|apply now|register now|now accepting)\b/i;

/**
 * Decide, once.
 *
 * Precedence, strongest first: what the source published about itself, then
 * what its prose says, then what its date implies, then what somebody upstream
 * concluded. A published "closed" beats a future date, because a programme can
 * shut early and only the page knows.
 */
export function decideLifecycle(signals: LifecycleSignals): LifecycleVerdict {
  const status = (signals.statusText ?? '').trim();
  const prose = signals.pageText ?? '';
  const deadline = signals.deadlineRaw ?? null;

  // 1. The source answered the question itself.
  if (status !== '') {
    if (STATUS_CLOSED.test(status)) {
      return { status: 'closed', reason: 'The source reports that applications have closed.' };
    }
    if (STATUS_ROLLING.test(status)) {
      return { status: 'rolling', reason: 'The source describes applications as rolling.' };
    }
  }

  // 2. The page said so in words. Checked before the date, because a page that
  //    announces a closure while leaving last year's date up is common, and the
  //    sentence is the more recent statement.
  if (prose !== '' && saysClosed(prose)) {
    return { status: 'closed', reason: 'The official page says applications are closed.' };
  }

  // 3. The date has gone. A page can forget to say so; the arithmetic cannot.
  if (deadlineHasPassed(deadline)) {
    return { status: 'closed', reason: 'The published application deadline has passed.' };
  }

  if (prose !== '' && PROSE_ROLLING.test(prose)) {
    return { status: 'rolling', reason: 'The official page describes applications as rolling.' };
  }

  // 4. A date still ahead is the ordinary case for an open programme.
  if (deadline !== null) {
    return { status: 'open', reason: 'The published deadline has not passed.' };
  }

  if (status !== '' && STATUS_OPEN.test(status)) {
    return { status: 'open', reason: 'The source reports that applications are open.' };
  }
  if (prose !== '' && PROSE_OPEN.test(prose)) {
    return { status: 'open', reason: 'The official page says applications are open.' };
  }

  // 5. Somebody upstream had an opinion, and it was not "I cannot tell".
  if (signals.declared !== undefined && signals.declared !== 'unknown') {
    return {
      status: signals.declared,
      reason: 'Carried from the reading that produced this record.',
    };
  }

  return {
    status: 'unknown',
    reason: 'The official page did not publish a reliable closing date.',
  };
}
