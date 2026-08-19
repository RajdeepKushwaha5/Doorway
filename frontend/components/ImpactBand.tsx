import { api } from '@/lib/api';
import type { ImpactStats, WithheldValue } from '@/lib/types';

/**
 * The only number an operator actually wants.
 *
 * Every other panel on this page reports what NOTICE did: runs made, incidents
 * opened, repairs gated. None of them answered the question the whole project
 * is an argument for, which is what would have happened otherwise. "Four
 * incidents" is a fact about the tool. "Four wrong values were withheld, and
 * three of them passed every schema check on the way through" is a fact about
 * the reader's data, and it is the same four incidents stated honestly.
 *
 * Nothing here is modelled. Each figure is a count of stored runs and
 * incidents, and every withheld value is shown with the line of the page it
 * was contradicted by, so the claim can be checked rather than believed.
 */

/**
 * Render a value as it would have arrived downstream, including its absence.
 *
 * The witness reports money normalized, as `{ value, currency }`, while the
 * collector's raw row carries whatever it read. Both appear side by side here,
 * so the normalized form is unwrapped rather than printed as JSON: a reader
 * comparing a wrong price to a right one should not have to parse an object to
 * do it. The currency is appended only when the source actually declared one,
 * because `$` belongs to more than twenty of them and guessing is the failure
 * mode this whole project argues against.
 */
function shown(value: unknown): string {
  if (value === undefined) return 'not read';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) {
      const currency = typeof record['currency'] === 'string' ? ` ${record['currency']}` : '';
      return `${String(record['value'])}${currency}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function Figure({
  value,
  label,
  note,
  tone,
}: {
  value: number;
  label: string;
  note: string;
  tone: string;
}) {
  return (
    <div className="border-t border-gray-200 pt-3">
      <div className={`font-mondwest text-[38px] leading-none ${tone}`}>{value}</div>
      <div className="mt-1.5 font-neuebit text-[11px] uppercase tracking-[0.18em] text-gray-500">
        {label}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-gray-600">{note}</p>
    </div>
  );
}

function WithheldRow({ value }: { value: WithheldValue }) {
  return (
    <div className="grid gap-2 border-t border-gray-200 px-4 py-3 text-[12px] sm:grid-cols-[110px_1fr_1fr] sm:gap-4">
      <div className="font-semibold text-gray-900">{value.field}</div>
      <div className="text-gray-600">
        <span className="text-gray-400">would have shipped </span>
        <span className="font-semibold text-blocked">{shown(value.shipped)}</span>
        <span className="text-gray-400"> · page said </span>
        <span className="font-semibold text-verified">{shown(value.actual)}</span>
      </div>
      <div className="min-w-0 truncate text-gray-500" title={value.evidence ?? ''}>
        {value.evidence ?? 'no witness line recorded'}
        {value.silent ? (
          <span className="ml-2 whitespace-nowrap rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gray-500">
            passed every check
          </span>
        ) : null}
      </div>
    </div>
  );
}

export async function ImpactBand() {
  let stats: ImpactStats;
  try {
    stats = await api.impact();
  } catch {
    // The backend being unreachable is not worth a broken page. Every other
    // panel here degrades quietly and so does this one.
    return null;
  }

  if (stats.runs === 0) return null;

  return (
    <section className="mt-12" data-reveal>
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div className="font-neuebit text-[12px] uppercase tracking-[0.2em] text-gray-400">
            ✦ What it prevented
          </div>
          <div className="font-mono text-[11px] text-gray-400">
            counted from {stats.runs} observation{stats.runs === 1 ? '' : 's'}
            {stats.latestAt === null ? '' : ` · latest ${stats.latestAt.slice(0, 10)}`}
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-6 px-5 py-6 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            value={stats.withheld}
            label="values withheld"
            note="Never published, because two independent sensors disagreed about the same page."
            tone="text-blocked"
          />
          <Figure
            value={stats.silent}
            label="that nothing else caught"
            note="Present, correctly typed, inside their historical range, and wrong. Every conventional check on those runs passed."
            tone="text-blocked"
          />
          <Figure
            value={stats.restrained}
            label="changes left alone"
            note="The page genuinely changed and the collector was right. Repairing these would have been the expensive mistake."
            tone="text-verified"
          />
          <Figure
            value={stats.published}
            label="observations published"
            note="Verified against a second sensor before anything downstream could read them."
            tone="text-verified"
          />
        </div>

        {stats.examples.length > 0 ? (
          <div className="border-t border-gray-200">
            <div className="px-5 pt-4 text-[12px] leading-relaxed text-gray-600">
              Each of these is a real record. The middle column is what a conventional pipeline
              would have handed to an application; the right column is the line of the page that
              contradicted it.
            </div>
            <div className="mt-3">
              {stats.examples.map((value) => (
                <WithheldRow key={`${value.incidentId}-${value.field}`} value={value} />
              ))}
            </div>
          </div>
        ) : (
          <div className="border-t border-gray-200 px-5 py-4 text-[12px] leading-relaxed text-gray-600">
            Nothing has been withheld yet on this deployment. That is the honest reading of an
            empty table, and it is why the number above is counted rather than asserted.
          </div>
        )}

        {stats.quarantined > 0 ? (
          <div className="border-t border-gray-200 px-5 py-3 text-[12px] leading-relaxed text-gray-500">
            A further {stats.quarantined} observation{stats.quarantined === 1 ? ' was' : 's were'}{' '}
            held back without a verdict, because the evidence did not support one. Refusing to
            judge is a result, not a gap.
          </div>
        ) : null}
      </div>
    </section>
  );
}
