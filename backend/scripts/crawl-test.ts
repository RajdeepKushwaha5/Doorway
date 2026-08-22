/**
 * Run a real crawl and report what it reached.
 *
 * Costs one Web Unlocker request per page fetched, so the ceiling is an
 * argument rather than a suggestion. Pass a number to change it.
 *
 * Usage:  npm run crawl:test -- 200
 */

import { crawl } from '../src/crawl/crawler.js';
import type { DoorwayProfile } from '../src/doorway/types.js';

const PROFILE: DoorwayProfile = {
  country: 'India',
  educationLevel: 'Undergraduate',
  interests: ['artificial intelligence'],
  skills: [],
  opportunityTypes: ['scholarship', 'fellowship', 'internship', 'research-program', 'grant', 'hackathon'],
  fundingRequirement: 'full',
  locations: [],
};

async function main(): Promise<void> {
  const apiKey = process.env['BRIGHTDATA_API_KEY'];
  const zone = process.env['BRIGHTDATA_UNLOCKER_ZONE'];
  if (apiKey === undefined || zone === undefined) {
    process.stderr.write('BRIGHTDATA_API_KEY and BRIGHTDATA_UNLOCKER_ZONE must be set\n');
    process.exitCode = 1;
    return;
  }

  const maxFetches = Number(process.argv[2] ?? '150');
  const out = (line = ''): void => void process.stdout.write(`${line}\n`);
  const started = Date.now();

  const result = await crawl(
    { apiKey, zone, country: 'in' },
    PROFILE,
    {
      limits: { maxFetches, maxPerHost: 30, maxDepth: 2 },
      concurrency: 60,
      onEvent: (event) => {
        // The per-page chatter is noise at this volume. Milestones only.
        if (event.step === 'kept' || event.step === 'dropped') return;
        out(`  ${event.line}`);
      },
    },
  );

  const seconds = Math.round((Date.now() - started) / 1000);

  out();
  out('='.repeat(64));
  out(`  pages fetched     ${String(result.fetched)}`);
  out(`  distinct sites    ${String(result.hosts)}`);
  out(`  links harvested   ${String(result.harvested)}`);
  out(`  opportunities     ${String(result.drafts.length)}`);
  out(`  wall clock        ${String(seconds)}s`);
  out(
    `  throughput        ${seconds === 0 ? 'n/a' : (result.fetched / seconds).toFixed(1)} pages/second`,
  );
  out('='.repeat(64));

  out();
  for (const draft of result.drafts.slice(0, 30)) {
    out(`  ${draft.title.slice(0, 62)}`);
    out(`     ${draft.host}  |  ${draft.deadlineRaw ?? 'no deadline stated'}`);
  }
  if (result.drafts.length > 30) {
    out(`  ... and ${String(result.drafts.length - 30)} more`);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
