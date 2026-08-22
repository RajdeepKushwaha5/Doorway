import { redact } from '../shared/index.js';
import { BrightDataRequestError, BrightDataTimeoutError } from './errors.js';
import { brightDataRequest, type RetryPolicy } from './http.js';
import {
  healRequestSchema,
  snapshotStatusSchema,
  triggerResponseSchema,
  type CollectorRunResult,
  type HealPhase,
  type HealProgress,
  type SnapshotState,
  type TemplateVersion,
} from './types.js';

export interface BrightDataClientConfig {
  apiKey: string;
  baseUrl?: string;
  /** Deadline for a single HTTP call. Not the deadline for a whole job. */
  requestTimeoutMs?: number;
  retryPolicy?: RetryPolicy;
  /** Structured logging hook. Receives already-redacted payloads. */
  onEvent?: (event: BrightDataClientEvent) => void;
}

export type BrightDataClientEvent =
  | { type: 'trigger'; collectorId: string; inputCount: number }
  | { type: 'poll'; snapshotId: string; attempt: number; status: string }
  | { type: 'heal_triggered'; collectorId: string; inputCount: number; promptLength: number }
  | { type: 'heal_progress'; collectorId: string; phase: HealPhase }
  | { type: 'approved'; collectorId: string }
  | { type: 'retry'; attempt: number; delayMs: number; reason: string };

const DEFAULT_BASE_URL = 'https://api.brightdata.com';
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** Values Bright Data uses to mean "not finished yet". */
const IN_PROGRESS_STATUSES = new Set(['building', 'running', 'pending', 'collecting', 'queued']);

/**
 * Typed client for the Scraper Studio API.
 *
 * Only the collection and Self-Healing surfaces are wrapped. Scraper creation
 * stays on the CLI, because that is the workflow the hackathon asks to see
 * driven from a coding agent.
 */
export class BrightDataClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #requestTimeoutMs: number;
  readonly #retryPolicy: RetryPolicy | undefined;
  readonly #onEvent: ((event: BrightDataClientEvent) => void) | undefined;

  constructor(config: BrightDataClientConfig) {
    if (config.apiKey.trim() === '') {
      throw new Error('BrightDataClient requires an API key');
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.#requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#retryPolicy = config.retryPolicy;
    this.#onEvent = config.onEvent;
  }

  /** Never let the key reach a log line, a snapshot or an error message. */
  toJSON(): Record<string, string> {
    return { baseUrl: this.#baseUrl, apiKey: '[REDACTED]' };
  }

  async #request(options: {
    method: 'GET' | 'POST';
    path: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<unknown> {
    return brightDataRequest(this.#apiKey, this.#baseUrl, {
      method: options.method,
      path: options.path,
      timeoutMs: this.#requestTimeoutMs,
      ...(options.query === undefined ? {} : { query: options.query }),
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(this.#retryPolicy === undefined ? {} : { retryPolicy: this.#retryPolicy }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onRetry: (attempt, delayMs, error) => {
        this.#onEvent?.({ type: 'retry', attempt, delayMs, reason: error.name });
      },
    });
  }

  /**
   * Queue inputs for a collector.
   *
   * @returns The snapshot identifier. The API calls this `collection_id` on
   *   the way out and `snapshot_id` on the way back in; it is normalized here
   *   so no caller has to remember that.
   */
  async triggerCollector(
    collectorId: string,
    inputs: readonly { url: string }[],
    options: { version?: TemplateVersion; signal?: AbortSignal } = {},
  ): Promise<string> {
    if (inputs.length === 0) {
      throw new BrightDataRequestError('triggerCollector requires at least one input', 400, '');
    }
    this.#onEvent?.({ type: 'trigger', collectorId, inputCount: inputs.length });

    const raw = await this.#request({
      method: 'POST',
      path: '/dca/trigger',
      query: {
        collector: collectorId,
        ...(options.version === 'dev' ? { version: 'dev' } : {}),
      },
      body: inputs.map((input) => ({ url: input.url })),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    return triggerResponseSchema.parse(raw).collection_id;
  }

  /**
   * Read a snapshot once.
   *
   * An array response means the job finished, including when that array is
   * empty. Treating `[]` as "still building" is the defect in Bright Data's
   * own boilerplate, and for a recall or availability feed an empty result is
   * a legitimate answer that must reach the classifier.
   */
  async fetchSnapshot(snapshotId: string, signal?: AbortSignal): Promise<SnapshotState> {
    const raw = await this.#request({
      method: 'GET',
      path: '/dca/dataset',
      query: { id: snapshotId },
      ...(signal === undefined ? {} : { signal }),
    });

    if (Array.isArray(raw)) return { kind: 'ready', rows: raw };

    const parsed = snapshotStatusSchema.safeParse(raw);
    if (parsed.success && IN_PROGRESS_STATUSES.has(parsed.data.status.toLowerCase())) {
      return { kind: 'building', status: parsed.data.status };
    }

    // A single object that is not a status envelope is a one-row result.
    if (raw !== null && typeof raw === 'object') return { kind: 'ready', rows: [raw] };

    return { kind: 'ready', rows: [] };
  }

  /**
   * Poll a snapshot until it is ready.
   *
   * @param timeoutMs Deadline for the whole job, distinct from the per-request
   *   timeout. Collector runs routinely outlast a single HTTP call.
   */
  async waitForSnapshot(
    snapshotId: string,
    options: { timeoutMs: number; pollIntervalMs?: number; signal?: AbortSignal },
  ): Promise<unknown[]> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const deadline = Date.now() + options.timeoutMs;
    let attempt = 0;

    for (;;) {
      const state = await this.fetchSnapshot(
        snapshotId,
        ...(options.signal === undefined ? [] : ([options.signal] as const)),
      );
      if (state.kind === 'ready') return state.rows;

      attempt += 1;
      this.#onEvent?.({ type: 'poll', snapshotId, attempt, status: state.status });

      if (Date.now() + pollIntervalMs > deadline) {
        throw new BrightDataTimeoutError(
          `snapshot ${snapshotId} still "${state.status}" after ${options.timeoutMs}ms`,
          options.timeoutMs,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /** Trigger a collector and wait for its rows. */
  async runCollector(
    collectorId: string,
    urls: readonly string[],
    options: {
      version?: TemplateVersion;
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<CollectorRunResult> {
    const startedAt = Date.now();
    const snapshotId = await this.triggerCollector(
      collectorId,
      urls.map((url) => ({ url })),
      {
        ...(options.version === undefined ? {} : { version: options.version }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );

    const rows = await this.waitForSnapshot(snapshotId, {
      timeoutMs: options.timeoutMs,
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    return {
      collectorId,
      snapshotId,
      inputUrls: [...urls],
      rows,
      durationMs: Date.now() - startedAt,
      version: options.version ?? 'production',
    };
  }

  /**
   * Ask Self-Healing to repair a collector.
   *
   * `incidentUrls` must lead with the page that actually failed. This is the
   * whole reason NOTICE talks to the API rather than the CLI: `bdata scraper
   * heal --url` sends `custom_input: []`, so the healer repairs blind.
   *
   * @throws If the prompt exceeds the API's 1000-character limit.
   */
  async triggerSelfHealing(
    collectorId: string,
    prompt: string,
    incidentUrls: readonly string[],
    signal?: AbortSignal,
  ): Promise<void> {
    const request = healRequestSchema.parse({
      prompt,
      custom_input: incidentUrls.map((url) => ({ url })),
    });

    this.#onEvent?.({
      type: 'heal_triggered',
      collectorId,
      inputCount: request.custom_input.length,
      promptLength: request.prompt.length,
    });

    try {
      await this.#request({
        method: 'POST',
        path: `/dca/collectors/${encodeURIComponent(collectorId)}/refactor_template`,
        body: request,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (caught) {
      // Bright Data refuses a second heal while a candidate is still waiting
      // at the approval gate, with a 409 and no explanation. Verified live on
      // 2026-08-16 against a collector holding a pending candidate.
      //
      // Worth translating, because the raw error sends an operator looking for
      // a fault in the heal they just requested, when the actual problem is a
      // decision nobody made on the previous one. The gate stays open until it
      // is answered.
      if (caught instanceof BrightDataRequestError && caught.status === 409) {
        throw new BrightDataRequestError(
          `collector ${collectorId} already has a repair waiting at the approval gate. ` +
            'Approve or reject it before requesting another; Bright Data allows only one open candidate.',
          409,
          '',
          caught,
        );
      }
      throw caught;
    }
  }

  /** Read the current state of a Self-Healing job. */
  /**
   * Create an empty scraper template, and get back the `c_*` id.
   *
   * Two calls make a scraper. This one reserves the collector and returns its
   * id; the AI generation that follows is what fills it in. They are separate
   * because generation runs to minutes, and a template that exists before it
   * starts is what lets the id be recorded, streamed and recovered if the
   * generation fails half way.
   *
   * The delivery webhook is a stub, exactly as the CLI leaves it. Nothing here
   * consumes deliveries: the collector is triggered directly and the rows are
   * read from the response, so a real endpoint would receive traffic nobody
   * reads.
   *
   * Shapes taken from the CLI's own request builders rather than guessed, for
   * the same reason the approval payload was: an invented field is rejected
   * with a validation error that names everything except the actual problem.
   */
  async createScraperTemplate(name: string, signal?: AbortSignal): Promise<string> {
    const raw = await this.#request({
      method: 'POST',
      path: '/dca/collector',
      body: {
        name,
        deliver: {
          type: 'webhook',
          endpoint: 'https://example.com/webhook',
          filename: { template: 'data', extension: 'json' },
        },
      },
      ...(signal === undefined ? {} : { signal }),
    });

    const id = (raw as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id === '') {
      // A template with no id is not a scraper, and returning silently would
      // leave the caller polling progress for a collector that does not exist.
      throw new BrightDataRequestError(
        'Bright Data created a scraper template without returning an id',
        502,
        JSON.stringify(raw).slice(0, 300),
      );
    }
    return id;
  }

  /**
   * Ask the AI to write the scraper, from a page and a description.
   *
   * Returns as soon as the job is accepted. Generation itself takes minutes,
   * which is why nothing here waits on it: the caller polls progress and is
   * free to do something else, and a UI built on this has to be a job with a
   * stream rather than a button that blocks.
   */
  async generateScraper(
    collectorId: string,
    url: string,
    description: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#request({
      method: 'POST',
      path: `/dca/collectors/${encodeURIComponent(collectorId)}/automate_template`,
      body: { description, urls: [url] },
      ...(signal === undefined ? {} : { signal }),
    });
  }

  /** How far the AI has got, in the same shape the heal flow reports. */
  async getGenerationProgress(collectorId: string, signal?: AbortSignal): Promise<HealProgress> {
    const raw = await this.#request({
      method: 'GET',
      path: `/dca/collectors/${encodeURIComponent(collectorId)}/automate_template/progress`,
      ...(signal === undefined ? {} : { signal }),
    });

    return normalizeHealProgress(raw);
  }

  async getHealProgress(collectorId: string, signal?: AbortSignal): Promise<HealProgress> {
    const raw = await this.#request({
      method: 'GET',
      path: `/dca/collectors/${encodeURIComponent(collectorId)}/refactor_template/progress`,
      ...(signal === undefined ? {} : { signal }),
    });

    return normalizeHealProgress(raw);
  }

  /**
   * Answer the Self-Healing approval gate.
   *
   * Payload shape confirmed against a live account on 2026-08-15. The endpoint
   * expects `{"message": boolean}`, where true accepts the proposed repair.
   * An earlier version of this method sent `{"action": "approve"}`, invented
   * rather than observed, and the API rejects it with:
   *
   *   {"validation_errors":["\"message\" is required","\"action\" is not allowed"]}
   *
   * `auto_save` is the part that actually promotes the template, and it
   * defaults to false. Approving without it resumes the job, returns HTTP 200
   * and reports `success: true`, and leaves production running the previous
   * template. That combination cost two days of investigation here: the
   * approval genuinely succeeded, so every signal available said the repair had
   * shipped, while a fresh trigger kept returning the old fields.
   *
   * Bright Data support confirmed the cause on 2026-08-18: "auto_save: true is
   * what saves the approved template automatically once the job completes
   * successfully. Since you didn't set it, the approved candidate may not have
   * been saved as production." It only takes effect when `message` is true and
   * the job succeeds, so it is sent only on acceptance.
   *
   * Deliberately unguarded at this layer. The safety policy lives in the
   * incident engine, which must have verified the candidate before calling it.
   */
  async #answerGate(collectorId: string, accept: boolean, signal?: AbortSignal): Promise<void> {
    await this.#request({
      method: 'POST',
      path: `/dca/collectors/${encodeURIComponent(collectorId)}/resume_automation_job`,
      body: accept ? { message: true, auto_save: true } : { message: false },
      ...(signal === undefined ? {} : { signal }),
    });
  }

  /** Accept a proposed repair. */
  async approveRepair(collectorId: string, signal?: AbortSignal): Promise<void> {
    await this.#answerGate(collectorId, true, signal);
    this.#onEvent?.({ type: 'approved', collectorId });
  }

  /**
   * Decline a proposed repair, leaving production untouched.
   *
   * The gate stays open until answered, so an unanswered incident blocks any
   * later heal on the same collector. Rejecting is how NOTICE clears a
   * candidate that failed verification.
   */
  async rejectRepair(collectorId: string, signal?: AbortSignal): Promise<void> {
    await this.#answerGate(collectorId, false, signal);
  }
}

/**
 * Coerce the Self-Healing progress envelope into a known shape.
 *
 * Kept permissive and total: the response shape is undocumented and has
 * changed, so unrecognized payloads become `pending` with the original
 * preserved on `raw`, rather than throwing and losing the evidence.
 */
export function normalizeHealProgress(raw: unknown): HealProgress {
  const record = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  // Shape observed against a live account on 2026-08-15, job ia_mstv19tu28te7z1nlp:
  //   { id, step, completed_steps[], status, diff{template_a,template_b},
  //     success, preview_result[] }
  //
  // The approval gate is signalled by `step`, not by `status`. An earlier
  // version of this function read only `status`, and "pending_answer" matched
  // none of its patterns, so a job sitting at the gate was reported as
  // `pending` and polled to timeout. Read `step` first.
  const step = String(record['step'] ?? '').toLowerCase();
  const statusText = String(record['status'] ?? record['state'] ?? '').toLowerCase();

  let phase: HealPhase;
  if (step === 'user_approval' || statusText === 'pending_answer') {
    phase = 'awaiting_approval';
  } else if (statusText.includes('reject')) {
    phase = 'rejected';
  } else if (record['success'] === false || statusText.includes('fail') || statusText.includes('error')) {
    phase = 'failed';
  } else if (statusText.includes('done') || statusText.includes('complete') || step === 'done') {
    phase = 'done';
  } else if (step !== '' || statusText.includes('run') || statusText.includes('progress')) {
    phase = 'running';
  } else {
    // Genuinely nothing recognizable. Distinct from "running" so a caller can
    // tell an unparsed payload from a job in flight, which is the failure the
    // previous version made invisible.
    phase = 'pending';
  }

  const preview = record['preview_result'] ?? record['previewResult'];

  return {
    phase,
    // The live API returns the job id as `id`, not `job_id`.
    jobId:
      typeof record['id'] === 'string'
        ? record['id']
        : typeof record['job_id'] === 'string'
          ? record['job_id']
          : null,
    previewResult: Array.isArray(preview) ? preview : null,
    diff: record['diff'] ?? record['changes'] ?? null,
    viewUrl: typeof record['view_url'] === 'string' ? record['view_url'] : null,
    raw: redact(raw),
  };
}
