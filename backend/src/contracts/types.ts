import { z } from 'zod';

/**
 * Invariants are declared as structured objects, not a string mini-language.
 *
 * A DSL like `sale_price <= list_price` reads nicely in a config file and then
 * needs a parser, a grammar, error messages and its own test suite. These
 * cover the same ground, serialize straight to JSON or YAML, and are checked
 * by the type system before they ever run.
 */
export const invariantSchema = z.discriminatedUnion('kind', [
  /** The field must be present and non-null on every row. */
  z.object({ kind: z.literal('required'), field: z.string() }),

  /** Numeric bounds. Either end may be omitted. */
  z.object({
    kind: z.literal('range'),
    field: z.string(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),

  /** Relationship between two fields on the same row. */
  z.object({
    kind: z.literal('compare'),
    left: z.string(),
    op: z.enum(['>', '>=', '<', '<=', '==', '!=']),
    right: z.string(),
  }),

  /** Values must be distinct across the whole run. Catches pagination collapse. */
  z.object({ kind: z.literal('unique'), field: z.string() }),

  /** A URL field must point at an expected host. */
  z.object({ kind: z.literal('host'), field: z.string(), expectedHost: z.string() }),

  /** The value must be one of a closed set. */
  z.object({ kind: z.literal('enum'), field: z.string(), allowed: z.array(z.string()).min(1) }),

  /** Currency must stay within a known set. Catches a silent locale flip. */
  z.object({ kind: z.literal('currency'), field: z.string(), allowed: z.array(z.string()).min(1) }),
]);

export type Invariant = z.infer<typeof invariantSchema>;

/** What a single field looked like across the baseline runs. */
export const fieldProfileSchema = z.object({
  path: z.string(),
  /** Rows the profile was built from. */
  sampleCount: z.number().int().nonnegative(),
  /** Fraction of rows where the path was present. */
  presenceRate: z.number().min(0).max(1),
  /** Fraction of present values that were null. */
  nullRate: z.number().min(0).max(1),
  /** Observed JavaScript types and how often each appeared. */
  types: z.record(z.string(), z.number()),
  numeric: z
    .object({
      median: z.number(),
      mad: z.number(),
      p05: z.number(),
      p95: z.number(),
      min: z.number(),
      max: z.number(),
    })
    .optional(),
  stringLength: z.object({ median: z.number(), mad: z.number() }).optional(),
  /** Character-class signatures and their frequencies. */
  shapes: z.record(z.string(), z.number()),
  /** Present only when the field looked enum-like: few distinct values. */
  enumValues: z.record(z.string(), z.number()).optional(),
  /** Currency codes seen, when the field parsed as money. */
  currencies: z.record(z.string(), z.number()).optional(),
});

export type FieldProfile = z.infer<typeof fieldProfileSchema>;

/**
 * Everything NOTICE knows about what healthy output looks like.
 *
 * Learned profiles and declared invariants are kept apart on purpose. An
 * invariant is a business fact the user asserts and it can fail a run on its
 * own. A learned profile is an observation with a sample count attached, and
 * it can only raise suspicion, which triggers a witness fetch rather than a
 * repair. Letting statistics alone authorize rewriting a collector is how a
 * seasonal price change turns into a corrupted extractor.
 */
export const collectorContractSchema = z.object({
  collectorId: z.string(),
  version: z.number().int().positive(),
  learnedAt: z.string().datetime(),
  /** Runs the baseline was learned from. */
  sampleCount: z.number().int().nonnegative(),
  /** Confidence derived from sample size, surfaced in the UI. */
  confidence: z.number().min(0).max(1),
  profiles: z.array(fieldProfileSchema),
  invariants: z.array(invariantSchema),
  /** Paths that must exist for output to be considered structurally valid. */
  requiredFields: z.array(z.string()),
  rowCount: z.object({ median: z.number(), mad: z.number(), min: z.number() }),
});

export type CollectorContract = z.infer<typeof collectorContractSchema>;

/** Tunables for how aggressively learned profiles raise suspicion. */
export interface ContractThresholds {
  /** Robust z-score beyond which a numeric value is suspicious. */
  numericZScore: number;
  /** Presence rate below which a newly missing field is suspicious. */
  presenceFloor: number;
  /** Fractional drop in row count that is suspicious. */
  rowCountDropRatio: number;
  /** Below this share of distinct IDs, suspect pagination collapse. */
  uniqueIdFloor: number;
  /** Minimum runs before learned profiles are allowed to fire at all. */
  minSampleCount: number;
}

export const DEFAULT_THRESHOLDS: ContractThresholds = {
  numericZScore: 6,
  presenceFloor: 0.9,
  rowCountDropRatio: 0.5,
  uniqueIdFloor: 0.9,
  minSampleCount: 3,
};
