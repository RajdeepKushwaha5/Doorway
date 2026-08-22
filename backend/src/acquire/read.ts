import { fetchWitnessMarkdown } from '../brightdata/unlocker.js';
import { extractFields } from '../witness/extract.js';
import type { WitnessFieldSpec } from '../witness/spec.js';
import type { OpportunityType } from '../doorway/types.js';
import type { SerpResult } from './serp.js';
import {
  plausibleDeadline,
  plausibleEligibility,
  plausibleFunding,
  plausibleProvider,
  scanForDeadline,
  scanForFunding,
  saysClosed,
} from './plausible.js';
import { deadlineHasPassed } from './dates.js';

/**
 * Read one discovered page and try to make an opportunity out of it.
 *
 * Uses the witness's own extractor rather than a new one. That is deliberate
 * and it is the whole reason discovery can be trusted at all: the witness
 * reads by label, following the words a page shows a human, so it works on a
 * page nobody has ever written a selector for. A discovery path with its own
 * bespoke parser would be a second thing to keep correct, and the first thing
 * to quietly rot.
 *
 * What comes out is a draft, not a verified opportunity. One sensor read this
 * page once. Saying more than that is the failure this project is about, so
 * every draft carries what it is missing and how far it should be believed.
 */

/**
 * What to look for, in the words funding pages use.
 *
 * Deliberately generous with labels. A ministry writes "Last date for
 * submission of applications", a university writes "Deadline", a foundation
 * writes "Applications close". They are the same fact.
 */
export const OPPORTUNITY_SPECS: WitnessFieldSpec[] = [
  {
    path: 'deadline_raw',
    meaning: 'the date applications close',
    labels: [
      'application deadline',
      'last date to apply',
      'last date for submission',
      'last date',
      'applications close',
      'closing date',
      'apply by',
      'deadline',
    ],
    excludeLabels: [
      'early interest',
      'notification',
      'posted',
      'announced',
      'result',
      'published',
      'interview',
    ],
    kind: 'text',
    allowed: [],
  },
  {
    path: 'funding_level',
    meaning: 'how much of the cost the award covers',
    labels: [
      'funding',
      'award',
      'stipend',
      'scholarship amount',
      'financial support',
      'benefits',
      'fellowship amount',
    ],
    excludeLabels: ['sponsored', 'advertisement'],
    kind: 'text',
    allowed: [],
  },
  {
    path: 'eligibility',
    meaning: 'who is allowed to apply',
    labels: ['eligibility', 'who can apply', 'eligible candidates', 'eligibility criteria'],
    excludeLabels: [],
    kind: 'text',
    allowed: [],
  },
  {
    path: 'provider',
    meaning: 'the body offering the opportunity',
    labels: ['offered by', 'provider', 'organisation', 'organization', 'host institution'],
    excludeLabels: [],
    kind: 'text',
    allowed: [],
  },
];

export interface OpportunityDraft {
  sourceUrl: string;
  host: string;
  title: string;
  provider: string;
  type: OpportunityType;
  summary: string;
  deadlineRaw: string | null;
  fundingLevel: string | null;
  eligibility: string | null;
  official: boolean;
  /** Which search surfaced it. */
  foundVia: string;
  /** Fields the page did not yield, named rather than filled in. */
  missing: string[];
  /** SHA-free provenance: how many independent reads back this. Always 1 here. */
  sensorCount: 1;
  readAt: string;
}

/** Words that mean this page is a listing index, not a single opportunity. */
const INDEX_HINTS = [
  'list of',
  'best scholarships',
  'scholarships for',
  'opportunities for',
  // Aggregator article shapes. "Top AI Research Fellowships: How to Apply and
  // Win in 2026/2027" passed the old list, which only knew about "top 10" and
  // "top 20", and produced a deadline of "Timeline for 2026 Deadline around
  // mid-November 2025 (e.g., November 16 for recent cycles)". That is an
  // article about deadlines, not a deadline.
  'how to apply',
  'complete guide',
  'ultimate guide',
  'everything you need',
  'a guide to',
];

/** Title shapes that mean a roundup rather than a single opportunity. */
const INDEX_SHAPES = [
  /^\s*top\s+\d*\s*\w/i,
  /^\s*\d{1,3}\s+(?:best|fully|top|amazing|great)\b/i,
  /\bfellowships\b.*\b(?:20\d\d)\s*[/-]\s*20\d\d/i,
];

/**
 * Whether a page is one opportunity or a list of them.
 *
 * A list page extracts beautifully and means nothing: the deadline it yields
 * belongs to whichever entry happened to be first. Serving that to a student
 * is exactly the confident wrong answer this project exists to prevent, so
 * these are dropped rather than published with a caveat.
 */
export function looksLikeIndex(title: string, markdown: string, url = ''): boolean {
  /*
   * The URL says what a page is even when its title does not.
   *
   * A roundup at applykite.com/scholarships/top-fully-funded-international-
   * scholarships-for-2026 passed the title check, because the heading picked
   * off the page was an FAQ question rather than the article's own name. The
   * slug was never in any doubt.
   */
  const slug = url.toLowerCase();
  /*
   * News coverage of a fellowship is not the fellowship.
   *
   * acr.iitm.ac.in/iitm_in_news/... and earlham.edu/news-events/... both came
   * through a live run as opportunities. They are press releases about somebody
   * else winning one, so their "funding" was the article's own headline and
   * their apply link went to a newsroom.
   */
  if (/\/(?:top|best|list)-|-list-|\/blog\/|\/articles?\/|\/news|_news|\/press/.test(slug)) {
    return true;
  }

  /*
   * A platform's index of hackathons is not a hackathon.
   *
   * devpost.com/hackathons and unstop.com/hackathons list hundreds; the
   * individual listing one directory deeper is the thing a student enters.
   * These platforms are primary sources, so they are searched deliberately, and
   * their front doors have to be told apart from their rooms.
   */
  if (/\/(?:hackathons|opportunities|competitions|challenges|events|jobs)\/?$/.test(slug)) {
    return true;
  }

  /*
   * A category is not an event either.
   *
   * devpost.com/c/artificial-intelligence came back titled "The home for AI
   * hackathons" with a marketing line as its provider. It is the shelf, not
   * anything on it.
   */
  if (/\/(?:c|category|categories|tag|tags|topics?|browse|search)\//.test(slug)) return true;

  const lower = title.toLowerCase();
  if (INDEX_HINTS.some((hint) => lower.includes(hint))) return true;
  if (INDEX_SHAPES.some((shape) => shape.test(title))) return true;

  // Many "apply" links on one page is the other reliable signal.
  const applyLinks = markdown.match(/\[[^\]]*\b(apply|application)\b[^\]]*\]\(/gi) ?? [];
  return applyLinks.length >= 5;
}

function firstString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Guess the type from what the page calls itself.
 *
 * The search that surfaced this page already has an opinion, passed in as
 * `fallback`. The page's own words beat it, because a query for fellowships
 * routinely returns a scholarship and mislabelling it would put it in front of
 * a student who filtered fellowships out.
 */
export function inferType(title: string, fallback: OpportunityType, url = ''): OpportunityType {
  // The slug is often more honest than the heading. research.adobe.com's page
  // is headed "Adobe India" and lives at /india-ai-research-fellowship/, and
  // typing it from the heading alone filed a fellowship as a scholarship.
  const lower = `${title} ${url.replace(/[/_-]/g, ' ')}`.toLowerCase();
  if (lower.includes('fellowship')) return 'fellowship';
  if (lower.includes('scholarship')) return 'scholarship';
  if (lower.includes('internship')) return 'internship';
  if (lower.includes('hackathon')) return 'hackathon';
  if (lower.includes('grant')) return 'grant';
  if (lower.includes('research')) return 'research-program';
  return fallback;
}

/** Section headings and site furniture, never the name of an opportunity. */
const GENERIC_TITLE =
  /^(fellowship|scholarship|internship|grant|overview|about|home|apply|programme|program|opportunities|awards?)s?$/i;

/** A heading that instructs the reader rather than naming anything. */
const IMPERATIVE_TITLE = /^(explore|discover|learn|see|browse|find|meet|read|join|start|get)\b/i;

/**
 * Words that leave a title hanging mid-phrase.
 *
 * A search engine truncates wherever it runs out of room, so removing its
 * ellipsis routinely exposes the join: "Google DeepMind Artificial Intelligence
 * Scholarship in ..." becomes "... Scholarship in", which reads like a sentence
 * somebody was interrupted saying.
 */
const DANGLING = /\s+(?:in|for|at|to|of|on|with|and|the|a|an|by|from)$/i;

/** Strip a search engine's truncation and whatever it left behind. */
function tidyTitle(value: string): string {
  let out = value
    // A heading that is itself a link arrives as "[SuperKalam](/companies/...)",
    // which a live run served as an opportunity title. Keep the text, drop the
    // machinery.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    // "About ET AI Hackathon 2026" is a section heading wearing the name. The
    // name is the part after it.
    .replace(/^(?:about|welcome to|introducing)\s+/i, '')
    // "Smart Horizon:" is a title whose subtitle was on the next line.
    .replace(/\s*[:;,]\s*$/, '')
    .replace(/\s*\.{2,}\s*$/, '')
    .replace(/\s*[|–—-]\s*$/, '')
    .trim();
  // Repeat: removing one dangling word can expose another.
  while (DANGLING.test(out)) out = out.replace(DANGLING, '').trim();
  return out;
}

/**
 * The best name available for this opportunity.
 *
 * Two candidates, and neither is reliably better. The page's own heading is
 * what the body offering the money called it, which is usually right and
 * sometimes is the site's masthead: Adobe's fellowship page is headed simply
 * "Adobe India". The search engine's title is often the fuller name with the
 * site glued on: "Adobe India AI Research Fellowship".
 *
 * So take both and prefer whichever is more specific, rather than declaring one
 * source authoritative and living with its bad days. A student scanning a list
 * of results needs to be able to tell which one is which, and "Adobe India"
 * and "Fellowships" both fail that at a glance.
 */
export function titleFrom(markdown: string, fallback: string): string {
  const searchTitle = tidyTitle(fallback);
  const [searchHead = searchTitle] = searchTitle.split(/\s+[|–—]\s+/);
  const cleanedSearch = tidyTitle(searchHead);

  let heading: string | null = null;
  for (const line of markdown.split(/\r?\n/).slice(0, 60)) {
    const match = /^#{1,2}\s+(.{4,120})$/.exec(line.trim());
    const found = match?.[1]?.trim();
    if (found === undefined) continue;
    if (GENERIC_TITLE.test(found)) continue;
    // A heading that is a question belongs to an FAQ further down the page.
    if (found.endsWith('?')) continue;
    // research.google was titled "Explore our many areas of focus" from a live
    // run, which is marketing furniture rather than a name.
    if (IMPERATIVE_TITLE.test(found)) continue;
    heading = tidyTitle(found);
    break;
  }

  /*
   * A heading that is the opening of the fuller name is the shorter of two
   * right answers.
   *
   * "Adobe India" is a prefix of "Adobe India AI Research Fellowship". Keeping
   * the prefix loses the only words that say what the page is for.
   */
  if (heading !== null && cleanedSearch.toLowerCase().startsWith(heading.toLowerCase())) {
    return cleanedSearch.length > heading.length ? cleanedSearch : heading;
  }

  if (heading !== null) return heading;

  /*
   * Neither source gave a specific name, so keep the site with it.
   *
   * wsai.iitm.ac.in yields "Fellowships" from its heading and "Fellowships |
   * Wadhwani School of Data Science and Artificial ..." from search. Cutting at
   * the pipe leaves "Fellowships", which is indistinguishable from every other
   * fellowships page in a list. The half being discarded is the half that says
   * whose they are.
   */
  if (GENERIC_TITLE.test(cleanedSearch) && searchTitle !== cleanedSearch) {
    return tidyTitle(searchTitle.replace(/\s+\|\s+/, ' — '));
  }

  return cleanedSearch === '' ? searchTitle : cleanedSearch;
}

interface ReadConfig {
  apiKey: string;
  zone: string;
  baseUrl?: string;
  country?: string;
}

/**
 * Read one candidate. Returns null when the page is not a single opportunity.
 *
 * Never throws for a page-level problem. A student asked for opportunities,
 * not for a report on which of twelve fetches failed, and one unreachable
 * source is not a reason to return nothing.
 */
export async function readCandidate(
  config: ReadConfig,
  candidate: SerpResult,
  type: OpportunityType,
  signal?: AbortSignal,
): Promise<OpportunityDraft | null> {
  let markdown: string;
  try {
    const fetched = await fetchWitnessMarkdown(
      {
        apiKey: config.apiKey,
        zone: config.zone,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.country === undefined ? {} : { country: config.country }),
      },
      candidate.url,
      signal,
    );
    markdown = fetched.markdown;
  } catch {
    return null;
  }

  if (markdown.trim().length < 400) return null;

  /*
   * A closed opportunity is not an opportunity.
   *
   * Adobe's page has a "Key dates" section whose entire content is
   * "Applications are closed for the Adobe India AI Research Fellowship". That
   * line matched the deadline label and was then rejected for containing no
   * date, so the record went out with its deadline reading "Not stated". A
   * student reads that as still open with the date unclear, and spends an
   * evening on an application that cannot be submitted. Dropping the record is
   * the only honest answer: this product exists to find things somebody can
   * still apply to.
   */
  if (saysClosed(markdown)) return null;

  const title = titleFrom(markdown, candidate.title);
  if (looksLikeIndex(title, markdown, candidate.url)) return null;
  // A title that is a question means an article about the subject, not the
  // thing itself.
  if (title.trim().endsWith('?')) return null;

  const { values } = extractFields(markdown, OPPORTUNITY_SPECS);
  const byPath = new Map(values.map((value) => [value.path, value.value]));

  /*
   * Every extracted value has to look like the thing it claims to be.
   *
   * The extractor finds a labelled line and returns what follows. On a page
   * built out of labelled facts that is exactly right. On an arbitrary page
   * found by searching, "Benefits" is a heading above a bulleted list and
   * "Award" is the anchor text of a link somewhere else, so a correct label
   * match still yields nonsense. A value that fails its shape is reported as
   * absent, because "not stated on the page" is true and useful and a URL
   * fragment presented as the money on offer is neither.
   */
  /*
   * Labelled first, then scanned.
   *
   * A labelled value is stated where the page says it is stated, which is
   * better evidence than a sentence found by searching. But read against eight
   * live official sources, label extraction alone produced nothing usable from
   * any of them: the labels it needs were simply not on those pages. What was
   * there was a bullet reading "Fellowship includes a monthly stipend of INR 1
   * lakh", which states the fact perfectly well without ever labelling it.
   */
  const deadlineRaw =
    plausibleDeadline(firstString(byPath.get('deadline_raw')) ?? '') ?? scanForDeadline(markdown);
  const fundingLevel =
    plausibleFunding(firstString(byPath.get('funding_level')) ?? '') ?? scanForFunding(markdown);
  const eligibility = plausibleEligibility(firstString(byPath.get('eligibility')) ?? '');
  const provider = plausibleProvider(firstString(byPath.get('provider')) ?? '');

  // Rejected values are missing values, and the draft must say so rather than
  // reporting the field as found because a label matched.
  /*
   * A date in the past is a shut door, whether or not the page says so.
   *
   * A live search returned "AI Hackathon in India" with a deadline of 7
   * November 2025 and served it as something to apply to, nine months after it
   * ended. Detecting the words "applications are closed" catches the pages that
   * bother to say it; most simply publish a date, leave the page up forever,
   * and leave the reader to do the subtraction. That subtraction is exactly
   * what software should be doing on their behalf.
   */
  if (deadlineHasPassed(deadlineRaw)) return null;

  const resolved: Record<string, string | null> = {
    deadline_raw: deadlineRaw,
    funding_level: fundingLevel,
    eligibility,
    provider,
  };

  // A field is missing when nothing usable was found for it, whether the label
  // was absent, the labelled value failed its shape check, or the scan came up
  // empty. What matters to a reader is that the page did not state it.
  const missing = Object.keys(resolved).filter((path) => resolved[path] === null);

  /*
   * Requiring a scannable date or amount threw away real opportunities.
   *
   * Plenty of genuine funding pages state neither in a form any scanner can
   * reach: the money is in a PDF, the date is in an image, or both are three
   * clicks away behind "Apply". Insisting on one of them meant a search of the
   * whole web returned a single result, which is not a filter doing its job,
   * it is a filter set too tight.
   *
   * A page that names itself a fellowship or a scholarship and offers a way to
   * apply is an opportunity, whether or not it makes the details easy to read.
   * It comes through with those fields honestly empty, which is what the record
   * already says out loud, rather than being dropped for the sin of being
   * badly laid out.
   */
  const namesAnOpportunity =
    // Hackathons were missing from this list entirely, so every one of them
    // failed the test for being an opportunity at all. A page called
    // "Innovation Challenge 2026" matched none of these words and was dropped.
    /\b(fellowship|scholarship|internship|grant|programme|program|bursary|award|hackathon|challenge|competition|datathon|ideathon)\b/i.test(
      title,
    );
  const offersAWayIn = /\[[^\]]*\b(apply|application|register|submit)\b[^\]]*\]\(/i.test(markdown);

  if (deadlineRaw === null && fundingLevel === null && !(namesAnOpportunity && offersAWayIn)) {
    return null;
  }

  return {
    sourceUrl: candidate.url,
    host: candidate.host,
    title,
    provider: provider ?? candidate.host,
    type: inferType(title, type, candidate.url),
    summary: candidate.description,
    deadlineRaw,
    fundingLevel,
    eligibility,
    official: candidate.official,
    foundVia: candidate.query,
    missing,
    sensorCount: 1,
    readAt: new Date().toISOString(),
  };
}
