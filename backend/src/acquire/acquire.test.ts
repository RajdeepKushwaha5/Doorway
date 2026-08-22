import { describe, expect, it } from 'vitest';
import {
  plausibleDeadline,
  plausibleEligibility,
  plausibleFunding,
  plausibleProvider,
  scanForDeadline,
  scanForFunding,
  saysClosed,
} from './plausible.js';
import { inferType, looksLikeIndex, titleFrom } from './read.js';
import { mergeResults, type SerpResult } from './serp.js';
import { buildQueries } from './queries.js';
import type { DoorwayProfile } from '../doorway/types.js';

/**
 * Discovery is the one path where a wrong answer is cheapest to produce.
 *
 * Everywhere else in this system a value has been read twice, or checked
 * against a history, or both. Here a page nobody has ever seen is opened once
 * and believed. The guards below are what stand between that and a student
 * planning an evening around a date scraped out of a navigation link.
 */

describe('plausible values', () => {
  /*
   * Both of these came back from a real discovery run against live pages, each
   * found under a correct label. "Award" was the anchor text of a link to a
   * different page; "Benefits" was a heading above a list of nice things.
   */
  it('rejects the two garbage values a live run actually produced', () => {
    expect(plausibleFunding('//acr.iitm.ac.in/distinguished-alumni-award)')).toBeNull();
    expect(
      plausibleFunding(
        'Highly interdisciplinary work environment with mentoring by leading faculty in Data Science and Artificial Intelligence',
      ),
    ).toBeNull();
  });

  it('accepts dates a human would recognise', () => {
    expect(plausibleDeadline('18 September 2026')).toBe('18 September 2026');
    expect(plausibleDeadline('September 18, 2026')).toBe('September 18, 2026');
    expect(plausibleDeadline('2026-09-18')).toBe('2026-09-18');
    expect(plausibleDeadline('31/12/2026')).toBe('31/12/2026');
    expect(plausibleDeadline('Rolling until 10 October 2026')).toBe('Rolling until 10 October 2026');
  });

  /*
   * The label being returned as the value is the definition-list failure that
   * bit the witness on a live run. It must not survive here either.
   */
  it('rejects a label, a bare year and page furniture as deadlines', () => {
    expect(plausibleDeadline('Application deadline')).toBeNull();
    expect(plausibleDeadline('2026')).toBeNull();
    expect(plausibleDeadline('Read more')).toBeNull();
    expect(plausibleDeadline('https://example.com/apply')).toBeNull();
  });

  it('accepts funding stated as an amount or as coverage', () => {
    expect(plausibleFunding('Fully funded')).toBe('Fully funded');
    expect(plausibleFunding('INR 250,000')).toBe('INR 250,000');
    expect(plausibleFunding('Rs 40,000 stipend per month')).toBe('Rs 40,000 stipend per month');
    expect(plausibleFunding('tuition waiver')).toBe('tuition waiver');
  });

  it('rejects a heading with no statement about money', () => {
    expect(plausibleFunding('Benefits')).toBeNull();
    expect(plausibleFunding('Award')).toBeNull();
  });

  it('holds a provider to being a name rather than a description', () => {
    expect(plausibleProvider('Indian Institute of Technology Madras')).toBe(
      'Indian Institute of Technology Madras',
    );
    expect(
      plausibleProvider(
        'A very long description of the organisation that goes on and on and is plainly not a name',
      ),
    ).toBeNull();
  });

  it('rejects markup in every field', () => {
    expect(plausibleEligibility('[Apply here](https://example.com)')).toBeNull();
    expect(plausibleProvider('www.example.com/about')).toBeNull();
  });
});

describe('reading a candidate page', () => {
  /*
   * A list page extracts beautifully and means nothing: the deadline it yields
   * belongs to whichever entry happened to be first.
   */
  it('recognises a listing page as not being one opportunity', () => {
    expect(looksLikeIndex('Top 10 Scholarships for Indian Students', '')).toBe(true);
    expect(looksLikeIndex('Best scholarships 2026', '')).toBe(true);

    const many = Array.from({ length: 6 }, (_, i) => `[Apply now](https://x.test/${String(i)})`).join(
      '\n',
    );
    expect(looksLikeIndex('Some Programme', many)).toBe(true);
  });

  it('treats a single opportunity page as one', () => {
    expect(looksLikeIndex('Open AI Research Fellowship', '[Apply](https://x.test/a)')).toBe(false);
  });

  it("prefers the page's own heading to the search engine's title", () => {
    const markdown = '# IndiaAI Fellowship\n\nSome body text that follows the heading.';
    expect(titleFrom(markdown, 'IndiaAI Fellowship | Ministry of Electronics ...')).toBe(
      'IndiaAI Fellowship',
    );
  });

  it('lets the page override the type the query guessed', () => {
    // A query for fellowships routinely returns a scholarship. Mislabelling it
    // would put it in front of a student who filtered scholarships out.
    expect(inferType('National Merit Scholarship', 'fellowship')).toBe('scholarship');
    expect(inferType('Something Unlabelled', 'grant')).toBe('grant');
  });
});

describe('choosing what to open', () => {
  const profile: DoorwayProfile = {
    country: 'India',
    educationLevel: 'Undergraduate',
    interests: ['artificial intelligence'],
    skills: [],
    opportunityTypes: ['scholarship', 'fellowship'],
    fundingRequirement: 'full',
    locations: [],
  };

  it('asks several narrow questions rather than one wide one', () => {
    const queries = buildQueries(profile);
    expect(queries.length).toBeGreaterThan(2);
    // One query per type is restricted to bodies that publish funding, because
    // aggregators outrank ministries for every funding term.
    expect(queries.some((query) => query.officialOnly)).toBe(true);
    expect(queries.some((query) => !query.officialOnly)).toBe(true);
  });

  const result = (url: string, host: string, official = false): SerpResult => ({
    url,
    host,
    official,
    title: 't',
    description: 'd',
    query: 'q',
  });

  /*
   * Without the host cap, one aggregator with good search presence supplies
   * most of the candidates and a student's results are a single site's opinion.
   */
  it('caps how much of the result set one host can be', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      result(`https://aggregator.test/${String(i)}`, 'aggregator.test'),
    );
    const merged = mergeResults([many], { perHost: 2, limit: 10 });
    expect(merged).toHaveLength(2);
  });

  it('puts bodies that publish funding ahead of sites that write about it', () => {
    const merged = mergeResults([
      [result('https://blog.test/a', 'blog.test'), result('https://x.gov.in/a', 'x.gov.in', true)],
    ]);
    expect(merged[0]?.host).toBe('x.gov.in');
  });

  /*
   * Concatenating batches means the last query's results are always the ones
   * the cap discards, so asking for three types quietly returns only the first.
   */
  it('interleaves the queries so every type survives the cap', () => {
    const scholarships = [result('https://a.test/1', 'a.test'), result('https://a.test/2', 'a.test')];
    const fellowships = [result('https://b.test/1', 'b.test'), result('https://b.test/2', 'b.test')];
    const merged = mergeResults([scholarships, fellowships], { perHost: 2, limit: 2 });
    expect(new Set(merged.map((entry) => entry.host))).toEqual(new Set(['a.test', 'b.test']));
  });
});

/**
 * Each of these is a value a real discovery run produced and served.
 *
 * Keeping them as tests rather than as a changelog entry is the difference
 * between "we fixed that" and "it cannot come back".
 */
describe('what live pages actually returned', () => {
  it('rejects a hedged timeline as a deadline', () => {
    expect(
      plausibleDeadline(
        'Timeline for 2026 Deadline around mid-November 2025 (e.g., November 16 for recent cycles)',
      ),
    ).toBeNull();
  });

  it('keeps a deadline the page states plainly', () => {
    expect(plausibleDeadline('Applications close on May 17, 2026')).toBe(
      'Applications close on May 17, 2026',
    );
  });

  it('rejects a clause fragment as the name of a body', () => {
    expect(plausibleProvider('created AI policy organization')).toBeNull();
    expect(plausibleProvider('Adobe Research India')).toBe('Adobe Research India');
    // A hostname is a legitimate fallback and starts lowercase, so the guard
    // must not take that with it.
    expect(plausibleProvider('wsai.iitm.ac.in')).toBe('wsai.iitm.ac.in');
  });

  it('treats an aggregator roundup as a listing, not an opportunity', () => {
    expect(looksLikeIndex('Top AI Research Fellowships: How to Apply and Win in 2026/2027', '')).toBe(
      true,
    );
    expect(looksLikeIndex('35 Fully Funded Global AI Opportunities', '')).toBe(true);
    expect(looksLikeIndex('Transforming Society through AI Fellowship', '')).toBe(false);
  });

  it('finds a stipend stated in a bullet rather than beside a label', () => {
    const page = '# Fellowships\n\n*   Fellowship includes a monthly stipend of INR 1 lakh\n';
    expect(scanForFunding(page)).toBe('Fellowship includes a monthly stipend of INR 1 lakh');
  });

  it('will not call a date a deadline without a deadline word beside it', () => {
    // Funding pages are full of dates. Taking the first would reliably produce
    // a confident wrong answer.
    expect(scanForDeadline('The programme was founded on 3 March 2019 in Delhi.')).toBeNull();
  });
});

describe('typing from the slug', () => {
  /*
   * research.adobe.com's fellowship page is headed "Adobe India" and lives at
   * /india-ai-research-fellowship/. Typed from the heading alone it was filed
   * as a scholarship, which puts it in front of a student who filtered
   * scholarships out and hides it from the one who wanted fellowships.
   */
  it('reads the URL when the heading gives nothing away', () => {
    expect(
      inferType('Adobe India', 'scholarship', 'https://research.adobe.com/india-ai-research-fellowship/'),
    ).toBe('fellowship');
  });

  it('still lets an explicit heading win', () => {
    expect(inferType('National Merit Scholarship', 'fellowship', 'https://x.test/programme')).toBe(
      'scholarship',
    );
  });
});

describe('tidying what the page gave us', () => {
  /*
   * An Oxford fellowship page yielded a deadline beginning "No. Applications
   * received after 23 February 2026 ...", where "No." is the tail of the
   * sentence before it.
   */
  it('drops a fragment of the previous sentence', () => {
    const raw =
      'No. Applications received after 23 February 2026 at 12noon GMT will not be considered.';
    expect(plausibleDeadline(raw)).toBe(
      'Applications received after 23 February 2026 at 12noon GMT will not be considered.',
    );
  });

  it('leaves a clean deadline alone', () => {
    expect(plausibleDeadline('Applications close on May 17, 2026')).toBe(
      'Applications close on May 17, 2026',
    );
  });

  it("drops a search engine's truncation but keeps what names the page", () => {
    // This used to assert 'Fellowships', which is the whole problem: one word
    // shared by every fellowships page on the web. The site is the half that
    // says whose they are, so it stays when nothing more specific exists.
    expect(
      titleFrom('body text with no heading at all', 'Fellowships | Wadhwani School of Data ...'),
    ).toBe('Fellowships — Wadhwani School of Data');

    // A specific name still loses the site and the ellipsis.
    expect(
      titleFrom('body with no heading', 'Oxford Schmidt AI Fellowship | Oxford ...'),
    ).toBe('Oxford Schmidt AI Fellowship');
  });
});

describe('titles from production pages', () => {
  /*
   * research.google came back from a production run titled "Explore our many
   * areas of focus", the first heading on the page and pure marketing
   * furniture. A student scanning results cannot tell what that one is.
   */
  it('skips an instruction to the reader and keeps looking', () => {
    const markdown = '# Explore our many areas of focus\n\n## Google PhD Fellowship\n\nbody';
    expect(titleFrom(markdown, 'fallback')).toBe('Google PhD Fellowship');
  });

  it('still takes a real heading', () => {
    expect(titleFrom('# Oxford Schmidt AI in Science Fellowship\n\nbody', 'x')).toBe(
      'Oxford Schmidt AI in Science Fellowship',
    );
  });
});

describe('naming a discovered opportunity', () => {
  /*
   * Adobe's fellowship page is headed simply "Adobe India". The full name only
   * appears in the search engine's title. Keeping the heading loses the only
   * words that say what the page is for, and a student scanning a list cannot
   * tell "Adobe India" apart from anything else.
   */
  it('prefers the fuller name when the heading is its opening', () => {
    expect(
      titleFrom('# Adobe India\n\nbody text here', 'Adobe India AI Research Fellowship'),
    ).toBe('Adobe India AI Research Fellowship');
  });

  /*
   * wsai.iitm.ac.in gives "Fellowships" from both its heading and the head of
   * its search title. Cutting at the pipe leaves a word indistinguishable from
   * every other fellowships page; the half being discarded is the half that
   * says whose they are.
   */
  it('keeps the site when neither source gives a specific name', () => {
    expect(
      titleFrom(
        '# Fellowships\n\nbody',
        'Fellowships | Wadhwani School of Data Science and Artificial Intelligence',
      ),
    ).toBe('Fellowships — Wadhwani School of Data Science and Artificial Intelligence');
  });

  it('keeps a specific heading over the search title', () => {
    expect(
      titleFrom('# Oxford Schmidt AI in Science Fellowship\n\nbody', 'Something Else | Oxford'),
    ).toBe('Oxford Schmidt AI in Science Fellowship');
  });

  it('still drops marketing headings and questions', () => {
    expect(titleFrom('# Explore our many areas of focus\n\n## Google PhD Fellowship\n\nx', 'f')).toBe(
      'Google PhD Fellowship',
    );
  });
});

describe('titles a search engine truncated', () => {
  /*
   * Search engines cut wherever they run out of room, so removing the ellipsis
   * exposes the join. A live run produced "Google DeepMind Artificial
   * Intelligence Scholarship in", which reads like somebody was interrupted.
   */
  it('drops a word left hanging by the truncation', () => {
    expect(
      titleFrom('body with no heading', 'Google DeepMind Artificial Intelligence Scholarship in ...'),
    ).toBe('Google DeepMind Artificial Intelligence Scholarship');
  });

  it('keeps trimming when one removal exposes another', () => {
    expect(titleFrom('body with no heading', 'The Fellowship for the ...')).toBe(
      'The Fellowship',
    );
  });

  it('leaves a complete title alone', () => {
    expect(titleFrom('body with no heading', 'Oxford Schmidt AI in Science Fellowship')).toBe(
      'Oxford Schmidt AI in Science Fellowship',
    );
  });
});

/**
 * The single most important thing a page can tell a student is that they are
 * too late, and it was the one thing being discarded.
 *
 * Adobe's fellowship page has a "Key dates" section whose entire content is
 * "Applications are closed for the Adobe India AI Research Fellowship". The
 * line was found, matched the deadline label, and was rejected for containing
 * no date, so the record went out reading "Deadline: Not stated". A student
 * reads that as still open with the date unclear.
 */
describe('a door that is already shut', () => {
  it('recognises the closure Adobe actually publishes', () => {
    expect(
      saysClosed('# Key dates\n\n* Applications are closed for the Adobe India AI Research Fellowship'),
    ).toBe(true);
  });

  it('recognises the other ways a page says it', () => {
    expect(saysClosed('Applications are now closed.')).toBe(true);
    expect(saysClosed('We are no longer accepting applications')).toBe(true);
    expect(saysClosed('The deadline has passed for this round.')).toBe(true);
    expect(saysClosed('This fellowship is closed.')).toBe(true);
  });

  /*
   * "Applications open in March" and "applications are closed until March"
   * mean opposite things to somebody deciding whether to read on.
   */
  it('does not mistake an announcement of the next round for a shut door', () => {
    expect(saysClosed('Applications are closed. Applications will open again in March 2027.')).toBe(
      false,
    );
    expect(saysClosed('Applications open on 1 March 2027')).toBe(false);
  });

  it('leaves an open page alone', () => {
    expect(saysClosed('Applications close on 17 May 2026')).toBe(false);
    expect(saysClosed('Apply by 30 September 2026')).toBe(false);
  });
});

describe('press coverage is not the opportunity', () => {
  /*
   * Both of these came through a live run as opportunities. They are articles
   * about somebody else winning one, so the "funding" was the headline and the
   * apply link went to a newsroom.
   */
  it('drops news and press paths', () => {
    expect(
      looksLikeIndex('IIT Madras Announces AI Fellowship', '', 'https://acr.iitm.ac.in/iitm_in_news/x'),
    ).toBe(true);
    expect(
      looksLikeIndex('Student selected for fellowship', '', 'https://earlham.edu/news-events/x'),
    ).toBe(true);
  });

  it('leaves a real programme page alone', () => {
    expect(looksLikeIndex('Fellowships', '', 'https://wsai.iitm.ac.in/fellowships/')).toBe(false);
  });
});

describe('titles carrying markdown', () => {
  /*
   * A heading that is itself a link arrives as "[SuperKalam](/companies/...)",
   * which a live run served to a student as the name of an opportunity.
   */
  it('keeps the text and drops the machinery', () => {
    expect(titleFrom('body with no heading', '[SuperKalam](/companies/superkalam)')).toBe(
      'SuperKalam',
    );
    expect(titleFrom('# **Oxford Fellowship**\n\nbody', 'x')).toBe('Oxford Fellowship');
  });
});

/**
 * A scholarship and a hackathon have nothing in common as search problems.
 *
 * Searching for hackathons asked for a "fully funded hackathon" restricted to
 * .gov.in and .edu. Hackathons are free to enter, pay in prizes, and are
 * published on Devpost and Devfolio rather than by ministries, so the search
 * returned almost nothing and a student saw two results.
 */
describe('searching for hackathons', () => {
  const profile: DoorwayProfile = {
    country: 'India',
    educationLevel: 'Undergraduate',
    interests: ['artificial intelligence'],
    skills: [],
    opportunityTypes: ['hackathon'],
    fundingRequirement: 'full',
    locations: [],
  };

  const queries = buildQueries(profile);

  it('never asks for a funded hackathon', () => {
    expect(queries.every((q) => !/fully funded|funded/i.test(q.text))).toBe(true);
  });

  it('looks where hackathons are actually published', () => {
    const primary = queries.find((q) => q.officialOnly);
    expect(primary?.text).toContain('devpost.com');
    expect(primary?.text).toContain('devfolio.co');
    expect(primary?.text).not.toContain('.gov.in');
  });

  it('asks for the ones still ahead', () => {
    expect(queries.some((q) => /upcoming/i.test(q.text))).toBe(true);
  });

  it('still asks for funding on the types where money is the point', () => {
    const scholarships = buildQueries({ ...profile, opportunityTypes: ['scholarship'] });
    expect(scholarships.some((q) => /fully funded/i.test(q.text))).toBe(true);
    expect(scholarships.find((q) => q.officialOnly)?.text).toContain('.gov.in');
  });

  /*
   * A platform's index lists hundreds; the listing one directory deeper is the
   * thing a student enters.
   */
  it('tells a platform index apart from a listing on it', () => {
    expect(looksLikeIndex('Hackathons', '', 'https://devpost.com/hackathons')).toBe(true);
    expect(looksLikeIndex('Hackathons', '', 'https://unstop.com/hackathons/')).toBe(true);
    expect(looksLikeIndex('AI Agents Hackathon', '', 'https://devpost.com/ai-agents-2026')).toBe(
      false,
    );
  });
});

describe('platform shelves versus what is on them', () => {
  /*
   * devpost.com/c/artificial-intelligence came back titled "The home for AI
   * hackathons" with a marketing line as its provider. It is the shelf.
   */
  it('drops category pages', () => {
    expect(looksLikeIndex('The home for AI hackathons', '', 'https://devpost.com/c/artificial-intelligence')).toBe(true);
    expect(looksLikeIndex('x', '', 'https://unstop.com/tag/ai')).toBe(true);
  });

  /*
   * Five hackathons on Devpost are five hackathons, not one site's opinion of
   * one. Capping primary sources at two was why a search opened four pages.
   */
  it('lets a primary source contribute more than an aggregator', () => {
    const platform = Array.from({ length: 6 }, (_, i) => ({
      url: `https://devpost.com/h${String(i)}`,
      host: 'devpost.com',
      official: true,
      title: 't',
      description: 'd',
      query: 'q',
    }));
    const blog = Array.from({ length: 6 }, (_, i) => ({
      url: `https://blog.test/${String(i)}`,
      host: 'blog.test',
      official: false,
      title: 't',
      description: 'd',
      query: 'q',
    }));

    const merged = mergeResults([platform, blog], { perHost: 2, perPrimaryHost: 5, limit: 20 });
    expect(merged.filter((r) => r.host === 'devpost.com')).toHaveLength(5);
    expect(merged.filter((r) => r.host === 'blog.test')).toHaveLength(2);
  });
});

describe('hackathon titles from live runs', () => {
  it('drops a section prefix and a trailing colon', () => {
    expect(titleFrom('# About ET AI Hackathon 2026\n\nbody', 'x')).toBe('ET AI Hackathon 2026');
    expect(titleFrom('# Smart Horizon:\n\nbody', 'x')).toBe('Smart Horizon');
  });
});

describe('money a hackathon actually offers', () => {
  /*
   * Hackathons pay in prizes. Every one of them reported "not stated" while the
   * page announced a prize pool in its heading.
   */
  it('reads a prize pool as the money on offer', () => {
    expect(scanForFunding('Silver Jubilee Celebrations Prize Pool: INR 23,75,000')).toContain(
      '23,75,000',
    );
    expect(scanForFunding('Over $10,000 in prizes await the winners')).toContain('10,000');
  });
});

/**
 * Every filter has to work, not just the two that were built first.
 *
 * One money phrase for all six types produced "fully funded internship" and
 * "fully funded grant". Neither is published anywhere: an internship pays a
 * stipend and a grant is money by definition, so the phrase narrows the search
 * to pages containing a redundancy. A word nobody writes filters out the real
 * pages rather than the wrong ones.
 */
describe('all six opportunity types', () => {
  const base: DoorwayProfile = {
    country: 'India',
    educationLevel: 'Undergraduate',
    interests: ['artificial intelligence'],
    skills: [],
    opportunityTypes: [],
    fundingRequirement: 'full',
    locations: [],
  };

  const forType = (type: DoorwayProfile['opportunityTypes'][number]) =>
    buildQueries({ ...base, opportunityTypes: [type] });

  it('produces at least two searches for every type', () => {
    for (const type of [
      'scholarship',
      'fellowship',
      'internship',
      'research-program',
      'grant',
      'hackathon',
    ] as const) {
      expect(forType(type).length, type).toBeGreaterThanOrEqual(2);
      // A query that is only site restrictions has nothing to match on.
      for (const query of forType(type)) {
        expect(query.text.replace(/\(site:[^)]*\)/, '').trim().length, type).toBeGreaterThan(8);
      }
    }
  });

  it('never asks for a funded grant or a funded hackathon', () => {
    expect(forType('grant').every((q) => !/funded/i.test(q.text))).toBe(true);
    expect(forType('hackathon').every((q) => !/funded/i.test(q.text))).toBe(true);
  });

  it('asks for a paid internship rather than a funded one', () => {
    const internships = forType('internship');
    expect(internships.some((q) => /\bpaid\b/i.test(q.text))).toBe(true);
    expect(internships.every((q) => !/fully funded/i.test(q.text))).toBe(true);
  });

  it('looks for internships where work is advertised', () => {
    expect(forType('internship').find((q) => q.officialOnly)?.text).toContain('internshala.com');
  });

  it('keeps funding language where money is genuinely the question', () => {
    for (const type of ['scholarship', 'fellowship', 'research-program'] as const) {
      expect(forType(type).some((q) => /fully funded/i.test(q.text)), type).toBe(true);
    }
  });

  it('spreads across types rather than repeating the first', () => {
    const mixed = buildQueries({
      ...base,
      opportunityTypes: ['scholarship', 'fellowship', 'internship', 'hackathon'],
    });
    expect(new Set(mixed.map((q) => q.type)).size).toBe(4);
  });
});

describe('what a crawl reaches that a search never did', () => {
  /*
   * At a hundred and twenty pages the crawl walks into every job board on the
   * internet. A result count is never one opportunity, however many
   * opportunities it happens to be counting.
   */
  it('recognises a job board result count', () => {
    expect(looksLikeIndex('144 Machine learning intern jobs in India', '')).toBe(true);
    expect(looksLikeIndex('2,431 AI internships', '')).toBe(true);
    expect(looksLikeIndex('Current vacancies', '')).toBe(true);
    expect(looksLikeIndex('All openings', '')).toBe(true);
  });

  it('leaves a single opportunity alone', () => {
    expect(looksLikeIndex('Anthropic Fellows Program for AI Safety Research', '')).toBe(false);
    expect(looksLikeIndex('2026 Oxford Schmidt AI Fellowship', '')).toBe(false);
  });
});

/**
 * Two date parsers, one of them fixed.
 *
 * `plausibleDeadline` carried its own regexes alongside the parser in dates.ts.
 * Ordinal suffixes were added there and not here, so "Registration Deadline:
 * 15th July 2026" was rejected while "15 July 2026" was accepted. Real pages
 * write the ordinal, and it cost most of the deadlines in the index: two of
 * twenty-three records had one, and the diagnosis was going to be "the dates
 * are in PDFs" until somebody read the markdown.
 */
describe('dates written the way people write them', () => {
  it('accepts the ordinal a live page actually used', () => {
    // internshala.com/competitions/1st-india-computer-vision-hackathon-2026
    expect(scanForDeadline('*   **Registration Deadline:** 15th July 2026')).toBe(
      'Registration Deadline: 15th July 2026',
    );
  });

  it('accepts every ordinal suffix', () => {
    expect(plausibleDeadline('Deadline: 1st August 2026')).not.toBeNull();
    expect(plausibleDeadline('Deadline: 2nd August 2026')).not.toBeNull();
    expect(plausibleDeadline('Deadline: 3rd March 2027')).not.toBeNull();
    expect(plausibleDeadline('Applications close 22nd May 2026')).not.toBeNull();
  });

  it('still refuses what is not a date', () => {
    expect(plausibleDeadline('Application deadline')).toBeNull();
    expect(plausibleDeadline('2026')).toBeNull();
    expect(plausibleDeadline('Rolling admissions')).toBeNull();
  });

  /*
   * Asking the parser is stronger than matching a shape: a string that parses
   * contains a date, where a date-shaped pattern might say "32 Septembre".
   */
  it('refuses a date-shaped string that is not a date', () => {
    expect(plausibleDeadline('Deadline: 45th Montober 2026')).toBeNull();
  });
});

describe('the date under the heading', () => {
  /*
   * A line scanner structurally cannot see this shape, and a great many funding
   * pages use it. The word and the date are both present and never share a
   * line, so every one of them read as "not stated".
   */
  it('reads a date beneath a deadline heading', () => {
    expect(scanForDeadline('## Application deadline\n\n15 July 2026\n')).toBe('15 July 2026');
    expect(scanForDeadline('**Last date to apply**\n\n3rd March 2027')).toBe('3rd March 2027');
  });

  it('does not take prose that merely follows a heading', () => {
    expect(
      scanForDeadline('## Application deadline\n\nSee the programme handbook for details.'),
    ).toBeNull();
  });

  /*
   * A second labelled field under the first means this heading's value is not
   * below it, and taking the next date would attribute one field's answer to
   * another.
   */
  it('stops at the next labelled field', () => {
    expect(
      scanForDeadline('## Application deadline\n\n## Notification date\n\n1 May 2026'),
    ).toBeNull();
  });

  it('still prefers a date on the line itself', () => {
    expect(scanForDeadline('Deadline: 18 September 2026\n\n1 January 2030')).toBe(
      'Deadline: 18 September 2026',
    );
  });
});

/**
 * Searching for internships returned an empty page.
 *
 * Every part of the pipeline worked: the searches found real postings, and this
 * threw them away. Real listings say "Intern", never "internship", so
 * "Founder's Office - Intern at Cityfurnish" matched none of the words used to
 * decide whether a page is an opportunity at all.
 *
 * That is the worst place for the mistake to be. It is invisible from outside
 * and indistinguishable from the web not having anything.
 */
describe('the vocabulary listings actually use', () => {
  it('types an intern posting as an internship', () => {
    expect(inferType("Founder's Office - Intern at Cityfurnish", 'scholarship')).toBe('internship');
    expect(inferType('Summer Trainee, Data Science', 'scholarship')).toBe('internship');
    expect(inferType('Research Interns 2026', 'grant')).toBe('internship');
  });

  it('does not mistake a word containing intern for one', () => {
    // "International" and "internal" both contain the letters.
    expect(inferType('International Climate Grant', 'grant')).toBe('grant');
  });

  /*
   * A multi-word interest is a phrase. Unquoted, "Founder Office" matches any
   * page containing both words anywhere, which on a job board is nearly all of
   * them and on the open web is none of the right ones.
   */
  it('searches a multi-word interest as a phrase', () => {
    const queries = buildQueries({
      country: 'India',
      educationLevel: 'Undergraduate',
      interests: ['Founder Office'],
      skills: [],
      opportunityTypes: ['internship'],
      fundingRequirement: 'any',
      locations: [],
    });
    expect(queries.every((q) => q.text.includes('"Founder Office"'))).toBe(true);
  });

  it('leaves a single word unquoted', () => {
    const queries = buildQueries({
      country: 'India',
      educationLevel: 'Undergraduate',
      interests: ['robotics'],
      skills: [],
      opportunityTypes: ['internship'],
      fundingRequirement: 'any',
      locations: [],
    });
    // Quoting "robotics" would exclude "robotic", which nobody meant.
    expect(queries.every((q) => !q.text.includes('"robotics"'))).toBe(true);
  });

  it('asks in the listing vocabulary as well as the form vocabulary', () => {
    const internships = buildQueries({
      country: 'India',
      educationLevel: 'Undergraduate',
      interests: ['robotics'],
      skills: [],
      opportunityTypes: ['internship'],
      fundingRequirement: 'any',
      locations: [],
    });
    // Nobody advertises an "internship" for a founder's office; they advertise
    // an "intern".
    expect(internships.some((q) => /\bintern\b/.test(q.text))).toBe(true);
    expect(internships).toHaveLength(3);
  });
});
