/**
 * Try discovery against the live web, once, and print what came back.
 *
 * Exists so the acquisition path can be judged on real pages before any of it
 * is wired to a button. Costs Web Unlocker requests: one per query plus one
 * per candidate page opened.
 *
 * Usage:  npm run discover:test
 */

import { discover } from '../src/acquire/index.js';
import type { DoorwayProfile } from '../src/doorway/types.js';

const PROFILE: DoorwayProfile = {
  country: 'India',
  educationLevel: 'Undergraduate',
  interests: ['artificial intelligence'],
  skills: [],
  opportunityTypes: ['scholarship', 'fellowship', 'internship', 'research-program'],
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

  const out = (line = ''): void => void process.stdout.write(`${line}\n`);

  const result = await discover(
    { apiKey, zone, country: 'in' },
    PROFILE,
    {
      maxPages: 18,
      maxTypes: 4,
      onEvent: (event) => out(`  ${event.line}`),
    },
  );

  out();
  out('Queries used:');
  for (const query of result.queries) out(`  ${query}`);

  out();
  out(`Opportunities found: ${String(result.drafts.length)} of ${String(result.considered)} pages`);
  for (const draft of result.drafts) {
    out();
    out(`  ${draft.title}`);
    out(`    provider  : ${draft.provider}`);
    out(`    type      : ${draft.type}${draft.official ? '  (official source)' : ''}`);
    out(`    deadline  : ${draft.deadlineRaw ?? 'not stated on the page'}`);
    out(`    funding   : ${draft.fundingLevel ?? 'not stated on the page'}`);
    out(`    url       : ${draft.sourceUrl}`);
    if (draft.missing.length > 0) out(`    missing   : ${draft.missing.join(', ')}`);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
