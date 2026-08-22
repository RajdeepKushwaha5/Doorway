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
