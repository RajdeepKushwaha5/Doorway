import type { DoorwayProfile, OpportunityType } from '../doorway/types.js';

/**
 * Turn what a student said about themselves into things to search for.
 *
 * The naive version concatenates every field into one long query and returns
 * almost nothing, because a search engine given twelve constraints at once
 * matches pages that happen to contain all twelve words rather than pages that
 * are the thing being asked for. Real funding pages are written in the
 * vocabulary of the body offering the money, not the vocabulary of the student
 * looking for it.
 *
 * So: several narrow queries instead of one wide one, each shaped like a
 * sentence a foundation would actually publish, and the results merged. A
 * query per opportunity type keeps "fellowship" pages from being crowded out
 * by the much larger population of "scholarship" pages.
 */

/** The words a funding body would use, per type. */
const TYPE_WORDS: Record<OpportunityType, string[]> = {
  scholarship: ['scholarship'],
  fellowship: ['fellowship'],
  internship: ['internship', 'summer internship'],
  'research-program': ['research programme', 'research training'],
  grant: ['grant', 'research grant'],
  hackathon: ['hackathon'],
};

/** How a page says it pays for everything, in the words pages actually use. */
const FUNDING_WORDS: Record<string, string> = {
  full: 'fully funded',
  partial: 'funded',
  any: '',
};

export interface DiscoveryQuery {
  /** The search string itself. */
  text: string;
  /** Which type this query is hunting, so results can be typed on arrival. */
  type: OpportunityType;
  /**
   * Whether this query is aimed at official sources only.
   *
   * Aggregator pages outrank official ones for almost every funding term,
   * because aggregators are built for search and ministries are not. A student
   * wants the ministry. One query per type is therefore restricted to the
   * domains where the money actually lives.
   */
  officialOnly: boolean;
}

/**
 * Domains that publish funding rather than write about it.
 *
 * Not exhaustive and not meant to be. It is enough to pull official pages up
 * into the results at all, which plain search will not do on its own.
 */
const OFFICIAL_SUFFIXES = ['.gov.in', '.nic.in', '.edu', '.ac.in', '.ac.uk', '.gov', '.edu.au'];

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Build the queries for one profile.
 *
 * Capped, because each one costs a Web Unlocker request and a student pressing
 * a button should not spend forty of them. The cap is applied to types rather
 * than to the final list so a profile asking for six types still gets a spread
 * across all six rather than six variations of the first.
 */
export function buildQueries(profile: DoorwayProfile, options: { maxTypes?: number } = {}): DiscoveryQuery[] {
  const maxTypes = options.maxTypes ?? 3;

  const interests = profile.interests.filter((entry) => clean(entry) !== '').slice(0, 2);
  const subject = interests.length === 0 ? '' : interests.join(' ');
  const funding = FUNDING_WORDS[profile.fundingRequirement] ?? '';
  const where = clean(profile.country);
  const level = clean(profile.educationLevel).toLowerCase();

  const types = (profile.opportunityTypes.length === 0
    ? (['scholarship', 'fellowship'] as OpportunityType[])
    : profile.opportunityTypes
  ).slice(0, maxTypes);

  const year = String(new Date().getFullYear());

  const queries: DiscoveryQuery[] = [];

  for (const type of types) {
    const word = TYPE_WORDS[type][0] ?? type;

    // The open query. Aggregators will win most of these, and that is fine:
    // an aggregator page often names opportunities the official search misses,
    // and the name is enough to find the official page later.
    queries.push({
      text: clean(`${funding} ${subject} ${word} ${where} ${year}`),
      type,
      officialOnly: false,
    });

    // The official query. Same words, restricted to the places that publish
    // funding rather than write about it.
    const sites = OFFICIAL_SUFFIXES.map((suffix) => `site:${suffix}`).join(' OR ');
    queries.push({
      text: clean(`${subject} ${word} ${level} ${where} (${sites})`),
      type,
      officialOnly: true,
    });
  }

  return queries;
}

/** Whether a host looks like a body that publishes funding rather than lists it. */
export function looksOfficial(host: string): boolean {
  const lower = host.toLowerCase();
  return OFFICIAL_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}
