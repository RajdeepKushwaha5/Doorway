import type { CollectorSummary, Incident, RunRecord } from '@/lib/types';
import { buildPoints, countOutcomes, TONE, type Point } from '@/lib/trust';

/**
 * What this collector has actually reported, and what happened to each value.
 *
 * The runs were already stored and already listed, one row per observation,
 * which answers "did it run" and nothing else. The question an operator has
 * about a source is different: has this number been trustworthy, and if it
 * stopped being so, when.
 *
 * A line of the reported value with each point coloured by verdict answers
 * both at once. The moment a collector starts reading a refundable deposit
 * instead of a price, the line drops and the point turns red, and the red
 * says the value never left the building. That is the entire argument of this
 * project drawn from stored records, with no summary statistic in between.
 *
 * There is deliberately no trust score. A single number between zero and one
 * would be an opinion presented as a measurement, and this project's whole
 * position is that a plausible number can be wrong.
 */

function Sparkline({ points, field }: { points: Point[]; field: string }) {
  const values = points.map((point) => point.value).filter((value): value is number => value !== null);
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero and, drawn against its own range, would
  // exaggerate rounding noise into a mountain. Held to the middle instead.
  const span = max - min === 0 ? 1 : max - min;

  const width = 720;
  const height = 150;
  const padX = 12;
  const padY = 14;
  const step = points.length === 1 ? 0 : (width - padX * 2) / (points.length - 1);

  const at = (point: Point, index: number): { x: number; y: number } | null => {
    if (point.value === null) return null;
    return {
      x: padX + step * index,
      y: max - min === 0
        ? height / 2
        : height - padY - ((point.value - min) / span) * (height - padY * 2),
    };
  };

  // Only consecutive readings are joined. A run where the field was missing
  // leaves a gap rather than a straight line across it, because a drawn line
  // through absent data is an invented measurement.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    const position = at(point, index);
    if (position === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${String(Math.round(position.x))},${String(Math.round(position.y))}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  return (
    /* Capped, and the scale sits against the plot rather than at the far
       edges of whatever width the page happens to be. */
    <div className="max-w-3xl overflow-x-auto rounded-lg border border-surface-border bg-surface-soft p-4">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        className="h-[150px] w-full min-w-[420px]"
        role="img"
        aria-label={`${field} over the last ${String(points.length)} observations`}
      >
        {segments.map((segment) => (
          <polyline
            key={segment.slice(0, 24)}
            points={segment}
            fill="none"
            stroke="#B8B8B0"
            strokeWidth="1.5"
          />
        ))}
        {points.map((point, index) => {
          const position = at(point, index);
          if (position === null) return null;
          return (
            <circle
              key={point.runId}
              cx={position.x}
              cy={position.y}
              r={point.outcome === 'published' ? 3.5 : 5}
              fill={TONE[point.outcome].dot}
            >
              <title>
                {`${point.at.replace('T', ' ').slice(0, 16)} · ${field} ${String(point.value)} · ${
                  TONE[point.outcome].label
                }`}
              </title>
            </circle>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 border-t border-surface-border pt-2 font-mono text-[11px] text-muted">
        <span>
          <span className="text-ivory">{field}</span> over {points.length} observation
          {points.length === 1 ? '' : 's'}
        </span>
        <span>
          low <span className="text-ivory">{String(min)}</span> · high{' '}
          <span className="text-ivory">{String(max)}</span>
        </span>
      </div>
    </div>
  );
}

export function TrustHistory({
  collector,
  runs,
  incidents,
}: {
  collector: CollectorSummary;
  runs: RunRecord[];
  incidents: Incident[];
}) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted">
        No observations yet. History begins at the first run, not at registration.
      </p>
    );
  }

  const { points, field } = buildPoints(collector, runs, incidents);
  const counts = countOutcomes(points);

  return (
    <div className="space-y-4">
      {field === null ? (
        <p className="text-sm text-muted">
          No declared field on this collector resolves to a number, so there is nothing to plot.
          The verdict strip below still carries the history.
        </p>
      ) : (
        <Sparkline points={points} field={field} />
      )}

      {/* One cell per observation. Reading it left to right is the fastest
          answer to "when did this source stop being trustworthy". */}
      <div className="flex flex-wrap gap-1">
        {points.map((point) => {
          const cell = (
            <span
              className="block h-6 w-6 border border-surface-border"
              style={{ backgroundColor: TONE[point.outcome].dot }}
              title={`${point.at.replace('T', ' ').slice(0, 16)} · ${TONE[point.outcome].label}`}
            />
          );
          return point.incidentId === null ? (
            <span key={point.runId}>{cell}</span>
          ) : (
            <a key={point.runId} href={`/incidents/${point.incidentId}`}>
              {cell}
            </a>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs">
        {(Object.keys(TONE) as (keyof typeof TONE)[]).map((outcome) => (
          <span key={outcome} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5"
              style={{ backgroundColor: TONE[outcome].dot }}
            />
            <span className={TONE[outcome].text}>
              {counts[outcome]} {TONE[outcome].label}
            </span>
          </span>
        ))}
      </div>

      <p className="text-xs leading-5 text-muted">
        {counts.withheld === 0
          ? 'Every observation of this source has been confirmed by a second sensor before publication.'
          : `${String(counts.withheld)} of ${String(points.length)} observations were withheld rather than published. The line above is what the collector reported; the red points are the values that never reached a consumer.`}
      </p>
    </div>
  );
}
