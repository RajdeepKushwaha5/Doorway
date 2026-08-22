import { describe, expect, it } from 'vitest';
import { hasStructuredFacts, readStructured, type StructuredFacts } from './structured.js';
import { reconcileStructured } from './read.js';
import type { OpportunityDraft } from './read.js';

/**
 * The markdown conversion that makes label extraction possible also throws away
 * every piece of structured data on the way.
 *
 * That turned out to be most of the missing deadlines. A page showing a human
 * "15th July 2026" also declares "2026-07-15" in its source, already
 * normalised, with no ordinal to trip over and no ambiguity about which of the
 * three dates on the page is the closing one.
 */
describe('what a page declares about itself', () => {
  /* Reduced from internshala.com/competitions/1st-india-computer-vision-hackathon-2026 */
  const realPage = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "1st India Computer Vision Hackathon 2026",
  "organizer": { "@type": "Organization", "name": "Information Sharing and Analysis Center" },
  "startDate": "2026-07-08",
  "endDate": "2026-07-15",
  "registrationDeadline": "2026-07-15"
}
</script>
</head><body>Registration Deadline: 15th July 2026</body></html>`;

  it('reads the date a live page declared', () => {
    const facts = readStructured(realPage);
    expect(facts.deadline).toBe('2026-07-15');
    expect(facts.title).toBe('1st India Computer Vision Hackathon 2026');
    expect(facts.provider).toBe('Information Sharing and Analysis Center');
  });

  /*
   * An event has a start, an end and often a registration deadline, and only
   * one is the date a student can miss. Taking the first would routinely
   * publish the day the programme begins as the day applications close.
   */
  it('prefers the closing date over the day it starts', () => {
    const facts = readStructured(realPage);
    expect(facts.deadlineField).toBe('registrationDeadline');
    expect(facts.startDate).toBe('2026-07-08');
  });

  it('finds facts however deeply they are nested', () => {
    const nested = `<script type="application/ld+json">
    {"@graph":[{"@type":"WebPage","mainEntity":{"@type":"Course","name":"AI Scholarship",
    "offers":{"@type":"Offer","price":250000,"priceCurrency":"INR"},"validThrough":"2027-01-31"}}]}
    </script>`;
    const facts = readStructured(nested);
    expect(facts.title).toBe('AI Scholarship');
    expect(facts.deadline).toBe('2027-01-31');
    expect(facts.amount).toBe(250_000);
    expect(facts.currency).toBe('INR');
  });

  /* Publishers ship malformed JSON-LD constantly. One bad block is not a
   * reason to abandon the others. */
  it('survives a broken block beside a good one', () => {
    const mixed = `
      <script type="application/ld+json">{ this is not json }</script>
      <script type="application/ld+json">{"@type":"Event","registrationDeadline":"2026-09-01"}</script>`;
    expect(readStructured(mixed).deadline).toBe('2026-09-01');
  });

  it('reports nothing rather than guessing when a page declares nothing', () => {
    const facts = readStructured('<html><body><p>Apply soon!</p></body></html>');
    expect(facts.deadline).toBeNull();
    expect(hasStructuredFacts(facts)).toBe(false);
  });

  it('refuses a date that is not one', () => {
    const bad = `<script type="application/ld+json">
    {"@type":"Event","registrationDeadline":"soon","startDate":"0001-01-01"}</script>`;
    const facts = readStructured(bad);
    expect(facts.deadline).toBeNull();
    expect(facts.startDate).toBeNull();
  });

  it('falls back to a meta title when nothing better exists', () => {
    const meta = '<html><head><meta property="og:title" content="Oxford AI Fellowship"></head></html>';
    expect(readStructured(meta).title).toBe('Oxford AI Fellowship');
  });

  it('is not upset by an empty document', () => {
    expect(readStructured('').deadline).toBeNull();
    expect(hasStructuredFacts(readStructured(''))).toBe(false);
  });
});

/**
 * The decision that turns one reading into two.
 *
 * Structured data is independent in the way that matters: a different
 * representation of the page, authored separately from the visible text and
 * extracted by different code. Agreement between them is the same kind of
 * evidence the witness gives a watched collector.
 */
describe('setting one reading against the other', () => {
  const draft: OpportunityDraft = {
    sourceUrl: 'https://a.test/hackathon',
    host: 'a.test',
    title: 'A Hackathon',
    provider: 'A',
    type: 'hackathon',
    summary: '',
    deadlineRaw: '15th July 2027',
    fundingLevel: null,
    eligibility: null,
    official: false,
    foundVia: 'test',
    missing: [],
    sensorCount: 1,
    corroboration: 'text_only',
    structuredDeadline: null,
    readAt: new Date().toISOString(),
  };

  const facts = (over: Partial<StructuredFacts> = {}): StructuredFacts => ({
    title: null,
    provider: null,
    deadline: null,
    deadlineField: null,
    startDate: null,
    currency: null,
    amount: null,
    types: ['Event'],
    ...over,
  });

  /*
   * "15th July 2027" and "2027-07-15" are the same fact written by two authors
   * for two audiences. Comparing the text would call every agreement a conflict.
   */
  it('counts two sensors when both readings mean the same day', () => {
    const result = reconcileStructured(draft, facts({ deadline: '2027-07-15' }));
    expect(result.corroboration).toBe('confirmed');
    expect(result.sensorCount).toBe(2);
  });

  it('says so when the page contradicts itself', () => {
    const result = reconcileStructured(draft, facts({ deadline: '2027-09-01' }));
    expect(result.corroboration).toBe('conflicting');
    // Neither is preferred: there is no basis to prefer one.
    expect(result.deadlineRaw).toBe('15th July 2027');
    expect(result.structuredDeadline).toBe('2027-09-01');
    expect(result.sensorCount).toBe(1);
  });

  it('fills a date the words never gave, without claiming corroboration', () => {
    const silent = { ...draft, deadlineRaw: null, missing: ['deadline_raw'] };
    const result = reconcileStructured(silent, facts({ deadline: '2027-07-15' }));
    expect(result.deadlineRaw).toBe('2027-07-15');
    // Nothing corroborated it; it came from somewhere the words were not.
    expect(result.corroboration).toBe('text_only');
    expect(result.missing).not.toContain('deadline_raw');
  });

  it('keeps a past structured date and labels the opportunity closed', () => {
    const silent = { ...draft, deadlineRaw: null, missing: ['deadline_raw'] };
    const result = reconcileStructured(silent, facts({ deadline: '2020-01-01' }));
    expect(result.deadlineRaw).toBe('2020-01-01');
    expect(result.missing).not.toContain('deadline_raw');
    expect(result.applicationStatus).toBe('closed');
  });

  it('leaves the reading alone when the page declares nothing', () => {
    const result = reconcileStructured(draft, facts({ types: [] }));
    expect(result).toEqual(draft);
  });
});
