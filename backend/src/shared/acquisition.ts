import { z } from 'zod';

/**
 * The conditions under which a page was fetched.
 *
 * This exists because collector and witness disagreement is only meaningful
 * when both sensors observed the same thing. If the collector saw a GBP page
 * from one region and the witness saw a USD page from another, the values will
 * differ for reasons that have nothing to do with extraction drift. Recording
 * the context lets the classifier return `access_anomaly` instead of blaming
 * the extractor and triggering a pointless repair.
 */
export const acquisitionContextSchema = z.object({
  /** The URL actually requested, before any redirect. */
  requestedUrl: z.string().url(),

  /** The URL finally observed, if the request was redirected. */
  resolvedUrl: z.string().url().optional(),

  /** ISO 3166-1 alpha-2, when the fetch path allows targeting. */
  country: z.string().length(2).optional(),

  /** BCP 47 language tag advertised to the target. */
  locale: z.string().optional(),

  /** ISO 4217 code, when the page states or implies one. */
  currency: z.string().length(3).optional(),

  deviceType: z.enum(['desktop', 'mobile', 'unknown']).default('unknown'),

  /**
   * Any A/B or variant marker observed on the page, such as a data attribute
   * or cookie value. Two sensors landing on different variants is a common
   * and benign cause of disagreement.
   */
  variantMarkers: z.array(z.string()).default([]),

  /** When the observation was made. */
  observedAt: z.string().datetime(),
});

export type AcquisitionContext = z.infer<typeof acquisitionContextSchema>;

/** How closely two acquisition contexts match. */
export interface ContextAlignment {
  /** True when nothing observed suggests the sensors saw different pages. */
  aligned: boolean;
  /** Human-readable reasons the contexts differ, empty when aligned. */
  mismatches: string[];
  /** Seconds between the two observations. */
  observationGapSeconds: number;
}

/**
 * Compare two acquisition contexts.
 *
 * Deliberately conservative: anything that could explain a value difference
 * counts as a mismatch, because a false `aligned: true` sends a genuine access
 * anomaly down the repair path and rewrites a collector that was never broken.
 *
 * @param maxGapSeconds Observations further apart than this are treated as
 *   potentially seeing different content. Defaults to five minutes.
 */
export function compareAcquisitionContexts(
  a: AcquisitionContext,
  b: AcquisitionContext,
  maxGapSeconds = 300,
): ContextAlignment {
  const mismatches: string[] = [];

  const canonical = (ctx: AcquisitionContext): string => ctx.resolvedUrl ?? ctx.requestedUrl;
  if (canonical(a) !== canonical(b)) {
    mismatches.push(`resolved URL differs: ${canonical(a)} vs ${canonical(b)}`);
  }

  if (a.country && b.country && a.country !== b.country) {
    mismatches.push(`country differs: ${a.country} vs ${b.country}`);
  }

  if (a.locale && b.locale && a.locale !== b.locale) {
    mismatches.push(`locale differs: ${a.locale} vs ${b.locale}`);
  }

  if (a.currency && b.currency && a.currency !== b.currency) {
    mismatches.push(`currency differs: ${a.currency} vs ${b.currency}`);
  }

  if (a.deviceType !== b.deviceType && a.deviceType !== 'unknown' && b.deviceType !== 'unknown') {
    mismatches.push(`device type differs: ${a.deviceType} vs ${b.deviceType}`);
  }

  const onlyInA = a.variantMarkers.filter((m) => !b.variantMarkers.includes(m));
  const onlyInB = b.variantMarkers.filter((m) => !a.variantMarkers.includes(m));
  if (onlyInA.length > 0 || onlyInB.length > 0) {
    mismatches.push(`variant markers differ: [${onlyInA.join(', ')}] vs [${onlyInB.join(', ')}]`);
  }

  const gapMs = Math.abs(Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const observationGapSeconds = Math.round(gapMs / 1000);
  if (observationGapSeconds > maxGapSeconds) {
    mismatches.push(
      `observations ${observationGapSeconds}s apart, beyond the ${maxGapSeconds}s window`,
    );
  }

  return { aligned: mismatches.length === 0, mismatches, observationGapSeconds };
}
