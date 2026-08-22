import { randomUUID } from 'node:crypto';
import { composeBrief } from '../acquire/compose.js';
import type { BrightDataClient } from '../brightdata/index.js';
import type { CollectorRecord, Store } from '../store/index.js';
import type { WitnessFieldSpec } from '../witness/spec.js';
import type { ObserveEmitter } from './events.js';

/**
 * Build a sensor for a page nobody has watched before.
 *
 * Scraper Studio is usually something you used last week to make a handful of
 * collectors. This makes it something the product calls when it meets a page
 * it has no sensor for, which is the difference between having used a platform
 * and building on one.
 *
 * The order matters and is not the obvious one. The page is read first, with
 * the same Web Unlocker path the witness uses, so the brief is composed from
 * what is actually there rather than from what a URL suggests. A scraper built
 * from a guess is a scraper nobody can defend.
 *
 * Generation runs to minutes rather than seconds. Everything here therefore
 * reports progress as it goes and returns an id early, because the honest
 * alternative is an interface that looks broken for seven minutes.
 */

export interface ManufactureInput {
  url: string;
  client: BrightDataClient;
  store: Store;
  /** Reads the page. The same function the witness uses, injected for tests. */
  readPage: (url: string) => Promise<{ markdown: string }>;
  emit: ObserveEmitter;
  /** How long to wait for generation before giving up. */
  timeoutMs?: number;
  /** Poll interval, small in tests. */
  pollMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ManufactureResult {
  collector: CollectorRecord;
  brightDataCollectorId: string;
  description: string;
  generationSeconds: number;
}

const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const DEFAULT_POLL_MS = 10_000;

/**
 * Witness specs derived from what the page showed.
 *
 * Only for fields the page actually carries. A spec for a value that is not
 * there produces a witness that reports nothing, and with `requiredOnPage`
 * that becomes an accusation against a collector on its first run.
 */
function specsFor(brief: ReturnType<typeof composeBrief>): WitnessFieldSpec[] {
  const specs: WitnessFieldSpec[] = [];
  const closing = brief.dates.find((date) => date.closing);

  if (closing !== undefined) {
    specs.push({
      path: 'deadline_raw',
      meaning: `The date applications close, from the label "${closing.label}".`,
      labels: [closing.label],
      excludeLabels: brief.dates.filter((date) => !date.closing).map((date) => date.label),
      kind: 'text',
      allowed: [],
      shape: 'date',
    });
  }

  if (brief.hasApplyLink) {
    specs.push({
      path: 'application_url',
      meaning: 'Where a student goes to apply. The page must show this.',
      labels: ['apply', 'application', 'start application'],
      excludeLabels: ['contact', 'enquire'],
      kind: 'text',
      allowed: [],
      shape: 'url',
      requiredOnPage: true,
    });
  }

  return specs;
}

/** The step Bright Data names, when it names one. */
function stepName(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const step = (raw as Record<string, unknown>)['step'];
  return typeof step === 'string' && step.trim() !== '' ? step : null;
}

export async function manufactureCollector(
  input: ManufactureInput,
): Promise<ManufactureResult> {
  const now = input.now ?? (() => Date.now());
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = input.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = now();

  input.emit({ step: 'reading', line: `reading ${input.url} through Web Unlocker`, detail: {} });
  const { markdown } = await input.readPage(input.url);
  input.emit({
    step: 'read',
    line: `read ${String(Math.round(markdown.length / 1024))} KB of markdown`,
    detail: { characters: markdown.length },
  });

  input.emit({ step: 'composing', line: 'deciding what this page is worth extracting', detail: {} });
  const brief = composeBrief(markdown, input.url);
  for (const observation of brief.observations) {
    input.emit({ step: 'composing', line: `saw   ${observation}`, detail: {} });
  }
  input.emit({
    step: 'brief',
    line: `brief (${String(brief.description.length)} chars) ${brief.description}`,
    detail: { description: brief.description, protectedBecause: brief.protectedBecause },
  });

  const name = `doorway-${new URL(input.url).hostname.replace(/[^a-z0-9]+/gi, '-')}-${String(
    Math.floor(startedAt / 1000),
  )}`;
  const brightDataCollectorId = await input.client.createScraperTemplate(name, input.signal);
  input.emit({
    step: 'template',
    line: `template created  ${brightDataCollectorId}`,
    detail: { brightDataCollectorId },
  });

  await input.client.generateScraper(
    brightDataCollectorId,
    input.url,
    brief.description,
    input.signal,
  );
  input.emit({
    step: 'generating',
    line: 'Scraper Studio is writing the scraper, this takes minutes',
    detail: { brightDataCollectorId },
  });

  /*
   * Poll rather than wait.
   *
   * The API reports a phase per step, and reporting them is most of the value
   * of watching: a viewer who sees `planner` then `code_fixer` understands
   * something is happening to their page, where a spinner for seven minutes
   * looks like a hang.
   */
  let lastStep = '';
  for (;;) {
    if (now() - startedAt > timeoutMs) {
      throw new Error(
        `Scraper Studio did not finish generating within ${String(Math.round(timeoutMs / 60000))} minutes`,
      );
    }

    await sleep(pollMs);
    const progress = await input.client.getGenerationProgress(brightDataCollectorId, input.signal);

    /*
     * Report the named step, not the normalised phase.
     *
     * Every intermediate phase normalises to `running`, so reporting that
     * prints the same line forever. The API's own `step` field names what is
     * happening to the page: planner, then control_preview_runner, then
     * code_fixer. Somebody watching a seven minute job needs to see it move.
     */
    const named = stepName(progress.raw) ?? progress.phase;
    if (named !== lastStep) {
      lastStep = named;
      input.emit({
        step: 'generating',
        line: `step  ${named}`,
        detail: { phase: progress.phase, step: named },
      });
    }

    if (progress.phase === 'done') break;
    if (progress.phase === 'failed') {
      throw new Error(`Scraper Studio could not build a scraper for ${input.url}`);
    }
  }

  const generationSeconds = Math.round((now() - startedAt) / 1000);
  input.emit({
    step: 'generated',
    line: `scraper ready in ${String(generationSeconds)}s`,
    detail: { brightDataCollectorId, generationSeconds },
  });

  const specs = specsFor(brief);
  const collector: CollectorRecord = {
    id: randomUUID(),
    brightDataCollectorId,
    name,
    targetDomain: new URL(input.url).hostname,
    status: 'active',
    schedule: null,
    watchUrls: [input.url],
    witnessSpecs: specs,
    invariants: [],
    /*
     * Only protect what a second sensor can actually read.
     *
     * Protecting a field nobody witnesses is the exact gap that let a listing
     * with no way to apply be published as confirmed, and registration refuses
     * it now. Deriving both lists from the same brief keeps them in step by
     * construction rather than by discipline.
     */
    protectedFields: specs.map((spec) => spec.path),
    goldenCases: [],
    acquisitionContext: {},
    autoPromote: 'never',
    freshnessMinutes: null,
    currency: null,
    provenance: {
      sourceUrl: input.url,
      description: brief.description,
      observations: brief.observations,
      protectedBecause: Object.fromEntries(
        Object.entries(brief.protectedBecause).filter(([field]) =>
          specs.some((spec) => spec.path === field),
        ),
      ),
      createdBy: 'coding_agent',
      createdAt: new Date(startedAt).toISOString(),
      generationSeconds,
    },
    createdAt: new Date(startedAt).toISOString(),
  } as CollectorRecord;

  await input.store.saveCollector(collector);
  input.emit({
    step: 'registered',
    line: `registered as ${collector.id} with ${String(specs.length)} witness spec${specs.length === 1 ? '' : 's'}`,
    detail: { collectorId: collector.id, brightDataCollectorId },
  });

  return { collector, brightDataCollectorId, description: brief.description, generationSeconds };
}
