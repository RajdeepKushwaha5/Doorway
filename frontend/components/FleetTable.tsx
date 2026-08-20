import Link from 'next/link';
import type { CollectorSummary, Incident } from '@/lib/types';

/**
 * The way into the two screens that carry the actual evidence.
 *
 * Both the collector page and the incident page were fully built and reachable
 * only by typing a URL. Nothing anywhere in the interface linked to either, so
 * the strongest screen in the project, the one showing both readings, the line
 * the witness read them from, the sensor conditions and a downloadable
 * certificate, could only be found by someone who already knew it existed.
 *
 * Collector ids are regenerated on every boot of the free-tier host, so a
 * bookmarked link dies on the next restart and this list is the only durable
 * route to them.
 */

/** Colour and wording per verdict, matching the chips used elsewhere. */
const VERDICT: Record<string, { label: string; tone: string }> = {
  extractor_drift: { label: 'Extractor drifted', tone: 'text-blocked' },
  explicit_failure: { label: 'Returned nothing usable', tone: 'text-blocked' },
  genuine_source_change: { label: 'Source changed', tone: 'text-parse-info' },
  access_anomaly: { label: 'Sensors saw different pages', tone: 'text-suspect' },
  inconclusive: { label: 'Not enough evidence', tone: 'text-suspect' },
  healthy: { label: 'Verified', tone: 'text-verified' },
};

export function FleetTable({
  collectors,
  incidents,
}: {
  collectors: CollectorSummary[];
  incidents: Incident[];
}) {
  if (collectors.length === 0) return null;

  // Only the ones worth opening. A healthy observation is recorded as an
  // incident internally, and listing those buries the one that matters under
  // rows reading "Verified, no field isolated".
  const notable = incidents
    .filter((incident) => incident.classification !== 'healthy')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3 font-neuebit text-[12px] uppercase tracking-[0.2em] text-gray-400">
          ✦ The fleet
        </div>
        <ul className="divide-y divide-gray-200">
          {collectors.map((collector) => (
            <li key={collector.id}>
              <Link
                href={`/collectors/${collector.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-gray-50"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[13px] font-semibold text-gray-900">
                    {collector.name}
                  </span>
                  <span className="block truncate font-mono text-[11.5px] text-gray-500">
                    {collector.brightDataCollectorId} · {collector.watchUrls.length} page
                    {collector.watchUrls.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="flex items-center gap-3 font-mono text-[11.5px]">
                  {collector.openIncidents > 0 ? (
                    <span className="rounded border border-blocked/30 bg-red-50 px-2 py-0.5 text-blocked">
                      {collector.openIncidents} open
                    </span>
                  ) : (
                    <span className="text-verified">clear</span>
                  )}
                  <span aria-hidden className="text-gray-400">
                    →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="border-t border-gray-200 px-5 py-3 text-[12px] leading-relaxed text-gray-600">
          Open a collector for its trust history, the labels its witness reads by, and the runs
          waiting to be accepted as a baseline.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3 font-neuebit text-[12px] uppercase tracking-[0.2em] text-gray-400">
          ✦ Incidents worth reading
        </div>
        {notable.length === 0 ? (
          <p className="px-5 py-6 text-[12px] leading-relaxed text-gray-600">
            Nothing has disagreed yet. Break the page above and run the collector, and the incident
            will appear here with its evidence.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {notable.map((incident) => {
              const verdict = VERDICT[incident.classification] ?? {
                label: incident.classification,
                tone: 'text-gray-600',
              };
              return (
                <li key={incident.id}>
                  <Link
                    href={`/incidents/${incident.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-gray-50"
                  >
                    <span className="min-w-0">
                      <span className={`block font-mono text-[13px] font-semibold ${verdict.tone}`}>
                        {verdict.label}
                      </span>
                      <span className="block truncate font-mono text-[11.5px] text-gray-500">
                        {incident.affectedFields.length > 0
                          ? incident.affectedFields.join(', ')
                          : 'no field isolated'}
                        {incident.quarantined ? ' · withheld' : ''}
                      </span>
                    </span>
                    <span className="font-mono text-[11.5px] text-gray-400">
                      {incident.createdAt.replace('T', ' ').slice(0, 16)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-gray-200 px-5 py-3 text-[12px] leading-relaxed text-gray-600">
          Each one carries both readings, the line the witness read from, the conditions each sensor
          fetched under, and a certificate you can re-derive offline.
        </p>
      </div>
    </div>
  );
}
