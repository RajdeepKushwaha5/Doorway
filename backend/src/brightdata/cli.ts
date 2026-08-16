import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BrightDataCliError } from './errors.js';
import type { TemplateVersion } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Wrapper around the `bdata` CLI.
 *
 * Every invocation passes arguments as an array through `execFile`, never as a
 * shell string. Target URLs and field descriptions reach these functions from
 * user input and from scraped pages, and string interpolation into a shell is
 * how that becomes command injection.
 *
 * The CLI is used where the hackathon wants it visible, which is scraper
 * creation, ad-hoc runs and the witness fetch. Self-Healing goes through the
 * API instead, because the CLI does not forward incident inputs.
 */
export interface CliOptions {
  /** Executable name or path. Override for a pinned local install. */
  binary?: string;
  /** Kill the process after this many milliseconds. */
  timeoutMs?: number;
  /** Extra environment, merged over the current process environment. */
  env?: Record<string, string>;
  /** Cap on captured output, guarding against a runaway response. */
  maxBufferBytes?: number;
}

const DEFAULT_BINARY = 'bdata';
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/** Collector IDs are `c_` followed by alphanumerics. Validated before use. */
const COLLECTOR_ID = /^c_[a-z0-9]+$/i;

function assertCollectorId(collectorId: string): void {
  if (!COLLECTOR_ID.test(collectorId)) {
    throw new BrightDataCliError(
      `refusing to run with a malformed collector id: ${collectorId}`,
      null,
      '',
    );
  }
}

function assertPublicHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BrightDataCliError(`refusing to run with a malformed URL: ${url}`, null, '');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BrightDataCliError(
      `refusing a non-HTTP target: ${parsed.protocol}//${parsed.host}`,
      null,
      '',
    );
  }
}

async function runCli(args: readonly string[], options: CliOptions): Promise<string> {
  const binary = options.binary ?? DEFAULT_BINARY;
  try {
    const { stdout } = await execFileAsync(binary, [...args], {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      // No `shell: true`. Arguments stay an array so nothing is interpreted.
    });
    return stdout;
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException & { stderr?: string; code?: number | string };
    if (error.code === 'ENOENT') {
      throw new BrightDataCliError(
        `\`${binary}\` was not found on PATH. Install it with \`npm i -g @brightdata/cli\` and run \`${binary} login\`.`,
        null,
        '',
      );
    }
    throw new BrightDataCliError(
      `\`${binary} ${args[0] ?? ''}\` failed`,
      typeof error.code === 'number' ? error.code : null,
      error.stderr ?? String(error.message ?? ''),
    );
  }
}

/** Extract the first `c_...` identifier from CLI output. */
function extractCollectorId(output: string): string | null {
  const match = /\bc_[a-z0-9]+\b/i.exec(output);
  return match?.[0] ?? null;
}

/**
 * Parse CLI stdout that should contain JSON.
 *
 * The CLI interleaves progress lines with the payload, so this scans for the
 * outermost JSON value rather than assuming stdout is clean.
 */
export function parseCliJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed === '') return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to scanning.
  }

  const firstArray = trimmed.indexOf('[');
  const firstObject = trimmed.indexOf('{');
  const start =
    firstArray === -1 ? firstObject : firstObject === -1 ? firstArray : Math.min(firstArray, firstObject);
  if (start === -1) return null;

  const closer = trimmed[start] === '[' ? ']' : '}';
  const end = trimmed.lastIndexOf(closer);
  if (end <= start) return null;

  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface CreateScraperResult {
  collectorId: string;
  /** Full CLI transcript, kept for the incident receipt and the demo. */
  transcript: string;
}

/**
 * Create a custom Scraper Studio collector.
 *
 * Takes five to fifteen minutes. The default timeout allows for that.
 *
 * @param description Plain-language field description. This is the durable
 *   artifact: Self-Healing repairs extraction against this text, so the
 *   selector is disposable and this sentence is not.
 */
export async function createScraper(
  targetUrl: string,
  description: string,
  options: CliOptions = {},
): Promise<CreateScraperResult> {
  assertPublicHttpUrl(targetUrl);
  if (description.trim() === '') {
    throw new BrightDataCliError('createScraper requires a field description', null, '');
  }

  const transcript = await runCli(['scraper', 'create', targetUrl, description], options);
  const collectorId = extractCollectorId(transcript);
  if (collectorId === null) {
    throw new BrightDataCliError(
      'scraper create completed but no collector id was found in its output',
      null,
      transcript.slice(0, 2000),
    );
  }
  return { collectorId, transcript };
}

/**
 * Run a collector through the CLI.
 *
 * `version: 'dev'` targets the pending, unapproved candidate. Whether that is
 * reliably honoured is what the Phase 0 matrix determines; nothing in NOTICE
 * should assume it works until that has been answered on a real collector.
 */
export async function runScraper(
  collectorId: string,
  urls: readonly string[],
  options: CliOptions & { version?: TemplateVersion } = {},
): Promise<{ rows: unknown[]; transcript: string }> {
  assertCollectorId(collectorId);
  for (const url of urls) assertPublicHttpUrl(url);
  if (urls.length === 0) {
    throw new BrightDataCliError('runScraper requires at least one URL', null, '');
  }

  const args = ['scraper', 'run', collectorId, ...urls];
  if (options.version === 'dev') args.push('--version=dev');
  args.push('--pretty');

  const transcript = await runCli(args, options);
  const parsed = parseCliJson(transcript);

  if (Array.isArray(parsed)) return { rows: parsed, transcript };
  if (parsed !== null && typeof parsed === 'object') return { rows: [parsed], transcript };
  return { rows: [], transcript };
}

/**
 * Fetch a page as markdown through the Unlocker path.
 *
 * This is the independent witness. It shares no selector logic with the
 * collector, which is exactly why it can still see the page when the
 * collector has drifted. Two sensors on one platform, checking each other.
 */
export async function scrapeMarkdown(
  url: string,
  options: CliOptions = {},
): Promise<{ markdown: string; fetchedAt: string }> {
  assertPublicHttpUrl(url);
  const markdown = await runCli(['scrape', url, '--format', 'markdown'], {
    timeoutMs: 120_000,
    ...options,
  });
  return { markdown, fetchedAt: new Date().toISOString() };
}

/** Read account balance and per-zone spend, for the cost panel. */
export async function readBudget(options: CliOptions = {}): Promise<unknown> {
  const stdout = await runCli(['budget', '--format', 'json'], { timeoutMs: 60_000, ...options });
  return parseCliJson(stdout);
}

/** Report the CLI version, used as a startup preflight check. */
export async function cliVersion(options: CliOptions = {}): Promise<string> {
  const stdout = await runCli(['--version'], { timeoutMs: 30_000, ...options });
  return stdout.trim();
}
