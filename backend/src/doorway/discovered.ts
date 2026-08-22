import { createHash } from 'node:crypto';
import type { OpportunityDraft } from '../acquire/index.js';
import { deadlineHasPassed, parseDeadline } from '../acquire/dates.js';
import { plausibleDeadline, scanForDeadline } from '../acquire/plausible.js';
import { looksLikeIndex } from '../acquire/read.js';
import type { Opportunity, OpportunityType } from './types.js';
import { decideLifecycle } from './lifecycle.js';

/**
 * Let a live find into the world, without letting it pretend to be verified.
 *
 * Discovery used to produce its own list, in its own section, below the world.
 * The world itself was built only from sources under continuous observation,
 * which is a handful, so a student whose interest was not among them arrived to
 * a nearly empty map and concluded nothing was happening. It looked like a
 * product with no data, when in fact it could have found them a dozen
 * fellowships in under a minute.
 *
 * The fix is not to promote live results to the standing of verified ones. It
 * is to let them into the same world and mark them for exactly what they are:
 * read once, moments ago, by one sensor, with nothing to check against. That
 * distinction is the product, and blurring it here to make the map look fuller
 * would be the one unforgivable change.
 */

const TYPES = new Set<OpportunityType>([
  'scholarship',
  'fellowship',
  'internship',
  'research-program',
  'grant',
  'hackathon',
]);

/**
 * Read a funding level off whatever the page said, without inventing one.
 *
 * "Fully funded" is a claim the page made. An amount with no coverage statement
 * is not: a stipend of a hundred thousand rupees may be the whole cost or a
 * fraction of it, and only the page knows. Unspecified is the honest answer far
 * more often than it is a failure of parsing.
 */
function fundingLevel(text: string | null): 'full' | 'partial' | 'unspecified' {
  if (text === null) return 'unspecified';
  const lower = text.toLowerCase();
  if (/\b(fully[- ]funded|full[- ]scholarship|full tuition|covers? (?:all|full)|tuition waiver)\b/.test(lower)) {
    return 'full';
  }
  if (/\b(partially funded|part[- ]funded|partial)\b/.test(lower)) return 'partial';
  return 'unspecified';
}

/** Pull an amount and currency out of a funding sentence, or admit neither. */
function money(text: string | null): { amount: number | null; currency: string | null } {
  if (text === null) return { amount: null, currency: null };

  const symbol = /(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d+)?)\s*(lakh|crore)?/i.exec(text);
  if (symbol !== null) {
    const raw = Number((symbol[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(raw)) return { amount: null, currency: 'INR' };
    const scale = symbol[2]?.toLowerCase() === 'lakh' ? 100_000 : symbol[2]?.toLowerCase() === 'crore' ? 10_000_000 : 1;
    return { amount: raw * scale, currency: 'INR' };
  }

  const dollars = /(?:\$|USD)\s?([\d,]+(?:\.\d+)?)\s*(k)?/i.exec(text);
  if (dollars !== null) {
    const raw = Number((dollars[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(raw)) return { amount: null, currency: 'USD' };
    return { amount: dollars[2] === undefined ? raw : raw * 1000, currency: 'USD' };
  }

  return { amount: null, currency: null };
}

/**
 * An ISO date, only when the page's wording leaves no room for doubt.
 *
 * A deadline the student can sort and filter by is worth having, and a deadline
 * this system guessed wrong is worse than none: the raw text is always kept
 * beside it so nobody has to trust the parse.
 */
function isoDeadline(raw: string | null): string | null {
  if (raw === null) return null;
  const at = parseDeadline(raw);
  return at === null ? null : new Date(at).toISOString().slice(0, 10);
}

/**
 * Turn one live find into an opportunity the world can render.
 *
 * `collectorId` is the host rather than a real collector, because no collector
 * exists for this page yet. That is the truthful answer to "where did this come
 * from", and it keeps the source count on the world honest.
 */
export function draftToOpportunity(draft: OpportunityDraft): Opportunity {
  const type = TYPES.has(draft.type) ? draft.type : 'scholarship';
  const { amount, currency } = money(draft.fundingLevel);
  const provider = platformProvider(draft.host, draft.provider);
  const missing = knownPlatformProvider(draft.host)
    ? draft.missing.filter((field) => field !== 'provider')
    : draft.missing;
  const sourceReportsComplete = /\b(?:complete|completed|event ended|applications? closed)\b/i.test(
    draft.summary,
  );
  const deadlineRaw =
    draft.deadlineRaw ??
    explicitDeadlineFromSummary(draft.summary) ??
    (sourceReportsComplete ? dateRangeFromSummary(draft.summary) : null) ??
    scanForDeadline(draft.summary);
  /*
   * Whether somebody can still apply, decided where every path decides it.
   *
   * The summary is passed as the prose to scan, and the reading that produced
   * this draft is passed as an upstream opinion, which is only trusted when it
   * is not "I cannot tell". One precedence, applied to whatever signals this
   * path happens to hold.
   */
  const { status: applicationStatus, reason: statusReason } = decideLifecycle({
    pageText: draft.summary,
    deadlineRaw,
    declared: draft.applicationStatus,
  });

  return {
    id: createHash('sha256').update(`discovered:${draft.sourceUrl}`).digest('hex').slice(0, 18),
    collectorId: `discovered:${draft.host}`,
    sourceUrl: draft.sourceUrl,
    title: cleanTitle(draft.title),
    provider,
    type,
    summary: draft.summary,
    eligibility: draft.eligibility === null ? [] : [draft.eligibility],
    interests: [],
    funding: {
      amount,
      currency,
      coverage: [],
      level: fundingLevel(draft.fundingLevel),
    },
    deadline: isoDeadline(deadlineRaw),
    deadlineRaw,
    applicationStatus,
    // The decision above already said why. Restating it here was a fourth copy
    // of the same reasoning, and the one most likely to drift, because nothing
    // would fail if it disagreed with the status beside it.
    statusReason,
    locations: [],
    remote: null,
    requiredDocuments: [],
    // The page itself is where you apply from when it named no separate form.
    applicationUrl: draft.sourceUrl,
    trust: {
      /*
       * Two readings of the same page, when the page corroborated itself.
       *
       * A discovered record is normally the weakest claim here: read once, by
       * one sensor, with no history. When the page's own structured data states
       * the same closing date the visible words did, that is a second
       * independent reading, authored separately and extracted by different
       * code, and the record has earned more than "we read this once".
       *
       * It is still not `verified`. That word is reserved for a source under
       * continuous observation with a learned history behind it, and a page
       * agreeing with itself is not the same as a page being watched.
       */
      status: 'discovered',
      confirmedBy: draft.corroboration === 'confirmed' ? 'two_sensors' : 'single_sensor',
      lastVerifiedAt: draft.readAt,
      incidentId: null,
      // Everything the page did not state, named rather than left to look like
      // an absence of interest.
      /*
       * A page that contradicts itself says so here.
       *
       * The visible text and the embedded data name different closing dates.
       * Neither is preferred, because there is no basis to prefer one, and a
       * student needs to open the page rather than be handed a coin flip.
       */
      fieldsDegraded:
        draft.corroboration === 'conflicting'
          ? [...new Set([...missing, 'deadline_raw'])]
          : missing,
    },
  };
}

/** Apply current page-quality rules to records written by an older parser. */
export function isPublishableDraft(draft: OpportunityDraft): boolean {
  return !looksLikeIndex(cleanTitle(draft.title), '', draft.sourceUrl);
}

function platformProvider(host: string, extracted: string): string {
  const lower = host.toLowerCase();
  if (lower.includes('wemakedevs.org')) return 'WeMakeDevs';
  if (lower.includes('hackindia.org')) return 'HackIndia';
  if (lower.includes('devpost.com')) return 'Devpost';
  if (/^(?:organization name|organisation name|provider|organizer|organiser|host)$/i.test(extracted.trim())) {
    return host.replace(/^www\./i, '');
  }
  return extracted;
}

function knownPlatformProvider(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower.includes('wemakedevs.org') ||
    lower.includes('hackindia.org') ||
    lower.includes('devpost.com')
  );
}

function cleanTitle(value: string): string {
  return value.replace(/^\\?#+\s*/, '').replace(/\s+/g, ' ').trim();
}

function explicitDeadlineFromSummary(summary: string): string | null {
  const match =
    /\b(?:registration|application|project|submission|round\s+\d+)\s+(?:&\s+round\s+\d+\s+)?(?:submission\s+)?deadline\s*:?\s*(.{1,100})/i.exec(
      summary,
    );
  const tail = match?.[1]?.split(/[·|]/, 1)[0]?.trim();
  if (tail === undefined) return null;
  return plausibleDeadline(tail);
}

function dateRangeFromSummary(summary: string): string | null {
  const repeatedMonth =
    /\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*[-–—]\s*([A-Za-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b/.exec(
      summary,
    );
  if (repeatedMonth !== null) {
    return `${repeatedMonth[1] ?? ''} ${repeatedMonth[2] ?? ''}, ${repeatedMonth[3] ?? ''}`.trim();
  }
  const range =
    /\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*[-–—]\s*\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}\b/.exec(
      summary,
    );
  return range?.[0] ?? null;
}
