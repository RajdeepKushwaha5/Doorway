import { z } from 'zod';

/**
 * How to find one field in prose, independently of the collector.
 *
 * This is the semantic contract made executable. The plain-language `meaning`
 * a user writes for a Scraper Studio field ("the current purchase price,
 * excluding refundable deposits") becomes labels to look for and labels to
 * avoid, so the witness can locate the same fact without sharing any selector
 * logic with the collector.
 *
 * `excludeLabels` is what makes the deposit-read-as-price case detectable. A
 * naive extractor takes the first currency amount on the page, which on a
 * redesigned layout is frequently the wrong one, and then the two sensors
 * agree on a wrong value and NOTICE reports health.
 */
export const witnessFieldSpecSchema = z.object({
  /** Dotted path this maps to in collector output, such as `price.value`. */
  path: z.string().min(1),

  /**
   * Human meaning, carried through to the repair prompt verbatim.
   *
   * Bright Data repairs extraction against a description like this, so the
   * same sentence that drives detection also drives the fix.
   */
  meaning: z.string().min(1),

  /** Labels that indicate this field. Matched case-insensitively. */
  labels: z.array(z.string().min(1)).min(1),

  /** Labels that mean the opposite. A line matching any of these is skipped. */
  excludeLabels: z.array(z.string().min(1)).default([]),

  kind: z.enum(['money', 'number', 'text', 'enum']),

  /** For `enum`, the accepted canonical values. */
  allowed: z.array(z.string()).default([]),
});

export type WitnessFieldSpec = z.infer<typeof witnessFieldSpecSchema>;

/** Where a witness value came from, so a human can check the machine. */
export interface EvidenceSpan {
  /** The source line, trimmed. Shown verbatim in the incident timeline. */
  line: string;
  /** 1-based line number within the fetched markdown. */
  lineNumber: number;
  /** Which extraction strategy produced this, for debugging and for trust. */
  strategy: 'json-ld' | 'labelled-line' | 'table-row' | 'heading-adjacent' | 'bare-currency';
}

/** One field, as observed by the witness. */
export interface WitnessValue {
  path: string;
  value: unknown;
  /**
   * How much to trust this extraction, 0 to 1.
   *
   * Low confidence must never be rounded up to certainty. A weak witness makes
   * a comparison `incomparable`, which quarantines and asks for review, rather
   * than authorizing a repair on thin evidence.
   */
  confidence: number;
  evidence: EvidenceSpan;
}

/** Everything the witness saw for one page. */
export interface WitnessObservation {
  url: string;
  fetchedAt: string;
  /** SHA-256 of the raw markdown, so evidence can be shown to be unedited. */
  contentHash: string;
  /** Bounded excerpt kept for display. The full body is not retained. */
  excerpt: string;
  values: WitnessValue[];
  /** Fields the witness looked for and could not find. */
  notFound: string[];
}
