import { describe, expect, it } from 'vitest';
import { deadlineHasPassed, parseDeadline } from './dates.js';

/**
 * Nothing in the pipeline asked whether a deadline had already gone.
 *
 * A live search returned "AI Hackathon in India", whose own summary read
 * "Applications closed 7 November" and whose deadline was 7 November 2025, and
 * served it to a student nine months after it ended.
 */
describe('deadlines that have already gone', () => {
  const now = Date.UTC(2026, 7, 22); // 22 August 2026

  it('catches the hackathon a live run actually served', () => {
    expect(deadlineHasPassed('7 Nov 2025', now)).toBe(true);
    expect(deadlineHasPassed('Applications closed 7 November 2025', now)).toBe(true);
  });

  it('keeps a deadline still ahead', () => {
    expect(deadlineHasPassed('18 September 2026', now)).toBe(false);
    expect(deadlineHasPassed('Applications close on May 17, 2027', now)).toBe(false);
  });

  /*
   * Being unsure has to mean showing it. Dropping a live opportunity over an
   * unfamiliar date format is a worse failure than showing one whose date could
   * not be read, and the raw text travels with the record either way.
   */
  it('treats an unreadable date as not expired', () => {
    expect(deadlineHasPassed('Rolling admissions', now)).toBe(false);
    expect(deadlineHasPassed('see website for details', now)).toBe(false);
    expect(deadlineHasPassed(null, now)).toBe(false);
  });

  it('does not drop something closing today', () => {
    // A deadline today has not passed for somebody in an earlier timezone, and
    // a listing closing tonight is exactly the one worth surfacing.
    expect(deadlineHasPassed('22 August 2026', now)).toBe(false);
  });

  describe('reading the date out of a sentence', () => {
    it('handles the formats funding pages use', () => {
      expect(parseDeadline('18 September 2026')).toBe(Date.UTC(2026, 8, 18));
      expect(parseDeadline('September 18, 2026')).toBe(Date.UTC(2026, 8, 18));
      expect(parseDeadline('2026-09-18')).toBe(Date.UTC(2026, 8, 18));
      expect(parseDeadline('18/09/2026')).toBe(Date.UTC(2026, 8, 18));
      expect(parseDeadline('Applications close on 17th May, 2026')).toBe(Date.UTC(2026, 4, 17));
    });

    /*
     * "Opens 1 March, closes 30 April" is a window, and the date a student can
     * miss is the end of it.
     */
    it('takes the last date when a sentence names a window', () => {
      expect(parseDeadline('Opens 1 March 2026 and closes 30 April 2026')).toBe(
        Date.UTC(2026, 3, 30),
      );
    });

    it('returns nothing when there is no date', () => {
      expect(parseDeadline('Rolling until further notice')).toBeNull();
      expect(parseDeadline('2026')).toBeNull();
    });
  });
});
