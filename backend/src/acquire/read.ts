import { fetchPageSource, fetchWitnessMarkdown } from '../brightdata/unlocker.js';
import { extractFields } from '../witness/extract.js';
import type { WitnessFieldSpec } from '../witness/spec.js';
import type { ApplicationStatus, OpportunityType } from '../doorway/types.js';
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
import { deadlineHasPassed, parseDeadline } from './dates.js';
import { decideLifecycle } from '../doorway/lifecycle.js';
import { hasStructuredFacts, readStructured, type StructuredFacts } from './structured.js';
import { adjudicateStructured } from './adjudicate.js';

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

/**
 * How far a discovered record has been corroborated.
 *
 * `text_only` is what discovery has always produced: one reading, of the
 * visible words, once.
 *
 * `confirmed` means the page's own structured data said the same thing. That is
 * a genuinely independent reading, authored separately from the visible text
 * and extracted by different code, and it is the same kind of corroboration the
 * witness provides for a watched collector.
 *
 * `conflicting` means the two disagree, which is the most important of the
 * three. A page whose visible deadline and embedded deadline differ is a page
 * nobody should plan around without opening it, and saying so is worth more
 * than silently preferring one.
 */
export type DraftCorroboration = 'text_only' | 'confirmed' | 'conflicting';

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
  /** How many independent reads back this: one for text, two once confirmed. */
  sensorCount: 1 | 2;
  /** What the page's own structured data had to say about it. */
  corroboration: DraftCorroboration;
  /** The date the page declared in machine-readable form, when it declared one. */
  structuredDeadline: string | null;
  /**
   * The engine's verdict on the two readings, when there were two.
   *
   * One of the same six a watched source can receive, produced by the same
   * classifier, so "the two sensors disagreed" means one thing across the
   * product rather than two similar-sounding things.
   */
  verdict?: string;
  /** The engine's evidence sentences, in the words a watched incident uses. */
  verdictEvidence?: string[];
  /** Whether somebody can still submit, kept separate from date confidence. */
  applicationStatus?: ApplicationStatus;
  /** Plain-language evidence for the lifecycle classification. */
  statusReason?: string | null;
  readAt: string;
}

/**
 * Whether somebody can still apply, decided in the one place that decides it.
 *
 * This carried its own copy of the rules until three copies existed across the
 * discovery, watched-source and index paths. They did not have to disagree to
 * be a problem: the two date parsers that cost most of the deadlines in the
 * index were both correct when written, and one was improved while the other
 * was not.
 */
function applicationLifecycle(
  markdown: string,
  deadlineRaw: string | null,
): { applicationStatus: ApplicationStatus; statusReason: string | null } {
  const verdict = decideLifecycle({ pageText: markdown, deadlineRaw });
  return { applicationStatus: verdict.status, statusReason: verdict.reason };
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
  // "144 Machine learning intern jobs in India" is a job board's result count.
  // A crawl reaches these constantly, and a result count is never one
  // opportunity however many opportunities it happens to be counting.
  // The count is often written with separators: "2,431 AI internships".
  /^\s*\d[\d,.]{1,8}\s+\S+.*\b(?:jobs?|internships?|vacancies|openings|opportunities|results?)\b/i,
  /\b(?:current|latest|all)\s+(?:vacancies|openings|jobs|opportunities)\b/i,
  /^\s*register for an upcoming hackathon\b/i,
  /^\s*upcoming hackathons?\b/i,
];

/**
 * Whether a page is one opportunity or a list of them.
 *
 * A list page extracts beautifully and means nothing: the deadline it yields
 * belongs to whichever entry happened to be first. Serving that to a student
 * is exactly the confident wrong answer this project exists to prevent, so
 * these are dropped rather than published with a caveat.
 */
/**
 * Page furniture that a crawler will happily read as a title.
 *
 * These came back from a live crawl as opportunities: "Online", "On-Campus",
 * "Degree Programs", and an unsupported-browser banner. None is a list page,
 * so the index detector had no reason to object, and each was served to a
 * student as something they could apply for.
 */
const CHROME = [
  /\byou seem to be using\b/i,
  /\bunsupported browser\b/i,
  /\benable javascript\b/i,
  /\bcookies?\b.*\b(policy|consent|settings|accept)\b/i,
  /\baccept (all )?cookies\b/i,
  /\bskip to (main )?content\b/i,
  /\bprivacy (policy|notice)\b/i,
  /\bterms (of|and)\b/i,
  /^\s*(home|menu|search|login|log in|sign in|register|apply|back|next|previous|share)\s*$/i,
  /^\s*(online|on-?campus|full-?time|part-?time|undergraduate|postgraduate|degree programs?|programmes?)\s*$/i,
];

/** Words that make a short title specific enough to be an opportunity. */
const NAMES_AN_OPPORTUNITY =
  /\b(scholarship|fellowship|internship|grant|bursary|hackathon|award|prize|traineeship|residency|stipend|studentship|chair)s?\b/i;

/**
 * Whether a title names an opportunity at all.
 *
 * Separate from the index check because these fail differently. An index page
 * is a real page about many opportunities; this is a fragment of furniture
 * that was never about anything. Both end up served to a student as something
 * to apply for, and the second is more embarrassing because it is obviously
 * not one to any reader.
 *
 * The specificity rule is deliberately mild: three words, or one word that
 * names the kind of thing. "Chevening Scholarships" passes on the second,
 * "AI for Good Fellowship Program" on both, "Degree Programs" on neither.
 */
export function looksLikePageFurniture(title: string): boolean {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean === '') return true;
  if (CHROME.some((pattern) => pattern.test(clean))) return true;

  const words = clean.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word));
  return words.length < 3 && !NAMES_AN_OPPORTUNITY.test(clean);
}

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

function publisherName(host: string, markdown: string): string {
  const lower = host.toLowerCase();
  if (lower.includes('wemakedevs.org')) {
    return /\bwith Bright Data\b/i.test(markdown) ? 'WeMakeDevs and Bright Data' : 'WeMakeDevs';
  }
  if (lower.includes('hackindia.org')) return 'HackIndia';
  if (lower.includes('devpost.com')) return 'Devpost';
  return host;
}

/** Platform chrome is never the organiser of a listing hosted on the platform. */
function platformPublisher(host: string, markdown: string): string | null {
  const lower = host.toLowerCase();
  if (lower.includes('wemakedevs.org')) return publisherName(host, markdown);
  if (lower.includes('hackindia.org')) return 'HackIndia';
  if (lower.includes('devpost.com')) return 'Devpost';
  return null;
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
  // "Intern" as well as "internship": a listing calling itself an intern role
  // never uses the longer word, and was falling through to whatever the query
  // happened to guess.
  if (/\bintern(?:s|ship|ships)?\b/.test(lower) || /\btrainee\b/.test(lower)) return 'internship';
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

  return readMarkdown(markdown, candidate, type);
}

/**
 * Judge a page that has already been fetched.
 *
 * Split out from the fetch so the crawler can reuse every rule in here. It
 * fetches in bulk and mines each page for links before deciding what the page
 * is, so it arrives holding markdown rather than a URL. Two copies of this
 * judgement would be two things to keep correct and one of them would rot.
 */
export function readMarkdown(
  markdown: string,
  candidate: SerpResult,
  type: OpportunityType = 'scholarship',
): OpportunityDraft | null {
  if (markdown.trim().length < 400) return null;

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
  const lifecycle = applicationLifecycle(markdown, deadlineRaw);

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
    /*
     * The vocabulary has to be the one listings use, not the one the form uses.
     *
     * Hackathons were missing entirely, so "Innovation Challenge 2026" was
     * dropped. Then internships: real postings say "Intern", never
     * "internship", so "Founder's Office - Intern at Cityfurnish" matched
     * nothing and a search for internships returned an empty page.
     *
     * Both times the search found the right listings and this line threw them
     * away, which is the worst place for the mistake to be: invisible from
     * outside, and indistinguishable from the web not having anything.
     */
    /\b(fellow|fellowship|scholar|scholarship|intern|interns|internship|trainee|traineeship|apprentice|apprenticeship|residency|co-?op|grant|programme|program|bursary|award|hackathon|challenge|competition|datathon|ideathon)\b/i.test(
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
    provider: platformPublisher(candidate.host, markdown) ?? provider ?? publisherName(candidate.host, markdown),
    type: inferType(title, type, candidate.url),
    summary: candidate.description,
    deadlineRaw,
    fundingLevel,
    eligibility,
    official: candidate.official,
    foundVia: candidate.query,
    missing,
    sensorCount: 1,
    corroboration: 'text_only',
    structuredDeadline: null,
    ...lifecycle,
    readAt: new Date().toISOString(),
  };
}

/**
 * Ask the page's own structured data whether the words were right.
 *
 * Two things at once, and the second is the reason to bother.
 *
 * It fills in a deadline the visible text did not yield. Publishers embed
 * schema.org markup because search engines reward it, so a page whose date is
 * behind a tab, in an image, or written in a format no scanner handles will
 * still frequently declare `"registrationDeadline": "2026-07-15"` in its
 * source.
 *
 * And it corroborates one that was. The structured reading is independent in
 * the way that matters: a different representation of the page, authored
 * separately from the visible text, extracted by different code. Agreement
 * between them is the same kind of evidence the witness gives a watched
 * collector, and it lets a discovered record honestly claim more than "we read
 * this once".
 *
 * Disagreement is not resolved. A page whose visible deadline and embedded
 * deadline differ is a page nobody should plan around without opening it, and
 * the record says so rather than quietly preferring whichever is prettier.
 */
export async function corroborate(
  config: ReadConfig,
  draft: OpportunityDraft,
  signal?: AbortSignal,
): Promise<OpportunityDraft> {
  let html: string;
  try {
    const fetched = await fetchPageSource(
      {
        apiKey: config.apiKey,
        zone: config.zone,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.country === undefined ? {} : { country: config.country }),
      },
      draft.sourceUrl,
      signal,
    );
    html = fetched.html;
  } catch {
    // A failed second read leaves the first exactly as it was. It is a bonus,
    // never a requirement.
    return draft;
  }

  return reconcileStructured(draft, readStructured(html));
}

/**
 * Set one reading against the other.
 *
 * Split from the fetch so the judgement can be tested without the network,
 * which is the same reason `readMarkdown` is separate from `readCandidate`.
 * This is the part worth being sure about: it decides whether a record claims
 * one sensor or two.
 */
export function reconcileStructured(
  draft: OpportunityDraft,
  facts: StructuredFacts,
): OpportunityDraft {
  if (!hasStructuredFacts(facts)) return draft;

  // A date the page declared but never showed in words. Still one reading:
  // nothing corroborated it, it simply came from somewhere the words were not.
  if (draft.deadlineRaw === null && facts.deadline !== null) {
    const closed = deadlineHasPassed(facts.deadline);
    return {
      ...draft,
      deadlineRaw: facts.deadline,
      structuredDeadline: facts.deadline,
      corroboration: 'text_only',
      missing: draft.missing.filter((field) => field !== 'deadline_raw'),
      applicationStatus: closed ? 'closed' : 'open',
      statusReason: closed
        ? 'The machine-readable deadline on the official page has passed.'
        : 'The machine-readable deadline on the official page has not passed.',
    };
  }

  if (draft.deadlineRaw === null || facts.deadline === null) {
    return { ...draft, structuredDeadline: facts.deadline };
  }

  /*
   * The engine decides, not a second opinion about the engine.
   *
   * This compared the two readings itself, which worked and meant the product
   * held two verification systems wearing the same words: a watched source
   * saying "two sensors" had been through reconciliation and a six-way
   * classification, a discovered one saying it had been through a few lines
   * written separately. Nobody reading either sentence could tell which they
   * were being told, and that distinction is the entire product.
   *
   * `adjudicateStructured` hands both readings to the same `reconcile` and
   * `classify` a watched collector goes through, so agreement means one thing
   * everywhere.
   */
  const adjudication = adjudicateStructured(
    { deadlineRaw: draft.deadlineRaw },
    facts,
    draft.sourceUrl,
    draft.readAt,
  );

  if (adjudication === null) return { ...draft, structuredDeadline: facts.deadline };

  return {
    ...draft,
    structuredDeadline: facts.deadline,
    corroboration: adjudication.corroborated ? 'confirmed' : 'conflicting',
    sensorCount: adjudication.corroborated ? 2 : 1,
    // The engine's own verdict and sentences, so a discovered record can be
    // shown the same evidence a watched incident shows.
    verdict: adjudication.verdict,
    verdictEvidence: adjudication.evidence,
  };
}
