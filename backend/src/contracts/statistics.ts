/**
 * Robust statistics for baseline profiles.
 *
 * Mean and standard deviation are the obvious choice and the wrong one. A
 * single corrupted run, which is exactly what NOTICE exists to catch, drags
 * both far enough to widen the acceptable band and hide the next corruption.
 * Median and median absolute deviation have a 50% breakdown point, so half the
 * baseline would have to be wrong before the profile is.
 */

/** Median of a numeric sample. Returns null for an empty sample. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

/**
 * Median absolute deviation, scaled to be comparable to a standard deviation.
 *
 * The 1.4826 factor makes MAD a consistent estimator of sigma for normally
 * distributed data, so thresholds can be reasoned about in familiar terms.
 */
export function medianAbsoluteDeviation(values: readonly number[]): number | null {
  const centre = median(values);
  if (centre === null) return null;
  const deviations = values.map((value) => Math.abs(value - centre));
  const rawMad = median(deviations);
  return rawMad === null ? null : rawMad * 1.4826;
}

/** Linear-interpolated quantile. `q` is in 0..1. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0] ?? null;

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

/**
 * How many robust standard deviations a value sits from the sample centre.
 *
 * Returns null when the spread cannot be estimated, which happens when the
 * baseline is constant. A constant baseline is not evidence that the next
 * different value is wrong, so the caller must treat null as "cannot judge"
 * rather than "passed".
 */
export function robustZScore(value: number, sample: readonly number[]): number | null {
  const centre = median(sample);
  const spread = medianAbsoluteDeviation(sample);
  if (centre === null || spread === null) return null;
  if (spread === 0) return null;
  return Math.abs(value - centre) / spread;
}

/**
 * Confidence that a learned profile is worth acting on, from sample size.
 *
 * Deliberately conservative and slow to reach certainty. A profile built from
 * three runs must not be able to justify rewriting a production collector, and
 * this value is displayed in the UI next to the sample count so a reviewer can
 * see how much the system actually knows.
 */
export function sampleConfidence(sampleCount: number): number {
  if (sampleCount <= 1) return 0;
  // Approaches but never reaches 1: 5 runs ~0.5, 20 runs ~0.8, 50 runs ~0.91.
  return Math.min(0.95, 1 - 5 / (sampleCount + 4));
}

/** Character-class signature used to spot a value changing shape. */
export function characterShape(value: string): string {
  return value
    .replace(/[0-9]/g, 'd')
    .replace(/[a-z]/g, 'a')
    .replace(/[A-Z]/g, 'A')
    .replace(/\s/g, '_')
    .slice(0, 40);
}
