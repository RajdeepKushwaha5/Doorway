import type { DoorwayProfile, OpportunityType } from '../doorway/types.js';

/**
 * Turn what a student said about themselves into things to search for.
 *
 * The naive version concatenates every field into one long query and returns
 * almost nothing, because a search engine given twelve constraints at once
 * matches pages that happen to contain all twelve words rather than pages that
 * are the thing being asked for. Real opportunity pages are written in the
 * vocabulary of whoever is offering, not the vocabulary of the student looking.
 *
 * So: several narrow queries instead of one wide one, each shaped like a
 * sentence somebody would actually publish, and the results merged.
 *
 * The important lesson, learned by getting it wrong: the shape has to differ by
 * type. A scholarship and a hackathon have nothing in common as search
 * problems. Asking for a "fully funded hackathon" on .gov.in returns nothing,
 * because hackathons are not funded and no ministry hosts them, and that is
 * exactly what a search for hackathons was doing.
 */

/** The words whoever is offering would use, per type. */
const TYPE_WORDS: Record<OpportunityType, string> = {
  scholarship: 'scholarship',
  fellowship: 'fellowship',
  internship: 'internship',
  'research-program': 'research programme',
  grant: 'grant',
  hackathon: 'hackathon',
};

/** How a page says it pays for everything, in the words pages actually use. */
const FUNDING_WORDS: Record<string, string> = {
  full: 'fully funded',
  partial: 'funded',
  any: '',
};

/**
 * Where each kind of opportunity is actually published.
 *
 * Scholarships and fellowships come from ministries and universities.
 * Hackathons come from the platforms built to host them, and a hackathon
 * listing on Devpost is the primary source rather than an aggregator's summary
 * of one. Treating every type as though it lived on .gov.in was why a search
 * for hackathons returned almost nothing.
 */
const HOMES: Record<OpportunityType, string[]> = {
  scholarship: ['.gov.in', '.nic.in', '.edu', '.ac.in', '.ac.uk', '.gov', '.edu.au'],
  fellowship: ['.gov.in', '.nic.in', '.edu', '.ac.in', '.ac.uk', '.gov', '.org'],
  internship: ['.edu', '.ac.in', '.gov.in', '.org'],
  'research-program': ['.edu', '.ac.in', '.ac.uk', '.gov.in', '.org'],
  grant: ['.gov.in', '.gov', '.org', '.edu'],
  hackathon: [
    'devpost.com',
    'devfolio.co',
    'unstop.com',
    'mlh.io',
    'hackerearth.com',
    'dorahacks.io',
    'lu.ma',
  ],
};

/** Types where money is the point, and types where it is not. */
const FUNDING_MATTERS: Record<OpportunityType, boolean> = {
  scholarship: true,
  fellowship: true,
  internship: true,
  'research-program': true,
  grant: true,
  // Hackathons are free to enter and pay in prizes. "Fully funded hackathon" is
  // not a phrase anybody publishes, and putting it in the query is why the
  // search for them came back nearly empty.
  hackathon: false,
};

export interface DiscoveryQuery {
  /** The search string itself. */
  text: string;
  /** Which type this query is hunting, so results can be typed on arrival. */
  type: OpportunityType;
  /**
   * Whether this query is aimed at where the type is actually published.
   *
   * Aggregators outrank primary sources for almost every opportunity term,
   * because aggregators are built for search and ministries and hackathon
   * platforms are not. A student wants the thing itself.
   */
  officialOnly: boolean;
}

/** Every host that publishes rather than summarises, across all types. */
const ALL_HOMES = [...new Set(Object.values(HOMES).flat())];

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Build the queries for one profile.
 *
 * Capped, because each one costs a request and a student pressing a button
 * should not spend forty of them. The cap applies to types rather than to the
 * final list, so a profile asking for six types gets a spread across them
 * rather than six variations of the first.
 */
export function buildQueries(
  profile: DoorwayProfile,
  options: { maxTypes?: number } = {},
): DiscoveryQuery[] {
  const maxTypes = options.maxTypes ?? 4;

  const interests = profile.interests.filter((entry) => clean(entry) !== '').slice(0, 2);
  const subject = interests.length === 0 ? '' : interests.join(' ');
  const where = clean(profile.country);
  const level = clean(profile.educationLevel).toLowerCase();
  const year = String(new Date().getFullYear());

  const types = (
    profile.opportunityTypes.length === 0
      ? (['scholarship', 'fellowship'] as OpportunityType[])
      : profile.opportunityTypes
  ).slice(0, maxTypes);

  const queries: DiscoveryQuery[] = [];

  for (const type of types) {
    const word = TYPE_WORDS[type];
    const funding = FUNDING_MATTERS[type] ? (FUNDING_WORDS[profile.fundingRequirement] ?? '') : '';

    // The open query. Aggregators win most of these, and that is useful: an
    // aggregator often names something the primary search misses, and the name
    // is enough to reach the real page later.
    queries.push({
      text: clean(`${funding} ${subject} ${word} ${where} ${year}`),
      type,
      officialOnly: false,
    });

    // The primary-source query, restricted to where this type actually lives.
    const sites = HOMES[type].map((home) => `site:${home}`).join(' OR ');
    queries.push({
      text: clean(
        type === 'hackathon'
          ? // A hackathon page says "register", not "eligibility", and the
            // student's level is irrelevant to entering one.
            `${subject} ${word} ${where} ${year} (${sites})`
          : `${subject} ${word} ${level} ${where} (${sites})`,
      ),
      type,
      officialOnly: true,
    });

    /*
     * One more for hackathons, because they are the type most likely to be
     * happening right now and least likely to be indexed under a student's
     * words. "Upcoming" is how every platform labels the ones still open, and
     * it is the single most useful word available for excluding the thousands
     * that have already run.
     */
    if (type === 'hackathon') {
      queries.push({
        text: clean(`upcoming ${subject} ${word} ${where} register ${year}`),
        type,
        officialOnly: false,
      });
    }
  }

  return queries;
}

/**
 * Whether a host publishes opportunities rather than writing about them.
 *
 * Used to give primary sources a guaranteed share of the pages opened. The
 * hackathon platforms belong here for the same reason a ministry does: a
 * hackathon listing on Devpost is the thing itself, not somebody's summary of
 * it.
 */
export function looksOfficial(host: string): boolean {
  const lower = host.toLowerCase();
  return ALL_HOMES.some((home) => (home.startsWith('.') ? lower.endsWith(home) : lower.includes(home)));
}
