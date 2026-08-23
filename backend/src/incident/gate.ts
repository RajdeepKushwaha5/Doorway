import { compareValues } from '../shared/index.js';
import { compareDates } from '../witness/compare.js';
import type { WitnessFieldSpec } from '../witness/spec.js';
import { getPath } from '../contracts/paths.js';
import { validateRun, type CollectorContract } from '../contracts/index.js';

/**
 * The approval gate.
 *
 * A green Self-Healing preview is not deployment evidence. Bright Data
 * previews against inputs of its own choosing, which need not include the page
 * that failed, so a candidate can look repaired and still be broken on the
 * incident that triggered it. Everything here exists to make "the repair
 * works" a checkable claim rather than a hope.
 */

/** A URL whose correct output was pinned when the collector was healthy. */
export interface GoldenCase {
  url: string;
  /** Expected values by dotted path. Only the pinned paths are compared. */
  expected: Readonly<Record<string, unknown>>;
  /** Why this case is in the corpus, shown in the matrix. */
  label: string;
}

/** Outcome of replaying the candidate against one case. */
export interface GateCaseResult {
  url: string;
  label: string;
  passed: boolean;
  /** Per-field detail, so a failure says which field and how. */
  fields: {
    path: string;
    expected: unknown;
    observed: unknown;
    agreed: boolean;
    note: string;
  }[];
  /** Set when the candidate could not be executed against this case at all. */
  executionError: string | null;
}

export interface GateInput {
  /** The page that caused the incident. Non-negotiable: it must pass. */
  incident: { url: string; expected: Readonly<Record<string, unknown>> };
  /** Previously working pages, to catch a repair that trades one break for another. */
  regression: readonly GoldenCase[];
  /** Rows the candidate produced, keyed by URL. */
  candidateRowsByUrl: ReadonlyMap<string, readonly unknown[]>;
  /**
   * A page served with the true value moved and a decoy left behind.
   *
   * Optional, because it needs a page whose markup we control, and most
   * sources are not that. Where it can be run it is the difference between
   * "the candidate returned the right value" and "the candidate read the right
   * element", and only the second one survives the next redesign.
   *
   * `expected` holds the token. `decoy` holds the value the candidate would
   * return if it were reading position rather than meaning, and is recorded so
   * a failure can say which mistake was made instead of only that one was.
   */
  anchor?: {
    url: string;
    expected: Readonly<Record<string, unknown>>;
    decoy: Readonly<Record<string, unknown>>;
  };
  /** Fields that must not change. A repair may not quietly drop them. */
  protectedFields: readonly string[];
  contract: CollectorContract;
  /**
   * How each field should be compared.
   *
   * Without these the gate compares every value the same way, and a date is
   * the one field where that is catastrophic. A collector writing
   * "2026-09-01T00:00:00.000Z" against a pinned "18 September 2026" was
   * normalised to the numbers 20260901000000000 and 182026 and reported as a
   * numeric mismatch. It rejected the right repair for the wrong reason, and
   * it would have rejected a correct one identically, which means a date fix
   * could never have been promoted at all.
   *
   * Optional so existing callers keep working; absent, comparison is exactly
   * as before.
   */
  specs?: readonly WitnessFieldSpec[];
}

export type GateDecision =
  | { approved: true; reasons: string[]; results: GateCaseResult[] }
  | { approved: false; reasons: string[]; results: GateCaseResult[] };

/** Replay one case and compare every pinned field. */
function evaluateCase(
  url: string,
  label: string,
  expected: Readonly<Record<string, unknown>>,
  rows: readonly unknown[] | undefined,
  specs: readonly WitnessFieldSpec[] = [],
): GateCaseResult {
  if (rows === undefined) {
    return {
      url,
      label,
      passed: false,
      fields: [],
      executionError: 'the candidate was never executed against this URL',
    };
  }

  const errorRow = rows.find(
    (row) => row !== null && typeof row === 'object' && 'error' in (row),
  );
  if (errorRow !== undefined) {
    return {
      url,
      label,
      passed: false,
      fields: [],
      executionError: String((errorRow as Record<string, unknown>)['error']),
    };
  }

  if (rows.length === 0) {
    return { url, label, passed: false, fields: [], executionError: 'candidate returned no rows' };
  }

  const row = rows[0];
  const fields = Object.entries(expected).map(([path, expectedValue]) => {
    const lookup = getPath(row, path);
    const observed = lookup.found ? lookup.value : null;
    // A date is a day, not a number. Two spellings of one day are one day,
    // and the gate has to know that before it can tell a working repair from
    // a broken one.
    const spec = specs.find((candidate) => candidate.path === path);
    const agreement =
      spec?.shape === 'date'
        ? compareDates(observed, expectedValue)
        : compareValues(observed, expectedValue);
    return {
      path,
      expected: expectedValue,
      observed,
      // `incomparable` is not a pass. A field the gate cannot verify has not
      // been shown to work, and letting it through is how an unverified repair
      // reaches production.
      agreed: agreement.kind === 'agree',
      note: agreement.note,
    };
  });

  return {
    url,
    label,
    passed: fields.every((field) => field.agreed),
    fields,
    executionError: null,
  };
}

/**
 * Decide whether a proposed repair may be promoted.
 *
 * Approval requires all of:
 *
 *  1. the incident page now produces the correct values;
 *  2. every regression case still produces its pinned values;
 *  3. no protected field went missing;
 *  4. the candidate output still satisfies the contract's hard invariants.
 *
 * Any one of those failing rejects the repair and leaves production untouched.
 */
export function evaluateGate(input: GateInput): GateDecision {
  const reasons: string[] = [];
  const results: GateCaseResult[] = [];

  const incidentResult = evaluateCase(
    input.incident.url,
    'incident',
    input.incident.expected,
    input.candidateRowsByUrl.get(input.incident.url),
    input.specs ?? [],
  );
  results.push(incidentResult);

  /*
   * The anchor case, when there is one.
   *
   * Run after the incident case and before the regression set, because a
   * candidate that reads the wrong element is not worth checking for
   * regressions: it has not been shown to work at all.
   */
  if (input.anchor !== undefined) {
    const anchorResult = evaluateCase(
      input.anchor.url,
      'anchor',
      input.anchor.expected,
      input.candidateRowsByUrl.get(input.anchor.url),
      input.specs ?? [],
    );
    results.push(anchorResult);

    if (!anchorResult.passed) {
      /*
       * Name the mistake rather than the symptom.
       *
       * A candidate that returned the decoy read a position. A candidate that
       * returned neither read something else entirely. Those are different
       * failures and an operator deciding what to do next needs to know which.
       */
      const followedDecoy = anchorResult.fields.some((field) => {
        const decoyValue = input.anchor?.decoy[field.path];
        return (
          decoyValue !== undefined &&
          compareValues(field.observed, decoyValue).kind === 'agree'
        );
      });
      reasons.push(
        followedDecoy
          ? 'the candidate returned the decoy on the anchor page, so it is reading a position rather than the labelled value'
          : 'the candidate did not return the anchor token, so it has not been shown to read the labelled value',
      );
    }
  }

  for (const golden of input.regression) {
    results.push(
      evaluateCase(
        golden.url,
        golden.label,
        golden.expected,
        input.candidateRowsByUrl.get(golden.url),
        input.specs ?? [],
      ),
    );
  }

  if (!incidentResult.passed) {
    reasons.push(
      incidentResult.executionError !== null
        ? `the incident page could not be verified: ${incidentResult.executionError}`
        : `the incident page still returns wrong values: ${incidentResult.fields
            .filter((field) => !field.agreed)
            .map((field) => `${field.path} ${field.note}`)
            .join('; ')}`,
    );
  }

  const regressions = results.slice(1).filter((result) => !result.passed);
  for (const failure of regressions) {
    reasons.push(
      failure.executionError !== null
        ? `regression case "${failure.label}" could not be executed: ${failure.executionError}`
        : `regression case "${failure.label}" broke: ${failure.fields
            .filter((field) => !field.agreed)
            .map((field) => field.path)
            .join(', ')}`,
    );
  }

  // Protected fields are read straight from the candidate rows, not from the
  // comparison results. An earlier version looked them up among the fields it
  // had already compared, so a protected field that was not part of `expected`
  // was simply absent from that list and silently passed. A repair could drop
  // it and still be approved.
  const casesToCheck: { label: string; url: string }[] = [
    { label: 'incident', url: input.incident.url },
    ...input.regression.map((golden) => ({ label: golden.label, url: golden.url })),
  ];

  for (const { label, url } of casesToCheck) {
    const rows = input.candidateRowsByUrl.get(url);
    if (rows === undefined || rows.length === 0) continue;
    const row = rows[0];

    for (const path of input.protectedFields) {
      const lookup = getPath(row, path);
      if (!lookup.found || lookup.value === null || lookup.value === '') {
        reasons.push(`protected field "${path}" is missing or empty on "${label}"`);
      }
    }
  }

  // The candidate's output must satisfy the whole contract, not only the
  // declared invariants. Restricting this to `invariant:` checks let a
  // candidate drop a required field or change a field's type and still pass,
  // because those are structural checks with different ids.
  for (const { label, url } of casesToCheck) {
    const rows = input.candidateRowsByUrl.get(url);
    if (rows === undefined || rows.length === 0) continue;

    for (const check of validateRun({ rows, contract: input.contract })) {
      if (check.status !== 'fail') continue;
      // Learned statistics are excluded on purpose: a repair that legitimately
      // returns a new value would trip them, and blocking on that would make
      // the gate refuse correct fixes.
      if (check.checkId.startsWith('learned:')) continue;
      reasons.push(`candidate output fails a contract check on "${label}": ${check.explanation}`);
    }
  }

  if (reasons.length === 0) {
    return {
      approved: true,
      reasons: [
        `incident page recovered and all ${input.regression.length} regression case(s) held`,
      ],
      results,
    };
  }

  return { approved: false, reasons, results };
}

/** Render the gate outcome as the matrix shown in the UI and the demo. */
export function formatGateMatrix(results: readonly GateCaseResult[]): string {
  const rows = results.map((result) => {
    const status = result.passed ? 'PASS' : 'FAIL';
    const detail =
      result.executionError ??
      result.fields
        .filter((field) => !field.agreed)
        .map((field) => field.path)
        .join(', ');
    return `  ${status.padEnd(5)} ${result.label.padEnd(24)} ${detail}`;
  });
  return rows.join('\n');
}
