import { normalizeMoney } from '../shared/index.js';
import { getPath } from '../contracts/paths.js';
import { buildFeed } from './feed.js';
import type { Store } from '../store/index.js';

/**
 * A downstream consumer of the verified feed.
 *
 * This exists to answer a question the rest of the system cannot: so what?
 * Detection, classification and gating are all invisible until something acts
 * on the data and gets it wrong.
 *
 * The consumer deliberately runs twice over the same collectors. Once on the
 * raw latest rows, the way an ordinary pipeline would, and once on the verified
 * feed. When those two disagree, the difference is the value of the whole
 * project, stated as a decision rather than as a status.
 */

export interface DealCandidate {
  collectorId: string;
  collectorName: string;
  url: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  /** Present only on the verified side. */
  health?: string;
  stale?: boolean;
}

export interface DealComparison {
  /** What an ordinary pipeline would conclude from the latest rows. */
  unguarded: { pick: DealCandidate | null; considered: DealCandidate[] };
  /** What NOTICE's verified feed supports. */
  verified: { pick: DealCandidate | null; considered: DealCandidate[] };
  /** True when the two disagree about the answer. */
  diverged: boolean;
  /**
   * Plain-language account of the difference, for the UI and the demo.
   * Empty when the two agree, which is the normal and boring case.
   */
  explanation: string[];
}

const priceField = 'price';
const titleField = 'title';

function toCandidate(
  collectorId: string,
  collectorName: string,
  url: string,
  row: unknown,
): DealCandidate | null {
  if (row === null || typeof row !== 'object') return null;

  const priceLookup = getPath(row, priceField);
  const money = priceLookup.found ? normalizeMoney(priceLookup.value) : null;
  const titleLookup = getPath(row, titleField);

  return {
    collectorId,
    collectorName,
    url,
    title: titleLookup.found && typeof titleLookup.value === 'string' ? titleLookup.value : null,
    price: money?.value ?? null,
    currency: money?.currency ?? null,
  };
}

function lowestNumber(candidates: readonly DealCandidate[]): DealCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) =>
    (candidate.price ?? Infinity) < (best.price ?? Infinity) ? candidate : best,
  );
}

function priced(candidates: readonly DealCandidate[]): DealCandidate[] {
  return candidates.filter((candidate) => candidate.price !== null && candidate.price > 0);
}

/**
 * What an ordinary pipeline does: sort by the number and take the smallest.
 *
 * Currency is a string sitting next to the number, and nothing here reads it.
 * That is not a strawman. Ranking `price` across rows is the obvious query, and
 * it silently answers that 25 USD beats 51.77 GBP, which is not a fact about
 * either product. This is the behaviour the verified side has to improve on.
 */
function cheapestNaive(candidates: readonly DealCandidate[]): DealCandidate | null {
  return lowestNumber(priced(candidates));
}

/**
 * Rank only within a single currency, and refuse otherwise.
 *
 * `incomparable` is already a first-class outcome when two sensors are held
 * against each other, and the same rule has to apply here: two prices in
 * different currencies cannot be ordered without a rate, and this system does
 * not have one. Converting with a guessed rate would be inventing the fact the
 * whole project exists to prevent.
 *
 * So a mixed set produces no recommendation and names why, rather than
 * returning whichever number happened to be smaller.
 */
function cheapestComparable(candidates: readonly DealCandidate[]): {
  pick: DealCandidate | null;
  currencies: string[];
} {
  const usable = priced(candidates);
  const currencies = [...new Set(usable.map((candidate) => candidate.currency ?? 'unknown'))];
  if (currencies.length > 1) return { pick: null, currencies };
  return { pick: lowestNumber(usable), currencies };
}

/**
 * Answer "which watched item is the best price right now?" twice over.
 *
 * @param store Persistence, read-only here.
 */
export async function compareBestDeal(store: Store): Promise<DealComparison> {
  const collectors = await store.listCollectors();

  const unguarded: DealCandidate[] = [];
  const verified: DealCandidate[] = [];

  for (const collector of collectors) {
    for (const url of collector.watchUrls) {
      // The unguarded view: whatever the collector last returned, taken at
      // face value. This is what a normal pipeline stores and queries.
      const runs = await store.listRuns(collector.id, 1);
      const latestRow = runs[0]?.rows[0] ?? null;
      const raw = toCandidate(collector.id, collector.name, url, latestRow);
      if (raw !== null) unguarded.push(raw);

      // The verified view: only data NOTICE is willing to stand behind, with
      // its health state attached.
      const envelope = await buildFeed(store, collector.id, url);
      const safe = toCandidate(collector.id, collector.name, url, envelope.data);
      if (safe !== null) {
        verified.push({
          ...safe,
          health: envelope.health.status,
          stale: envelope.health.stale,
        });
      }
    }
  }

  const unguardedPick = cheapestNaive(unguarded);
  const { pick: verifiedPick, currencies } = cheapestComparable(verified);
  const mixedCurrencies = currencies.length > 1;

  const explanation: string[] = [];
  const diverged =
    unguardedPick?.url !== verifiedPick?.url ||
    unguardedPick?.price !== verifiedPick?.price;

  if (diverged) {
    if (unguardedPick !== null) {
      explanation.push(
        `An unguarded pipeline would recommend "${unguardedPick.title ?? unguardedPick.url}" at ${String(unguardedPick.price)} ${unguardedPick.currency ?? ''}.`.trim(),
      );
    }
    if (mixedCurrencies) {
      explanation.push(
        `The remaining candidates are priced in ${currencies.join(' and ')}, which cannot be ranked without an exchange rate this system does not have.`,
      );
      explanation.push(
        'NOTICE recommends nothing rather than answering that one currency is cheaper than another.',
      );
    } else if (verifiedPick === null) {
      explanation.push(
        'NOTICE has no verified price it is willing to stand behind, so it recommends nothing rather than guessing.',
      );
    } else {
      explanation.push(
        `NOTICE recommends "${verifiedPick.title ?? verifiedPick.url}" at ${String(verifiedPick.price)} ${verifiedPick.currency ?? ''}.`.trim(),
      );
      if (verifiedPick.stale === true) {
        explanation.push(
          'That figure is the last verified value and is marked stale, because the newest observation could not be trusted.',
        );
      }
    }
    explanation.push(
      'The difference is a row that looked valid, was not, and was quarantined before it could reach this decision.',
    );
  }

  return {
    unguarded: { pick: unguardedPick, considered: unguarded },
    verified: { pick: verifiedPick, considered: verified },
    diverged,
    explanation,
  };
}
