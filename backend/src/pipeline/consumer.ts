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

/** Cheapest candidate with a usable price. */
function cheapest(candidates: readonly DealCandidate[]): DealCandidate | null {
  const priced = candidates.filter((candidate) => candidate.price !== null && candidate.price > 0);
  if (priced.length === 0) return null;
  return priced.reduce((best, candidate) =>
    (candidate.price ?? Infinity) < (best.price ?? Infinity) ? candidate : best,
  );
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

  const unguardedPick = cheapest(unguarded);
  const verifiedPick = cheapest(verified);

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
    if (verifiedPick === null) {
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
