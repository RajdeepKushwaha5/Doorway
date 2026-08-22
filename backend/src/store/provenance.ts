import { z } from 'zod';

/**
 * How a collector came to exist.
 *
 * A `c_*` id is what this system shows about a Scraper Studio collector today,
 * and it is the least interesting fact about it. The interesting one is the
 * sentence somebody's coding agent turned into a working scraper, along with
 * what it saw on the page that made it choose those fields and reject others.
 * That sentence is the design. The id is a receipt.
 *
 * Nothing recorded it. `acquisitionContext` sits on every collector and is
 * about the conditions a page was fetched under, which is a different question
 * with a similar name, and it was empty on every collector besides. So the
 * brief each of these scrapers was built from existed once, in a terminal, and
 * was gone.
 *
 * This is deliberately separate from `acquisitionContext` rather than folded
 * into it. One describes a request. This describes a decision.
 *
 * It is optional, and absence is shown as absence. A collector registered
 * before this existed has no birth certificate, and inventing a plausible one
 * after the fact would be manufacturing exactly the kind of confident,
 * well-formed, unverified claim this project exists to catch.
 */
export const collectorProvenanceSchema = z.object({
  /** The page the agent was pointed at. */
  sourceUrl: z.string().url(),

  /**
   * The brief handed to `bdata scraper create`, verbatim.
   *
   * Capped at the same 500 characters the CLI accepts, so what is stored is
   * what was actually sent rather than a tidied version of it.
   */
  description: z.string().min(1).max(500),

  /**
   * What the agent saw that led to those choices.
   *
   * The useful part of a decision is the alternative that was rejected. "Four
   * dates on the page, 1 September labelled Early interest, 18 September
   * labelled Applications close" says more about whether to trust this
   * collector than any description of the output shape.
   */
  observations: z.array(z.string()).default([]),

  /** Fields declared too consequential to publish unverified, and why. */
  protectedBecause: z.record(z.string()).default({}),

  /** Who drove the creation. */
  createdBy: z.enum(['coding_agent', 'operator']),

  /** When the collector was created. */
  createdAt: z.string().datetime(),

  /**
   * How long Scraper Studio took to build it.
   *
   * Recorded because it is the number nobody plans for. Generation runs to
   * minutes rather than seconds, which is fine for a background job and
   * decides the shape of anything that waits on it.
   */
  generationSeconds: z.number().int().nonnegative().optional(),
});

export type CollectorProvenance = z.infer<typeof collectorProvenanceSchema>;
