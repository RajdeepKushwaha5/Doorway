import type { CollectorSummary, Incident, RunRecord } from './types';

/**
 * Turning stored runs into a history worth looking at.
 *
 * Separated from the component that draws it so the parts that can be wrong
 * can be tested. Reading a dotted path out of an arbitrary row, unwrapping the
 * normalized money shape, and deciding what happened to a value are all
 * decisions with a right answer; the SVG around them is not.
 */

export type Outcome = 'published' | 'withheld' | 'source_changed' | 'quarantined';

export interface Point {
  runId: string;
  at: string;
  value: number | null;
  outcome: Outcome;
  incidentId: string | null;
}

export const TONE: Record<Outcome, { dot: string; text: string; label: string }> = {
  published: { dot: '#16794A', text: 'text-verified', label: 'published' },
  withheld: { dot: '#B4231F', text: 'text-blocked', label: 'withheld' },
  source_changed: { dot: '#2563EB', text: 'text-parse-info', label: 'source changed' },
  quarantined: { dot: '#B45309', text: 'text-suspect', label: 'held back' },
};

export function outcomeOf(incident: Incident | undefined): Outcome {
  if (incident === undefined || incident.classification === 'healthy') return 'published';
  if (incident.classification === 'genuine_source_change') return 'source_changed';
  if (incident.classification === 'extractor_drift' || incident.classification === 'explicit_failure') {
    return 'withheld';
  }
  return 'quarantined';
}

/** Read a dotted path, unwrapping the normalized money shape on the way out. */
export function numberAt(row: unknown, path: string): number | null {
  let cursor: unknown = row;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (typeof cursor === 'number') return Number.isFinite(cursor) ? cursor : null;
  if (cursor !== null && typeof cursor === 'object') {
    const inner = (cursor as Record<string, unknown>)['value'];
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  }
  return null;
}

/**
 * Pick the field worth drawing.
 *
 * The first declared witness spec that resolves to a number on any run. Chosen
 * from the specs rather than by scanning the rows because the specs are what
 * somebody said this collector is for, and a chart of an incidental numeric
 * field would be a chart of the wrong thing.
 */
export function chartableField(collector: CollectorSummary, runs: RunRecord[]): string | null {
  for (const spec of collector.witnessSpecs ?? []) {
    if (runs.some((run) => numberAt(run.rows[0] ?? null, spec.path) !== null)) return spec.path;
  }
  return null;
}


/**
 * One point per observation, oldest first.
 *
 * Runs arrive newest first from the store, and a history that reads right to
 * left is a history nobody reads.
 */
export function buildPoints(
  collector: CollectorSummary,
  runs: RunRecord[],
  incidents: Incident[],
): { points: Point[]; field: string | null } {
  const byRun = new Map(incidents.map((incident) => [incident.runId, incident]));
  const field = chartableField(collector, runs);

  const points = [...runs].reverse().map((run) => {
    const incident = byRun.get(run.id);
    return {
      runId: run.id,
      at: run.observedAt,
      value: field === null ? null : numberAt(run.rows[0] ?? null, field),
      outcome: outcomeOf(incident),
      incidentId: incident?.id ?? null,
    };
  });

  return { points, field };
}

/** How many observations ended each way. */
export function countOutcomes(points: Point[]): Record<Outcome, number> {
  return points.reduce<Record<Outcome, number>>(
    (total, point) => ({ ...total, [point.outcome]: total[point.outcome] + 1 }),
    { published: 0, withheld: 0, source_changed: 0, quarantined: 0 },
  );
}
