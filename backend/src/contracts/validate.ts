import { normalizeMoney, type CheckResult } from '../shared/index.js';
import { findProfile, uniqueRatio } from './learn.js';
import { collectPathValues, getPath } from './paths.js';
import { characterShape, robustZScore } from './statistics.js';
import {
  DEFAULT_THRESHOLDS,
  type CollectorContract,
  type ContractThresholds,
  type Invariant,
} from './types.js';

/**
 * Severity conventions.
 *
 * A declared invariant is a fact the user asserted, so breaking one is a hard
 * failure. A learned profile is an observation, so departing from it is a
 * `warn` that triggers a witness fetch. Nothing statistical is allowed to
 * reach severity 1, because the only thing a distribution can tell you is that
 * something is unusual, and unusual is not the same as wrong.
 */
const SEVERITY = {
  invariantBreach: 1,
  missingRequiredField: 0.9,
  explicitError: 1,
  typeChange: 0.7,
  currencyChange: 0.8,
  numericOutlier: 0.5,
  shapeChange: 0.35,
  enumViolation: 0.5,
  rowCountDrop: 0.6,
  duplicateRows: 0.6,
} as const;

/** Read a numeric value from a field, tolerating the money object shape. */
function numericAt(row: unknown, path: string): number | null {
  const lookup = getPath(row, path);
  if (!lookup.found) return null;
  if (typeof lookup.value === 'number') {
    return Number.isFinite(lookup.value) ? lookup.value : null;
  }
  return normalizeMoney(lookup.value)?.value ?? null;
}

/** Evaluate one declared invariant against one row. */
function checkInvariant(row: unknown, invariant: Invariant, rowIndex: number): CheckResult | null {
  const id = `invariant:${invariant.kind}:${'field' in invariant ? invariant.field : invariant.left}`;
  const base = { checkId: id, severity: SEVERITY.invariantBreach, confidence: 1 } as const;

  switch (invariant.kind) {
    case 'required': {
      const lookup = getPath(row, invariant.field);
      const missing = !lookup.found || lookup.value === null || lookup.value === '';
      return {
        ...base,
        field: invariant.field,
        status: missing ? 'fail' : 'pass',
        observed: lookup.found ? lookup.value : undefined,
        explanation: missing
          ? `row ${rowIndex}: required field "${invariant.field}" is missing or empty`
          : `required field "${invariant.field}" present`,
      };
    }

    case 'range': {
      const value = numericAt(row, invariant.field);
      if (value === null) {
        return {
          ...base,
          field: invariant.field,
          status: 'unknown',
          confidence: 0,
          explanation: `row ${rowIndex}: "${invariant.field}" is not numeric, range not evaluated`,
        };
      }
      const belowMin = invariant.min !== undefined && value < invariant.min;
      const aboveMax = invariant.max !== undefined && value > invariant.max;
      return {
        ...base,
        field: invariant.field,
        status: belowMin || aboveMax ? 'fail' : 'pass',
        expected: `${invariant.min ?? '-inf'}..${invariant.max ?? '+inf'}`,
        observed: value,
        explanation:
          belowMin || aboveMax
            ? `row ${rowIndex}: "${invariant.field}" is ${value}, outside ${invariant.min ?? '-inf'}..${invariant.max ?? '+inf'}`
            : `"${invariant.field}" within declared range`,
      };
    }

    case 'compare': {
      const left = numericAt(row, invariant.left);
      const right = numericAt(row, invariant.right);
      if (left === null || right === null) {
        return {
          ...base,
          field: invariant.left,
          status: 'unknown',
          confidence: 0,
          explanation: `row ${rowIndex}: cannot compare "${invariant.left}" to "${invariant.right}", one side is not numeric`,
        };
      }
      const holds =
        invariant.op === '>'
          ? left > right
          : invariant.op === '>='
            ? left >= right
            : invariant.op === '<'
              ? left < right
              : invariant.op === '<='
                ? left <= right
                : invariant.op === '=='
                  ? left === right
                  : left !== right;
      return {
        ...base,
        field: invariant.left,
        status: holds ? 'pass' : 'fail',
        expected: `${invariant.left} ${invariant.op} ${invariant.right}`,
        observed: `${left} ${invariant.op} ${right}`,
        explanation: holds
          ? `${invariant.left} ${invariant.op} ${invariant.right} holds`
          : `row ${rowIndex}: ${invariant.left}=${left} violates "${invariant.left} ${invariant.op} ${invariant.right}" (${invariant.right}=${right})`,
      };
    }

    case 'host': {
      const lookup = getPath(row, invariant.field);
      if (!lookup.found || typeof lookup.value !== 'string') {
        return {
          ...base,
          field: invariant.field,
          status: 'unknown',
          confidence: 0,
          explanation: `row ${rowIndex}: "${invariant.field}" is not a URL string`,
        };
      }
      let host: string;
      try {
        host = new URL(lookup.value).host;
      } catch {
        return {
          ...base,
          field: invariant.field,
          status: 'fail',
          observed: lookup.value,
          explanation: `row ${rowIndex}: "${invariant.field}" is not a parseable URL`,
        };
      }
      const matches = host === invariant.expectedHost;
      return {
        ...base,
        field: invariant.field,
        status: matches ? 'pass' : 'fail',
        expected: invariant.expectedHost,
        observed: host,
        explanation: matches
          ? `"${invariant.field}" points at ${host}`
          : `row ${rowIndex}: "${invariant.field}" points at ${host}, expected ${invariant.expectedHost}`,
      };
    }

    case 'enum': {
      const lookup = getPath(row, invariant.field);
      if (!lookup.found || typeof lookup.value !== 'string') {
        return {
          ...base,
          field: invariant.field,
          status: 'unknown',
          confidence: 0,
          explanation: `row ${rowIndex}: "${invariant.field}" is not a string`,
        };
      }
      const allowed = invariant.allowed.includes(lookup.value);
      return {
        ...base,
        field: invariant.field,
        status: allowed ? 'pass' : 'fail',
        expected: invariant.allowed.join(' | '),
        observed: lookup.value,
        explanation: allowed
          ? `"${invariant.field}" within allowed set`
          : `row ${rowIndex}: "${invariant.field}" is "${lookup.value}", not one of ${invariant.allowed.join(', ')}`,
      };
    }

    case 'currency': {
      const lookup = getPath(row, invariant.field);
      const money = lookup.found ? normalizeMoney(lookup.value) : null;
      if (money === null || money.currency === null) {
        return {
          ...base,
          field: invariant.field,
          status: 'unknown',
          confidence: 0,
          explanation: `row ${rowIndex}: no currency determinable for "${invariant.field}"`,
        };
      }
      const allowed = invariant.allowed.includes(money.currency);
      return {
        ...base,
        field: invariant.field,
        status: allowed ? 'pass' : 'fail',
        expected: invariant.allowed.join(' | '),
        observed: money.currency,
        explanation: allowed
          ? `currency ${money.currency} allowed`
          : `row ${rowIndex}: currency is ${money.currency}, expected one of ${invariant.allowed.join(', ')}`,
      };
    }

    case 'unique':
      // Evaluated across the whole run, not per row.
      return null;
  }
}

export interface ValidationInput {
  rows: readonly unknown[];
  contract: CollectorContract;
  thresholds?: ContractThresholds;
}

/**
 * Run every check against a collector run.
 *
 * Returns results rather than a verdict. Deciding what the results mean is the
 * classifier's job, and it needs the witness before it can tell a broken
 * extractor from a changed world.
 */
export function validateRun(input: ValidationInput): CheckResult[] {
  const { rows, contract } = input;
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const results: CheckResult[] = [];

  // 1. Explicit failure: the collector reported an error, or returned nothing.
  const errorRows = rows.filter(
    (row) => row !== null && typeof row === 'object' && 'error' in (row as object),
  );
  if (errorRows.length > 0) {
    const first = errorRows[0] as Record<string, unknown>;
    results.push({
      checkId: 'structure:collector_error',
      status: 'fail',
      severity: SEVERITY.explicitError,
      confidence: 1,
      observed: first['error'],
      explanation: `collector returned ${errorRows.length} error row(s): ${String(first['error'])}`,
    });
  }

  if (rows.length === 0) {
    // An empty result is a real outcome, not a hang. It may be legitimate, so
    // it is reported as a failure to investigate rather than proof of breakage.
    results.push({
      checkId: 'structure:empty_result',
      status: 'fail',
      severity: SEVERITY.explicitError,
      confidence: 1,
      observed: 0,
      expected: `${contract.rowCount.min} or more`,
      explanation:
        'collector returned zero rows; downstream consumers would read this as "nothing found" rather than a failure',
    });
    return results;
  }

  // 2. Required fields, from the learned structure.
  for (const path of contract.requiredFields) {
    const present = rows.filter((row) => {
      const lookup = getPath(row, path);
      return lookup.found && lookup.value !== null && lookup.value !== '';
    }).length;
    const rate = present / rows.length;
    results.push({
      checkId: `structure:required:${path}`,
      field: path,
      status: rate >= thresholds.presenceFloor ? 'pass' : 'fail',
      severity: SEVERITY.missingRequiredField,
      confidence: contract.confidence,
      expected: `present on at least ${Math.round(thresholds.presenceFloor * 100)}% of rows`,
      observed: `${Math.round(rate * 100)}%`,
      explanation:
        rate >= thresholds.presenceFloor
          ? `"${path}" present on ${Math.round(rate * 100)}% of rows`
          : `"${path}" present on only ${Math.round(rate * 100)}% of rows, baseline expected it on nearly all`,
    });
  }

  // 3. Declared invariants.
  for (const invariant of contract.invariants) {
    if (invariant.kind === 'unique') {
      const ratio = uniqueRatio(rows, invariant.field);
      results.push({
        checkId: `invariant:unique:${invariant.field}`,
        field: invariant.field,
        status: ratio === null ? 'unknown' : ratio >= thresholds.uniqueIdFloor ? 'pass' : 'fail',
        severity: SEVERITY.duplicateRows,
        confidence: ratio === null ? 0 : 1,
        expected: `at least ${Math.round(thresholds.uniqueIdFloor * 100)}% distinct`,
        observed: ratio === null ? 'no values' : `${Math.round(ratio * 100)}% distinct`,
        explanation:
          ratio === null
            ? `no values for "${invariant.field}", uniqueness not evaluated`
            : ratio >= thresholds.uniqueIdFloor
              ? `"${invariant.field}" is ${Math.round(ratio * 100)}% distinct`
              : `"${invariant.field}" is only ${Math.round(ratio * 100)}% distinct, which is the signature of pagination returning the same page repeatedly`,
      });
      continue;
    }

    for (const [index, row] of rows.entries()) {
      const result = checkInvariant(row, invariant, index);
      if (result !== null && result.status !== 'pass') results.push(result);
    }
  }

  // 4. Learned profiles. These only ever warn.
  if (contract.sampleCount >= thresholds.minSampleCount) {
    results.push(...learnedChecks(rows, contract, thresholds));
  } else {
    results.push({
      checkId: 'learned:insufficient_baseline',
      status: 'unknown',
      severity: 0,
      confidence: 0,
      observed: contract.sampleCount,
      expected: `${thresholds.minSampleCount} or more baseline runs`,
      explanation: `baseline has only ${contract.sampleCount} run(s); statistical checks are disabled until it grows`,
    });
  }

  // 5. Row count.
  if (contract.rowCount.median > 0) {
    const drop = 1 - rows.length / contract.rowCount.median;
    results.push({
      checkId: 'learned:row_count',
      status: drop > thresholds.rowCountDropRatio ? 'warn' : 'pass',
      severity: SEVERITY.rowCountDrop,
      confidence: contract.confidence,
      expected: `around ${contract.rowCount.median}`,
      observed: rows.length,
      explanation:
        drop > thresholds.rowCountDropRatio
          ? `row count fell from a baseline median of ${contract.rowCount.median} to ${rows.length}`
          : `row count ${rows.length} consistent with baseline`,
    });
  }

  return results;
}

/** Statistical checks derived from the learned baseline. */
function learnedChecks(
  rows: readonly unknown[],
  contract: CollectorContract,
  thresholds: ContractThresholds,
): CheckResult[] {
  const results: CheckResult[] = [];

  for (const profile of contract.profiles) {
    const values = collectPathValues(rows, profile.path).filter((value) => value !== null);
    if (values.length === 0) continue;

    // Type stability.
    const observedTypes = new Set(
      values.map((value) => (Array.isArray(value) ? 'array' : typeof value)),
    );
    const baselineTypes = new Set(Object.keys(profile.types));
    const novelTypes = [...observedTypes].filter((type) => !baselineTypes.has(type));
    if (novelTypes.length > 0 && baselineTypes.size > 0) {
      results.push({
        checkId: `learned:type:${profile.path}`,
        field: profile.path,
        status: 'warn',
        severity: SEVERITY.typeChange,
        confidence: contract.confidence,
        expected: [...baselineTypes].join(' | '),
        observed: novelTypes.join(' | '),
        explanation: `"${profile.path}" now returns ${novelTypes.join(', ')}, never seen in the baseline`,
      });
    }

    // Currency stability. A plausible number in the wrong currency is one of
    // the least visible and most damaging corruptions there is.
    if (profile.currencies !== undefined) {
      const baselineCurrencies = new Set(Object.keys(profile.currencies));
      for (const value of values) {
        const money = normalizeMoney(value);
        if (money?.currency == null) continue;
        if (!baselineCurrencies.has(money.currency)) {
          results.push({
            checkId: `learned:currency:${profile.path}`,
            field: profile.path,
            status: 'warn',
            severity: SEVERITY.currencyChange,
            confidence: contract.confidence,
            expected: [...baselineCurrencies].join(' | '),
            observed: money.currency,
            explanation: `"${profile.path}" is now in ${money.currency}, baseline only ever saw ${[...baselineCurrencies].join(', ')}`,
          });
          break;
        }
      }
    }

    // Numeric outliers, against a robust centre and spread.
    if (profile.numeric !== undefined) {
      const sample = [profile.numeric.p05, profile.numeric.median, profile.numeric.p95];
      for (const value of values) {
        const numeric = typeof value === 'number' ? value : normalizeMoney(value)?.value;
        if (numeric === undefined || numeric === null) continue;

        const z =
          profile.numeric.mad > 0
            ? Math.abs(numeric - profile.numeric.median) / profile.numeric.mad
            : robustZScore(numeric, sample);

        /*
         * A baseline that never varied cannot produce a z-score, and silence
         * here was publishing wrong values on the most trustworthy sources.
         *
         * `robustZScore` returns null when the spread is zero, and documents
         * that the caller must treat it as "cannot judge" rather than
         * "passed". This loop did neither: it emitted no check at all. Since
         * `needsWitness` wakes the second sensor only on a `fail` or a `warn`,
         * a price that had read 249 on every single observation could come
         * back as 99 and be published as verified without the witness ever
         * being asked. The steadier the source, the blinder the check, which
         * is precisely backwards.
         *
         * A `warn` is the right severity and not a `fail`. A constant baseline
         * genuinely is not evidence that a new value is wrong; it is a reason
         * to go and look. That is what a warn buys: one Web Unlocker read, and
         * then the classifier decides on evidence. If the page really says 99
         * this resolves as `genuine_source_change` and the collector is left
         * alone. If the page still says 249 it is `extractor_drift`. Neither
         * outcome is decided here.
         */
        if (z === null && numeric !== profile.numeric.median) {
          results.push({
            checkId: `learned:numeric:${profile.path}`,
            field: profile.path,
            status: 'warn',
            severity: SEVERITY.numericOutlier,
            confidence: contract.confidence,
            expected: `${profile.numeric.median}, unchanged on every observation so far`,
            observed: numeric,
            explanation: `"${profile.path}" is ${numeric}, and the baseline had read ${profile.numeric.median} on every observation until now. A constant baseline cannot produce an outlier score, so this asks the second sensor rather than deciding.`,
          });
          break;
        }

        if (z !== null && z > thresholds.numericZScore) {
          results.push({
            checkId: `learned:numeric:${profile.path}`,
            field: profile.path,
            status: 'warn',
            severity: SEVERITY.numericOutlier,
            confidence: contract.confidence,
            expected: `near ${profile.numeric.median}`,
            observed: numeric,
            explanation: `"${profile.path}" is ${numeric}, ${z.toFixed(1)} robust deviations from the baseline median of ${profile.numeric.median}`,
          });
          break;
        }
      }
    }

    // Enum membership.
    if (profile.enumValues !== undefined) {
      const allowed = new Set(Object.keys(profile.enumValues));
      for (const value of values) {
        if (typeof value === 'string' && !allowed.has(value)) {
          results.push({
            checkId: `learned:enum:${profile.path}`,
            field: profile.path,
            status: 'warn',
            severity: SEVERITY.enumViolation,
            confidence: contract.confidence,
            expected: [...allowed].join(' | '),
            observed: value,
            explanation: `"${profile.path}" is "${value}", outside the ${allowed.size} values the baseline ever saw`,
          });
          break;
        }
      }
    }

    // Character shape, the weakest signal, kept low severity on purpose.
    if (Object.keys(profile.shapes).length > 0) {
      const knownShapes = new Set(Object.keys(profile.shapes));
      for (const value of values) {
        if (typeof value !== 'string') continue;
        if (!knownShapes.has(characterShape(value))) {
          results.push({
            checkId: `learned:shape:${profile.path}`,
            field: profile.path,
            status: 'warn',
            severity: SEVERITY.shapeChange,
            confidence: contract.confidence * 0.6,
            observed: characterShape(value),
            explanation: `"${profile.path}" changed character shape, which often means a format change rather than a wrong value`,
          });
          break;
        }
      }
    }
  }

  return results;
}

/** True when a run tripped something that only a human or witness can settle. */
export function hasHardFailure(results: readonly CheckResult[]): boolean {
  return results.some((result) => result.status === 'fail');
}

/** True when nothing failed but something looked unusual. */
export function hasSuspicion(results: readonly CheckResult[]): boolean {
  return !hasHardFailure(results) && results.some((result) => result.status === 'warn');
}

export { findProfile };
