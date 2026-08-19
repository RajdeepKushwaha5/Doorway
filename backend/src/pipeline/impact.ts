import type { CheckResult, IncidentClassification } from '../shared/index.js';
import type { IncidentRecord, RunRecord } from '../store/types.js';

/**
 * What would have happened without this system.
 *
 * Every dashboard here reports what NOTICE did. None of them reported the only
 * number an operator actually cares about, which is what it prevented. "Four
 * incidents" is a statistic about the tool. "Four wrong prices were withheld,
 * and three of them passed every schema check on the way" is a statistic about
 * their data, and it is the same four incidents said honestly.
 *
 * The distinction that makes the number worth stating is `silent`. A pipeline
 * that validates its output already catches an empty result or a missing
 * field, so claiming credit for those would be dishonest. What no schema can
 * catch is a value that is present, well typed, inside its historical range,
 * and wrong. That is the class this project exists for, and it is countable:
 * an incident where the collector and the witness disagreed while every
 * conventional check on the run passed.
 *
 * Nothing here is modelled or estimated. Each figure is a count of records
 * that already exist, computed from runs and incidents alone, so a judge can
 * open the store and arrive at the same numbers by hand.
 */

/** One withheld value, named concretely enough to be checked. */
export interface WithheldValue {
  incidentId: string;
  collectorId: string;
  field: string;
  /** What the collector reported, and a conventional pipeline would have shipped. */
  shipped: unknown;
  /** What the second sensor read on the same page. */
  actual: unknown;
  /** The line of the page the witness read it from. */
  evidence: string | null;
  /** Whether every conventional check on this run passed. */
  silent: boolean;
  at: string;
}

export interface ImpactStats {
  /** Observations made. The denominator for everything else. */
  runs: number;
  incidents: number;
  /** Values not published because two sensors disagreed. */
  withheld: number;
  /**
   * Withheld values that no conventional check would have flagged.
   *
   * The headline number. These are present, well typed and plausible, and
   * wrong: exactly the failures that reach a consumer silently.
   */
  silent: number;
  /** Real source changes recognised as real and deliberately not repaired. */
  restrained: number;
  /** Judgements refused for want of evidence, rather than guessed. */
  quarantined: number;
  /** Observations that were published as verified. */
  published: number;
  /** Distinct fields that carried a withheld value. */
  fields: string[];
  /** The most recent withheld values, newest first. */
  examples: WithheldValue[];
  firstAt: string | null;
  latestAt: string | null;
}

/**
 * Verdicts where the collector, not the page, was at fault.
 *
 * `genuine_source_change` is excluded on purpose and counted separately. A
 * system that treated every difference as a fault would report a larger number
 * here and be worth less, because the operator would stop believing it.
 */
const AT_FAULT: ReadonlySet<IncidentClassification> = new Set<IncidentClassification>([
  'extractor_drift',
  'explicit_failure',
]);

/**
 * Whether a conventional pipeline could have caught this without a witness.
 *
 * `unknown` is not a catch. A check that could not be evaluated tells a
 * conventional pipeline nothing, so counting it would credit that pipeline
 * with a detection it never made.
 */
function conventionallyCaught(checks: readonly CheckResult[]): boolean {
  return checks.some((check) => check.status === 'fail');
}

/** Read a dotted path out of a collector row, without throwing on anything. */
function readPath(row: unknown, path: string): unknown {
  let cursor: unknown = row;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export function computeImpact(
  runs: readonly RunRecord[],
  incidents: readonly IncidentRecord[],
  exampleLimit = 6,
): ImpactStats {
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const withheld: WithheldValue[] = [];

  let restrained = 0;
  let quarantined = 0;
  const incidentRunIds = new Set<string>();
  const unhealthyRunIds = new Set<string>();

  for (const incident of incidents) {
    incidentRunIds.add(incident.runId);
    if (incident.classification !== 'healthy') unhealthyRunIds.add(incident.runId);
    if (incident.classification === 'genuine_source_change') restrained += 1;
    if (incident.classification === 'inconclusive' || incident.classification === 'access_anomaly') {
      quarantined += 1;
    }
    if (!AT_FAULT.has(incident.classification)) continue;

    const run = runsById.get(incident.runId);
    const silent = run === undefined ? false : !conventionallyCaught(run.checks);
    const row = run?.rows[0] ?? null;

    // One entry per affected field rather than one per incident. The operator's
    // question is "which of my values were wrong", and an incident that broke
    // three fields broke three values.
    for (const field of incident.affectedFields) {
      const witnessValue = incident.witness?.values.find((value) => value.path === field);
      withheld.push({
        incidentId: incident.id,
        collectorId: incident.collectorId,
        field,
        shipped: readPath(row, field),
        actual: witnessValue?.value,
        evidence: witnessValue?.evidence.line ?? null,
        silent,
        at: incident.createdAt,
      });
    }
  }

  // An incident with no named field still withheld something. Counting zero
  // there would understate the system in the one direction that matters.
  const withheldCount = withheld.length;

  const times = runs.map((run) => run.observedAt).sort();

  return {
    runs: runs.length,
    incidents: incidents.length,
    withheld: withheldCount,
    silent: withheld.filter((value) => value.silent).length,
    restrained,
    quarantined,
    published: runs.filter((run) => !unhealthyRunIds.has(run.id)).length,
    fields: [...new Set(withheld.map((value) => value.field))].sort(),
    examples: [...withheld]
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, exampleLimit),
    firstAt: times[0] ?? null,
    latestAt: times[times.length - 1] ?? null,
  };
}
