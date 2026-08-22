import { createHash } from 'node:crypto';
import type { OpportunityDraft } from '../acquire/index.js';
import type { Opportunity, OpportunityType } from './types.js';

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

  const named = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/.exec(raw);
  const usa = /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/.exec(raw);
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(raw);

  if (iso !== null) return `${iso[1] ?? ''}-${iso[2] ?? ''}-${iso[3] ?? ''}`;

  const parse = (day: string, month: string, year: string): string | null => {
    const at = Date.parse(`${day} ${month} ${year} UTC`);
    if (Number.isNaN(at)) return null;
    return new Date(at).toISOString().slice(0, 10);
  };

  if (named !== null) return parse(named[1] ?? '', named[2] ?? '', named[3] ?? '');
  if (usa !== null) return parse(usa[2] ?? '', usa[1] ?? '', usa[3] ?? '');
  return null;
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

  return {
    id: createHash('sha256').update(`discovered:${draft.sourceUrl}`).digest('hex').slice(0, 18),
    collectorId: `discovered:${draft.host}`,
    sourceUrl: draft.sourceUrl,
    title: draft.title,
    provider: draft.provider,
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
    deadline: isoDeadline(draft.deadlineRaw),
    deadlineRaw: draft.deadlineRaw,
    locations: [],
    remote: null,
    requiredDocuments: [],
    // The page itself is where you apply from when it named no separate form.
    applicationUrl: draft.sourceUrl,
    trust: {
      status: 'discovered',
      confirmedBy: 'single_sensor',
      lastVerifiedAt: draft.readAt,
      incidentId: null,
      // Everything the page did not state, named rather than left to look like
      // an absence of interest.
      fieldsDegraded: draft.missing,
    },
  };
}
