import { normalizeMoney } from '../shared/index.js';
import { collectPathValues, getPath, leafPaths } from './paths.js';
import {
  characterShape,
  median,
  medianAbsoluteDeviation,
  quantile,
  sampleConfidence,
} from './statistics.js';
import type { CollectorContract, FieldProfile, Invariant } from './types.js';

/** A run accepted as healthy, used as baseline material. */
export interface BaselineRun {
  rows: readonly unknown[];
  observedAt: string;
}

/** Fields with at most this many distinct values are treated as enum-like. */
const ENUM_CARDINALITY_LIMIT = 12;

/** Build a profile for one field path across all baseline rows. */
function profileField(rows: readonly unknown[], path: string): FieldProfile {
  const lookups = rows.map((row) => getPath(row, path));
  const present = lookups.filter((lookup) => lookup.found);
  const values = present
    .map((lookup) => (lookup.found ? lookup.value : undefined))
    .filter((value) => value !== undefined);

  const nonNull = values.filter((value) => value !== null);

  const types: Record<string, number> = {};
  for (const value of nonNull) {
    const type = Array.isArray(value) ? 'array' : typeof value;
    types[type] = (types[type] ?? 0) + 1;
  }

  const shapes: Record<string, number> = {};
  const stringValues: string[] = [];
  const numericValues: number[] = [];
  const currencies: Record<string, number> = {};

  for (const value of nonNull) {
    if (typeof value === 'string') {
      stringValues.push(value);
      const shape = characterShape(value);
      shapes[shape] = (shapes[shape] ?? 0) + 1;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      numericValues.push(value);
    }

    // Money may arrive as `{ value, currency }` or as prose. Track currency
    // separately from magnitude: a silent locale flip changes the currency
    // while leaving the number entirely plausible.
    const money = normalizeMoney(value);
    if (money !== null) {
      if (!numericValues.includes(money.value) && typeof value !== 'number') {
        numericValues.push(money.value);
      }
      if (money.currency !== null) {
        currencies[money.currency] = (currencies[money.currency] ?? 0) + 1;
      }
    }
  }

  const profile: FieldProfile = {
    path,
    sampleCount: rows.length,
    presenceRate: rows.length === 0 ? 0 : present.length / rows.length,
    nullRate: values.length === 0 ? 0 : (values.length - nonNull.length) / values.length,
    types,
    shapes,
  };

  if (numericValues.length >= 2) {
    const centre = median(numericValues);
    const spread = medianAbsoluteDeviation(numericValues);
    const p05 = quantile(numericValues, 0.05);
    const p95 = quantile(numericValues, 0.95);
    if (centre !== null && spread !== null && p05 !== null && p95 !== null) {
      profile.numeric = {
        median: centre,
        mad: spread,
        p05,
        p95,
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
      };
    }
  }

  if (stringValues.length >= 2) {
    const lengths = stringValues.map((value) => value.length);
    const centre = median(lengths);
    const spread = medianAbsoluteDeviation(lengths);
    if (centre !== null && spread !== null) {
      profile.stringLength = { median: centre, mad: spread };
    }
  }

  const distinct = new Set(stringValues);
  if (distinct.size > 0 && distinct.size <= ENUM_CARDINALITY_LIMIT) {
    const counts: Record<string, number> = {};
    for (const value of stringValues) counts[value] = (counts[value] ?? 0) + 1;
    profile.enumValues = counts;
  }

  if (Object.keys(currencies).length > 0) profile.currencies = currencies;

  return profile;
}

/**
 * Learn a contract from runs a human has accepted as healthy.
 *
 * Baseline material must be reviewed, not merely recent. Learning from
 * whatever ran last would let a slow corruption teach NOTICE that the
 * corrupted shape is normal, and the detector would go quiet exactly when it
 * mattered.
 *
 * @param invariants User-declared facts, carried through unchanged. These are
 *   never inferred, because a statistic cannot know that a deposit should be
 *   smaller than a price.
 */
export function learnContract(
  collectorId: string,
  runs: readonly BaselineRun[],
  invariants: readonly Invariant[] = [],
  version = 1,
): CollectorContract {
  const rows = runs.flatMap((run) => [...run.rows]);

  const paths = new Set<string>();
  for (const row of rows) {
    for (const path of leafPaths(row)) paths.add(path);
  }

  const profiles = [...paths].sort().map((path) => profileField(rows, path));

  // A field present on essentially every baseline row is treated as required.
  // Threshold is not 1.0 because a single optional-but-usually-present field
  // should not be permanently excluded by one absence.
  const requiredFields = profiles
    .filter((profile) => profile.presenceRate >= 0.98 && profile.nullRate <= 0.02)
    .map((profile) => profile.path);

  const rowCounts = runs.map((run) => run.rows.length);
  const rowCountMedian = median(rowCounts) ?? 0;
  const rowCountMad = medianAbsoluteDeviation(rowCounts) ?? 0;

  return {
    collectorId,
    version,
    learnedAt: new Date().toISOString(),
    sampleCount: runs.length,
    confidence: sampleConfidence(runs.length),
    profiles,
    invariants: [...invariants],
    requiredFields,
    rowCount: {
      median: rowCountMedian,
      mad: rowCountMad,
      min: rowCounts.length === 0 ? 0 : Math.min(...rowCounts),
    },
  };
}

/**
 * Fold an accepted run into an existing contract.
 *
 * Used after a `genuine_source_change` verdict: the world moved, the collector
 * is fine, and the baseline should follow rather than alarming forever. Only
 * ever called on runs that were classified as genuine changes and corroborated
 * by the witness.
 */
export function extendContract(
  contract: CollectorContract,
  run: BaselineRun,
  priorRuns: readonly BaselineRun[],
): CollectorContract {
  return learnContract(
    contract.collectorId,
    [...priorRuns, run],
    contract.invariants,
    contract.version + 1,
  );
}

/** Look up a profile by path. */
export function findProfile(
  contract: CollectorContract,
  path: string,
): FieldProfile | undefined {
  return contract.profiles.find((profile) => profile.path === path);
}

/** Distinct-value ratio for a field, used to detect pagination collapse. */
export function uniqueRatio(rows: readonly unknown[], path: string): number | null {
  const values = collectPathValues(rows, path).filter((value) => value !== null);
  if (values.length === 0) return null;
  const distinct = new Set(values.map((value) => JSON.stringify(value)));
  return distinct.size / values.length;
}
