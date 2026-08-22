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
} from './plausible.js';

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
  if (/\/(?:top|best|list)-|-list-|\/blog\/|\/articles?\//.test(slug)) return true;

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

/**
 * Take the page's own heading as the title when it has one.
 *
 * A search result title is written by the search engine and often carries the
 * site name, a separator and a truncation ellipsis. The page's first heading
 * is what the body offering the money actually called it.
 */
export function titleFrom(markdown: string, fallback: string): string {
  // Section headings, not the name of anything. A page whose first heading is
  // "Fellowship" has told the reader nothing they can recognise later.
  const GENERIC =
    /^(fellowship|scholarship|internship|grant|overview|about|home|apply|programme|program)s?$/i;

  for (const line of markdown.split(/\r?\n/).slice(0, 60)) {
    const heading = /^#{1,2}\s+(.{6,120})$/.exec(line.trim());
    const found = heading?.[1]?.trim();
    if (found === undefined) continue;
    if (GENERIC.test(found)) continue;
    // A heading that is a question belongs to an FAQ further down the page.
    if (found.endsWith('?')) continue;
    return found;
  }
  /*
   * Falling back to the search engine's title, cleaned.
   *
   * It arrives as "Fellowships | Wadhwani School of Data Science and
   * Artificial ...", which is the site name and a truncation glued to the real
   * name. Cut at the first pipe and drop the ellipsis: what is left is what
   * the page is called.
   */
  const [head = fallback] = fallback.split(/\s+[|–—]\s+/);
  return head.replace(/\s*\.{2,}\s*$/, '').trim();
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

  // A page with neither a deadline nor a funding line is almost certainly an
  // article about opportunities rather than one. Requiring at least one keeps
  // the results to things a student can act on.
  if (deadlineRaw === null && fundingLevel === null) return null;

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
