import { describe, expect, it } from 'vitest';
import { composeBrief } from './compose.js';

/**
 * The brief is the design, and the useful half of a design is what it refused.
 * A scraper told only what to extract takes the first plausible date on the
 * page, which on a funding page is routinely the wrong one by seventeen days.
 */

const PAGE = 'https://doorway-lab.onrender.com/opportunity/ai-fellowship';

const TWO_DATES = [
  '# Open AI Research Fellowship',
  '',
  'Early interest deadline',
  '',
  '1 September 2026',
  '',
  'Application deadline',
  '',
  '18 September 2026',
  '',
  '[Start application](/opportunity/ai-fellowship/apply)',
].join('\n');

const ONE_DATE = [
  '# Open AI Research Fellowship',
  '',
  'Application deadline: 18 September 2026',
  '',
  'Contact the programme team for access.',
].join('\n');

describe('composing a brief', () => {
  it('names the label to take the date from', () => {
    const brief = composeBrief(TWO_DATES, PAGE);
    expect(brief.description).toContain('"application deadline"');
  });

  it('names the label to refuse, which is the point', () => {
    const brief = composeBrief(TWO_DATES, PAGE);
    expect(brief.description).toContain('Never take it from "early interest"');
  });

  it('reports both dates it saw, and which is not the closing one', () => {
    const brief = composeBrief(TWO_DATES, PAGE);
    expect(brief.dates).toHaveLength(2);
    expect(brief.observations.join(' ')).toContain('"1 September 2026" is labelled early interest');
    expect(brief.observations.join(' ')).toContain('which is not the closing date');
  });

  it('notices a relative apply link and asks for it', () => {
    const brief = composeBrief(TWO_DATES, PAGE);
    expect(brief.hasApplyLink).toBe(true);
    expect(brief.description).toContain('apply link');
    expect(brief.protectedBecause).toHaveProperty('application_url');
  });

  it('does not invent a refusal when there is nothing to refuse', () => {
    const brief = composeBrief(ONE_DATE, PAGE);
    expect(brief.description).not.toContain('Never take it from');
    expect(brief.dates).toHaveLength(1);
  });

  it('does not claim an apply link the page does not show', () => {
    const brief = composeBrief(ONE_DATE, PAGE);
    expect(brief.hasApplyLink).toBe(false);
    expect(brief.description).not.toContain('apply link');
    expect(brief.protectedBecause).not.toHaveProperty('application_url');
  });

  it('reports a label with no date as no sighting at all', () => {
    // Putting "Application deadline" in the brief with no date behind it would
    // state something the page never did.
    const brief = composeBrief('Application deadline\n\nto be announced', PAGE);
    expect(brief.dates).toHaveLength(0);
  });

  it('stays inside the 500 characters Scraper Studio accepts', () => {
    const noisy = Array.from({ length: 40 }, (_, i) =>
      `Notification date\n\n${String((i % 28) + 1)} January 2027\n`,
    ).join('\n');
    const brief = composeBrief(`${TWO_DATES}\n${noisy}`, PAGE);
    expect(brief.description.length).toBeLessThanOrEqual(500);
  });

  it('is deterministic, so a judge can run it twice', () => {
    expect(composeBrief(TWO_DATES, PAGE)).toEqual(composeBrief(TWO_DATES, PAGE));
  });
});
