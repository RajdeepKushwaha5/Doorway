import { normalizeMoney } from '../shared/index.js';
import { getPath } from '../contracts/paths.js';
import { buildFeed } from './feed.js';
import type { CollectorRecord, RunRecord, Store } from '../store/index.js';

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

/**
 * Which field carries the price, and which carries the name.
 *
 * These were hardcoded to `price` and `title`, so a collector whose fields are
 * named anything else rendered as two nulls. Books to Scrape publishes
 * `price_excl_tax` and `book_title`, and appeared on the comparison as a
 * source with no price and no name at all.
 *
 * Resolved from the collector's own declared witness specs, which are the only
 * place anybody has said what these fields mean. The names are a fallback for
 * a collector that declared nothing.
 */
function fieldsFor(collector: CollectorRecord): { price: string; title: string } {
  const paths = collector.witnessSpecs.map((spec) => spec.path);

  const price =
    collector.witnessSpecs.find((spec) => spec.kind === 'money')?.path ??
    paths.find((path) => /price|cost|amount/i.test(path)) ??
    'price';

  const title =
    paths.find((path) => /title|name|product/i.test(path)) ?? 'title';

  return { price, title };
}

/** The newest run that actually read this URL. */
function newestRowFor(runs: readonly RunRecord[], url: string): unknown {
  // A run that does not record which page it read cannot be attributed to one.
  // Skipped rather than matched loosely, because matching loosely is how every
  // URL ended up showing the same row.
  const match = runs.find((run) => run.targetUrls?.includes(url) === true);
  return match?.rows[0] ?? null;
}

function toCandidate(
  collector: CollectorRecord,
  url: string,
  row: unknown,
): DealCandidate | null {
  if (row === null || typeof row !== 'object') return null;

  // Resolved per collector rather than assumed, so a source that names its
  // fields anything other than `price` and `title` is not rendered as a pair
  // of nulls.
  const fields = fieldsFor(collector);

  const priceLookup = getPath(row, fields.price);
  const money = priceLookup.found
    ? normalizeMoney(priceLookup.value, collector.currency ?? undefined)
    : null;
  const titleLookup = getPath(row, fields.title);

  return {
    collectorId: collector.id,
    collectorName: collector.name,
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
    // Fetched once per collector, then matched per URL below.
    //
    // This used to call `listRuns(collector.id, 1)` inside the URL loop, which
    // returns the single newest run for the whole collector. A collector
    // watching three pages therefore showed the newest page's row against all
    // three, so the product page and both fixtures all displayed the same
    // number while their verified snapshots correctly differed. The comparison
    // that is supposed to demonstrate the value of verification was itself
    // built on a wrong pairing.
    const recentRuns = await store.listRuns(collector.id, 100);

    for (const url of collector.watchUrls) {
      // The unguarded view: whatever the collector last returned *for this
      // page*, taken at face value. This is what a normal pipeline stores.
      const latestRow = newestRowFor(recentRuns, url);
      const raw = toCandidate(collector, url, latestRow);
      if (raw !== null) unguarded.push(raw);

      // The verified view: only data NOTICE is willing to stand behind, with
      // its health state attached.
      const envelope = await buildFeed(store, collector.id, url);
      const safe = toCandidate(collector, url, envelope.data);
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
