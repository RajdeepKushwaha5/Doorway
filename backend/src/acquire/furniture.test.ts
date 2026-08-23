import { describe, expect, it } from 'vitest';
import { looksLikePageFurniture } from './read.js';

/**
 * Every rejected string below came back from a live crawl as an opportunity a
 * student could apply for. None is a list page, so the index detector had no
 * reason to object to any of them.
 */
describe('page furniture that reached the results', () => {
  for (const junk of [
    'Online',
    'On-Campus',
    'Degree Programs',
    'You seem to be using an unsupported browser',
    'Home',
    'Apply',
    'Skip to main content',
    'Privacy Policy',
    'Accept all cookies',
    '',
    '   ',
  ]) {
    it(`rejects ${JSON.stringify(junk)}`, () => {
      expect(looksLikePageFurniture(junk)).toBe(true);
    });
  }
});

describe('real opportunity titles', () => {
  for (const real of [
    'Upsilon Pi Epsilon Scholarship',
    'AI for Good Fellowship Program',
    'Feuer International Scholarship in Artificial Intelligence',
    'La Trobe Artificial Intelligence Scholarship',
    'Open AI Research Fellowship',
    'Transforming Society through AI Fellowship',
    // Two words, but one of them names the kind of thing.
    'Chevening Scholarships',
    'Rhodes Scholarship',
    // Three words with no keyword still passes: specificity is enough.
    'The Agent Harness Hackathon',
    'Prime Minister Research Fellows',
  ]) {
    it(`keeps ${JSON.stringify(real)}`, () => {
      expect(looksLikePageFurniture(real)).toBe(false);
    });
  }
});

describe('categories written as though they were one opportunity', () => {
  /*
   * From a live crawl, with their URLs:
   *   "Scholarships in USA"        yocket.com/scholarships/scholarships-for-usa
   *   "Scholarships in UK"         yocket.com/scholarships/scholarships-for-united-kingdom
   *   "Additional Funding Options" onlinedegrees.sandiego.edu/tuition-financial-aid/...
   *
   * A plural kind followed by a place is a listing, and the deadline it yields
   * belongs to whichever entry happened to be first.
   */
  for (const listing of [
    'Scholarships in USA',
    'Scholarships in UK',
    'Scholarships for United Kingdom',
    'Fellowships in Germany',
    'Internships for India',
    'Additional Funding Options',
    'Funding Options',
    'Financial Aid Information',
  ]) {
    it(`rejects ${JSON.stringify(listing)}`, () => {
      expect(looksLikePageFurniture(listing)).toBe(true);
    });
  }

  /*
   * The bound is four words, deliberately. Dropping a real opportunity is
   * worse than keeping a listing, so anything longer keeps its name.
   */
  for (const real of [
    'Scholarships for Women in STEM Research',
    'Chevening Scholarships',
    'Commonwealth Shared Scholarships for Developing Countries',
    'Fellowships in Artificial Intelligence at Example University',
  ]) {
    it(`keeps ${JSON.stringify(real)}`, () => {
      expect(looksLikePageFurniture(real)).toBe(false);
    });
  }
});
