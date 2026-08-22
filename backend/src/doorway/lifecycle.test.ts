import { describe, expect, it } from 'vitest';
import { decideLifecycle } from './lifecycle.js';

/**
 * Three places decided this independently, over different inputs and in
 * different words.
 *
 * They did not have to disagree to be a problem. The two date parsers that cost
 * most of the deadlines in the index were both correct when written; one was
 * improved and the other was not, and the gap sat there silently. Three copies
 * of a rule is the same arrangement with worse odds.
 */
describe('deciding whether somebody can still apply', () => {
  it('takes the source at its word when it published one', () => {
    expect(decideLifecycle({ statusText: 'Applications closed' }).status).toBe('closed');
    expect(decideLifecycle({ statusText: 'Rolling admissions' }).status).toBe('rolling');
  });

  /*
   * A programme can shut early, and only the page knows. A future date must not
   * override a page saying it is over.
   */
  it('lets a published closure beat a date still ahead', () => {
    const verdict = decideLifecycle({
      statusText: 'Registration closed',
      deadlineRaw: '1 January 2030',
    });
    expect(verdict.status).toBe('closed');
  });

  it('reads a closure out of prose when no status field exists', () => {
    expect(
      decideLifecycle({ pageText: '# Key dates\n\nApplications are closed for this programme.' })
        .status,
    ).toBe('closed');
  });

  it('closes on a date that has gone, even when the page never says so', () => {
    const verdict = decideLifecycle({ deadlineRaw: '7 November 2020' });
    expect(verdict.status).toBe('closed');
    expect(verdict.reason).toContain('deadline has passed');
  });

  it('calls a date still ahead open', () => {
    expect(decideLifecycle({ deadlineRaw: '30 September 2030' }).status).toBe('open');
  });

  /*
   * Unknown is the default rather than a failure state. A page publishing no
   * reliable closing date has told us it does not know either, and guessing
   * open is the more damaging of the two errors.
   */
  it('admits when it cannot tell', () => {
    const verdict = decideLifecycle({});
    expect(verdict.status).toBe('unknown');
    expect(verdict.reason).toContain('did not publish');
  });

  it('carries an upstream decision, but not an upstream shrug', () => {
    expect(decideLifecycle({ declared: 'rolling' }).status).toBe('rolling');
    // An upstream that could not tell must not outrank a date this one can read.
    expect(decideLifecycle({ declared: 'unknown', deadlineRaw: '30 September 2030' }).status).toBe(
      'open',
    );
  });

  it('does not mistake an announcement of the next round for a shut door', () => {
    const verdict = decideLifecycle({
      pageText: 'Applications are closed. Applications will open again in March 2030.',
      deadlineRaw: null,
    });
    expect(verdict.status).not.toBe('closed');
  });

  it('always says why', () => {
    for (const signals of [
      { statusText: 'closed' },
      { deadlineRaw: '30 September 2030' },
      { pageText: 'Rolling admissions' },
      {},
    ]) {
      expect(decideLifecycle(signals).reason.length).toBeGreaterThan(10);
    }
  });
});
