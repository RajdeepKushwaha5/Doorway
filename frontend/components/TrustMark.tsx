import type { TrustStatus } from '@/lib/types';

/**
 * The badge, and the legend that teaches it, defined together.
 *
 * The badge is the most important thing on a card. Everything else Doorway
 * shows is a fact about an opportunity; this is the fact about the facts, and
 * whether a reader can act on the rest depends on being able to read it.
 *
 * It used to carry its meaning in a `title` tooltip. That is invisible on every
 * touch device, invisible to anyone scanning, and invisible to a reader who
 * does not already suspect there is something to hover over. The one piece of
 * information the whole product exists to deliver was the one piece nobody
 * could see.
 *
 * So the legend is on the page instead, and it is built from the same table the
 * badges are. A word cannot be explained one way in the key and mean another on
 * the card, because there is only one table.
 */

/** Words a student already knows. "Proved", "checked" and "held" are ours. */
const LABELS: Record<TrustStatus, string> = {
  verified: 'Confirmed',
  partially_verified: 'Checked',
  stale: 'Not rechecked',
  quarantined: 'On hold',
  discovered: 'Just found',
};

/** What each one licenses the reader to do. Written as advice, not status. */
const MEANINGS: Record<TrustStatus, string> = {
  verified: 'Two independent readings agreed. Safe to plan around.',
  partially_verified: 'Passed the checks learned for this source, but read once.',
  stale: 'Confirmed before, not recently. Check the source first.',
  quarantined: 'The readings stopped agreeing. Last confirmed values shown.',
  discovered: 'Found on the live web just now, read once. Open the source first.',
};

/** The order a reader should meet them in: strongest evidence first. */
const ORDER: readonly TrustStatus[] = [
  'verified',
  'partially_verified',
  'discovered',
  'stale',
  'quarantined',
];

export function TrustMark({ status }: Readonly<{ status: TrustStatus }>) {
  return (
    <span className={`doorway-trust doorway-trust-${status}`}>{LABELS[status]}</span>
  );
}

/**
 * The key, showing only the states actually on screen.
 *
 * Listing all five when two are present is noise, and noise in a legend is
 * worse than in most places: it teaches a reader that the key is not worth
 * reading.
 */
export function TrustLegend({ present }: Readonly<{ present: readonly TrustStatus[] }>) {
  const shown = ORDER.filter((status) => present.includes(status));
  if (shown.length === 0) return null;

  return (
    <div className="mt-8 border border-gray-200 bg-[#f6f4ef]">
      <div className="border-b border-gray-200 px-4 py-2 font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-500">
        What the badges mean
      </div>
      <dl className="grid gap-px bg-gray-200 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((status) => (
          <div key={status} className="flex items-start gap-3 bg-white p-3">
            <dt className="shrink-0">
              <TrustMark status={status} />
            </dt>
            <dd className="font-mono text-[10.5px] leading-5 text-gray-600">{MEANINGS[status]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
