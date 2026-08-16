import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isModeId, type ModeId } from './modes';

/**
 * Which mode the live product page is currently serving.
 *
 * Backed by a file rather than a module variable so the mode survives a
 * process restart mid-demo. This is also why DriftMart must be deployed to a
 * host that runs a persistent instance rather than serverless functions: on
 * serverless, each invocation may get a fresh filesystem and the switch would
 * silently fail to take effect on some requests, which would look exactly like
 * a flaky scraper and waste an hour of debugging on demo day.
 */

const STATE_FILE = join(process.cwd(), '.driftmart-mode');
const DEFAULT_MODE: ModeId = 'baseline';

let cached: ModeId | null = null;

export async function getCurrentMode(): Promise<ModeId> {
  if (cached !== null) return cached;
  try {
    const raw = (await readFile(STATE_FILE, 'utf8')).trim();
    cached = isModeId(raw) ? raw : DEFAULT_MODE;
  } catch {
    cached = DEFAULT_MODE;
  }
  return cached;
}

export async function setCurrentMode(mode: ModeId): Promise<void> {
  cached = mode;
  await writeFile(STATE_FILE, mode, 'utf8');
}

/**
 * Guard for the mode-switch endpoint.
 *
 * DriftMart is public so Bright Data's infrastructure can reach it, which
 * means anyone can reach it. Without a token, a passer-by could flip the mode
 * mid-run and NOTICE would record an incident nobody triggered.
 */
export function isAuthorized(header: string | null): boolean {
  const expected = process.env['DRIFTMART_ADMIN_TOKEN'];
  if (expected === undefined || expected.trim() === '') return false;
  if (header === null) return false;

  const supplied = header.replace(/^Bearer\s+/i, '');
  if (supplied.length !== expected.length) return false;

  // Constant-time comparison. The timing signal here is small, but a public
  // endpoint that leaks its own token length and prefix is avoidable.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
