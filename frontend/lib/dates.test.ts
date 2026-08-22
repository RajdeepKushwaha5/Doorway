import { describe, expect, it } from 'vitest';
import { daysUntil, formatDeadline } from './dates';

/**
 * The case that prompted this: a scholarship whose page wrote "01/07/2027".
 * A reader cannot tell the first of July from the seventh of January, and the
 * difference is six months of planning.
 */
describe('formatDeadline', () => {
  it('spells the month out so the order cannot be misread', () => {
    expect(formatDeadline('2027-07-01T00:00:00Z', '01/07/2027')).toBe('1 July 2027');
  });

  it('prefers the parsed date over the source wording', () => {
    expect(formatDeadline('2026-09-18T00:00:00Z', '18/09/2026')).toBe('18 September 2026');
  });

  it('keeps what the source said when nothing could be parsed', () => {
    // "Rolling admissions" is information, and replacing it with "not
    // published" would throw away something the page actually told us.
    expect(formatDeadline(null, 'Rolling admissions')).toBe('Rolling admissions');
    expect(formatDeadline(null, 'Applications close at the end of term')).toBe(
      'Applications close at the end of term',
    );
  });

  it('says so plainly when there is nothing at all', () => {
    expect(formatDeadline(null, null)).toBe('Date not published');
    expect(formatDeadline(null, '   ')).toBe('Date not published');
  });

  it('falls back rather than printing an invalid date', () => {
    expect(formatDeadline('not a date', 'sometime in spring')).toBe('sometime in spring');
  });
});

describe('daysUntil', () => {
  const now = Date.parse('2026-08-22T00:00:00Z');

  it('counts whole days ahead', () => {
    expect(daysUntil('2026-09-18T00:00:00Z', now)).toBe(27);
  });

  it('goes negative once the date has passed', () => {
    expect(daysUntil('2026-05-17T00:00:00Z', now)).toBeLessThan(0);
  });

  it('floors rather than rounds, so most of a day left is still today', () => {
    // Rounding would call this "tomorrow" and invite a reader to leave it.
    expect(daysUntil('2026-08-22T18:00:00Z', now)).toBe(0);
  });

  it('is null when there is no date', () => {
    expect(daysUntil(null, now)).toBeNull();
  });
});
