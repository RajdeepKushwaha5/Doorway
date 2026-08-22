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

/**
 * How each kind of opportunity talks about its money.
 *
 * This began as one phrase for everything, which produced "fully funded
 * internship" and "fully funded grant". Neither is a thing anybody publishes:
 * an internship pays a stipend, and a grant is money by definition, so saying
 * "funded grant" narrows the search to pages that happen to contain a redundant
 * phrase. A word nobody writes is worse than no word at all, because it filters
 * out the real pages rather than the wrong ones.
 */
function moneyWord(type: OpportunityType, requirement: string): string {
  switch (type) {
    case 'hackathon':
      // Free to enter, pays in prizes. No money word belongs in the query.
      return '';
    case 'grant':
      // A grant is the money. "Funded grant" asks for a tautology.
      return '';
    case 'internship':
      // Paid is the word every listing uses. Stipend is the other one.
      return requirement === 'any' ? '' : 'paid';
    default:
      if (requirement === 'full') return 'fully funded';
      if (requirement === 'partial') return 'funded';
      return '';
  }
}

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
  // Internships are advertised where work is advertised. Restricting them to
  // universities and ministries asked the wrong buildings.
  internship: ['internshala.com', 'unstop.com', '.edu', '.ac.in', '.gov.in', '.org'],
  'research-program': ['.edu', '.ac.in', '.ac.uk', '.gov.in', '.org'],
  grant: ['.gov.in', '.gov', '.org', '.edu'],
  hackathon: [
    'wemakedevs.org',
    'devpost.com',
    'hackindia.org',
    'devfolio.co',
    'unstop.com',
    'mlh.io',
    'hackerearth.com',
    'dorahacks.io',
    'lu.ma',
  ],
};

/**
 * The second word for each type, and how a listing frames it.
 *
 * Deliberately not a synonym list. Each entry is the phrasing a page offering
 * the thing would use, which is a different question from what the thing is
 * called: "upcoming ... register" finds hackathons still open, and "intern
 * role" finds the postings that never once say "internship".
 */
const ALTERNATE_WORDS: Record<OpportunityType, { prefix: string; word: string; suffix: string } | null> = {
  scholarship: { prefix: 'apply for', word: 'scholarship', suffix: 'applications open' },
  fellowship: { prefix: 'apply for', word: 'fellowship', suffix: 'applications open' },
  internship: { prefix: '', word: 'intern', suffix: 'apply' },
  'research-program': { prefix: '', word: 'research assistantship', suffix: 'apply' },
  grant: { prefix: 'apply for', word: 'funding call', suffix: 'proposals' },
  hackathon: { prefix: 'upcoming', word: 'hackathon', suffix: 'register' },
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
  const maxTypes = options.maxTypes ?? 6;

  /*
   * A multi-word interest is a phrase, and has to be searched as one.
   *
   * "Founder Office" unquoted matches any page containing both words anywhere,
   * which on a job board is nearly all of them and on the open web is none of
   * the right ones. Quoted, it finds the roles that are actually called that.
   *
   * Single words are left bare: quoting "internship" would exclude
   * "internships", which is not what anybody meant.
   */
  const interests = profile.interests
    .map((entry) => clean(entry))
    .filter((entry) => entry !== '')
    .slice(0, 2)
    .map((entry) => (entry.includes(' ') ? `"${entry}"` : entry));

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
    const funding = moneyWord(type, profile.fundingRequirement);

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
     * A third query in the vocabulary listings actually use.
     *
     * The word a form offers and the word a page publishes are rarely the same.
     * Nobody advertises an "internship" for a founder's office; they advertise
     * an "intern". Nobody labels a hackathon "hackathon India 2026"; they label
     * it "upcoming" and ask you to register. Searching only the form's word
     * finds the pages written about opportunities rather than the ones offering
     * them.
     */
    const alternate = ALTERNATE_WORDS[type];
    if (alternate !== null) {
      queries.push({
        text: clean(`${alternate.prefix} ${subject} ${alternate.word} ${where} ${alternate.suffix}`),
        type,
        officialOnly: false,
      });
    }

    /*
     * Hackathons are unusually concentrated on a few publisher platforms.
     * These broad primary-source queries deliberately do not include the
     * student's interest or country. A page may say "AI" where the form says
     * "Artificial intelligence", and excluding it at search time prevents the
     * ranking layer from ever seeing the right event.
     */
    if (type === 'hackathon') {
      for (const host of ['wemakedevs.org/hackathons', 'devpost.com', 'hackindia.org']) {
        queries.push({
          text: `site:${host} hackathon register ${year}`,
          type,
          officialOnly: true,
        });
      }
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
