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

/** How many times to ask a fresh scraper what its output looks like. */
const SCHEMA_ATTEMPTS = 3;
const SCHEMA_RETRY_MS = 20_000;

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

/**
 * Match a derived spec onto the field name the scraper actually produced.
 *
 * Scraper Studio names its own output. Asking for a closing date returns
 * `application_deadline` on one page and `deadline` on another, and a witness
 * spec keyed to a name nobody chose reads nothing at all.
 *
 * The first manufactured collector proved this the expensive way: it returned
 * `application_deadline` and `apply_url`, the derived specs said `deadline_raw`
 * and `application_url`, the witness therefore read neither, and the record
 * published as verified. Specs have to be written against the schema that
 * exists rather than the one the rest of this codebase happens to use.
 */
function matchPath(want: string, actual: readonly string[]): string | null {
  const patterns: Record<string, RegExp> = {
    deadline_raw: /(deadline|closing|close|apply_by|last_date)/i,
    application_url: /(apply|application).*(url|link)|^(apply_url|application_url)$/i,
  };

  const exact = actual.find((field) => field === want);
  if (exact !== undefined) return exact;

  const pattern = patterns[want];
  if (pattern === undefined) return null;

  // Longest match last, so a field literally named for the thing beats one
  // that merely mentions it.
  const candidates = actual.filter((field) => pattern.test(field) && field !== 'input');
  return candidates[0] ?? null;
}

/**
 * Point the derived specs at the fields the scraper really returns.
 *
 * A spec that cannot be matched is dropped rather than kept pointing at
 * nothing. Keeping it would mean protecting a field no sensor can read, which
 * is the arrangement that published a listing with no way to apply.
 */
export function alignSpecs(
  specs: readonly WitnessFieldSpec[],
  row: unknown,
): WitnessFieldSpec[] {
  /*
   * No schema means no specs, not the guessed ones.
   *
   * Returning the derived paths when the scraper could not be run would key a
   * second sensor to names nobody chose, which is precisely the failure this
   * function exists to prevent. A collector with no witness specs is honest
   * about being unwatched; one with wrong specs claims a second sensor that
   * reads nothing.
   */
  if (row === null || typeof row !== 'object') return [];
  const actual = Object.keys(row as Record<string, unknown>);

  const aligned: WitnessFieldSpec[] = [];
  for (const spec of specs) {
    const path = matchPath(spec.path, actual);
    if (path === null) continue;
    aligned.push({ ...spec, path });
  }
  return aligned;
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

  /*
   * Run it once before writing its specs.
   *
   * You cannot write a witness spec for a schema you have not seen. Scraper
   * Studio names its own output, so the only honest way to key a second sensor
   * to a field is to look at what the first one actually produced, which costs
   * one run and buys a collector whose two sensors are talking about the same
   * things.
   */
  input.emit({ step: 'generating', line: 'running it once to learn its schema', detail: {} });
  let firstRow: unknown = null;
  try {
    /*
     * Retry, because a scraper is not runnable the instant it is generated.
     *
     * Measured: the run issued immediately after `collector_mainatiner`
     * returned no rows, and the same collector answered normally a minute
     * later. Taking the first empty answer as the schema meant registering a
     * collector with no witness specs and no second sensor, which is honest
     * and is not what anybody wanted.
     */
    for (let attempt = 1; attempt <= SCHEMA_ATTEMPTS; attempt += 1) {
      const rows = await input.client.runCollector(brightDataCollectorId, [input.url], {
        timeoutMs: 180_000,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      const candidate = Array.isArray(rows) ? rows[0] : null;
      const fields = Object.keys((candidate ?? {}) as Record<string, unknown>).filter(
        (key) => key !== 'input',
      );
      if (fields.length > 0) {
        firstRow = candidate;
        input.emit({
          step: 'generated',
          line: `schema  ${fields.join(', ')}`,
          detail: { fields },
        });
        break;
      }
      if (attempt < SCHEMA_ATTEMPTS) {
        input.emit({
          step: 'generating',
          line: `no rows yet, waiting before asking again (${String(attempt)}/${String(SCHEMA_ATTEMPTS)})`,
          detail: { attempt },
        });
        await sleep(SCHEMA_RETRY_MS);
      }
    }
  } catch (error) {
    /*
     * A scraper that will not run is still worth registering.
     *
     * It has an id, a brief and a page, and whoever looks at it next needs all
     * three. What it does not get is witness specs invented from a schema
     * nobody saw, so it registers with none and says so.
     */
    input.emit({
      step: 'generating',
      line: `could not run it yet: ${error instanceof Error ? error.message : String(error)}`,
      detail: {},
    });
  }

  const wanted = specsFor(brief);
  const specs = alignSpecs(wanted, firstRow);
  /*
   * Keep the intent when the schema could not be read.
   *
   * A scraper is not runnable for a minute or two after it is generated, and
   * waiting on that inside manufacture means waiting on something that may
   * never answer. The first run that returns rows promotes these.
   */
  const pending = specs.length === 0 && wanted.length > 0 ? wanted : undefined;
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
    ...(pending === undefined ? {} : { pendingWitnessSpecs: pending }),
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
    line:
      specs.length === 0
        ? `registered as ${collector.id}, schema not readable yet, so the second sensor starts on its first successful run`
        : `registered as ${collector.id}, second sensor watching ${specs.map((s) => s.path).join(', ')}`,
    detail: { collectorId: collector.id, brightDataCollectorId, witnessing: specs.map((s) => s.path) },
  });

  return { collector, brightDataCollectorId, description: brief.description, generationSeconds };
}
