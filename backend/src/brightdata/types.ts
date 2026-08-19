import { z } from 'zod';

/**
 * Response from `POST /dca/trigger`.
 *
 * Note the field name. The trigger response calls this `collection_id`, and
 * every other endpoint reads the same value as `snapshot_id`. Passing the
 * wrong name silently returns nothing rather than erroring, so the client
 * normalizes it to one name immediately and callers never see both.
 */
export const triggerResponseSchema = z.object({
  collection_id: z.string().min(1),
});

/**
 * Response from `GET /dca/dataset`.
 *
 * Either a status envelope while the job runs, or the result rows once it is
 * done. An empty array is a valid completed result and must not be treated as
 * "still building", which is the bug in Bright Data's own Python boilerplate.
 */
export const snapshotStatusSchema = z.object({
  status: z.string(),
});

export type SnapshotState =
  | { kind: 'building'; status: string }
  | { kind: 'ready'; rows: unknown[] };

/** Payload for `POST /dca/collectors/{id}/refactor_template`. */
export const healRequestSchema = z.object({
  /** The diagnosis. Bright Data caps this at 1000 characters. */
  prompt: z.string().min(1).max(1000),
  /**
   * Inputs the healer should exercise, starting with the page that failed.
   *
   * This is the field the `bdata` CLI drops. Through CLI v0.3.5, `scraper heal
   * --url` places the URL only in the printed next-step hint and sends
   * `custom_input: []`, so the healer never sees the incident. The CLI's own
   * help says so: "Not sent to the heal call; heal only mutates the scraper."
   * NOTICE calls the API directly for exactly this reason.
   */
  custom_input: z.array(z.object({ url: z.string().url() })),
});

export type HealRequest = z.infer<typeof healRequestSchema>;

/** Terminal and non-terminal states of a Self-Healing job. */
export const healPhaseSchema = z.enum([
  'pending',
  'running',
  'awaiting_approval',
  'done',
  'failed',
  'rejected',
]);

export type HealPhase = z.infer<typeof healPhaseSchema>;

/**
 * Progress envelope from the Self-Healing endpoint.
 *
 * Deliberately permissive. The shape is not fully documented and has changed;
 * unknown keys are preserved on `raw` so evidence keeps whatever the API
 * actually sent, rather than only the parts we anticipated.
 */
export interface HealProgress {
  phase: HealPhase;
  /** Bright Data's own job identifier, when it supplies one. */
  jobId: string | null;
  /**
   * Rows the healer produced from its preview run.
   *
   * A green preview is not deployment evidence. Bright Data previews against
   * inputs of its own choosing, which may not include the page that failed,
   * so NOTICE replays the candidate itself before allowing approval.
   */
  previewResult: unknown[] | null;
  /** Diff or code-change summary, when present. */
  diff: unknown;
  /** Link into the Scraper Studio UI for the human reviewing this. */
  viewUrl: string | null;
  /** Everything the API returned, redacted, for the evidence record. */
  raw: unknown;
}

/** A normalized collector run result. */
export interface CollectorRunResult {
  collectorId: string;
  snapshotId: string;
  /** Requested URLs, in the order they were submitted. */
  inputUrls: string[];
  /** Rows returned. An empty array is a real, meaningful outcome. */
  rows: unknown[];
  /** Wall-clock duration of trigger plus polling, in milliseconds. */
  durationMs: number;
  /** Which template version was executed, when the caller specified one. */
  version: 'production' | 'dev';
}

/**
 * Which template a run should execute.
 *
 * `dev` targets the pending candidate produced by Self-Healing but not yet
 * approved. Whether this is reliably available is the single open question
 * that decides NOTICE's approval architecture, and it is answered by the
 * Phase 0 matrix rather than assumed here.
 */
export type TemplateVersion = 'production' | 'dev';
