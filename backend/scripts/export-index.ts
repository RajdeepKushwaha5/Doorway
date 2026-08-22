/**
 * Ship the index with the code.
 *
 * The deployment target has no persistent disk, so a filled index lives exactly
 * until the next restart. Committing it is the difference between a deploy that
 * comes up useful and one that comes up empty and stays that way until somebody
 * pays for a crawl.
 *
 * What gets written is real crawl output. Every record was fetched from a live
 * page through Bright Data and passed the same checks as anything found at
 * runtime, so this is shipping a cache rather than seeding a demo. Records that
 * have since expired are dropped on the way out: a deadline that has passed is
 * not worth carrying into a deploy, and a stale one is worse than a missing one.
 *
 * Usage:  npm run index:export
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OpportunityIndex } from '../src/crawl/index-store.js';
import { deadlineHasPassed } from '../src/acquire/dates.js';

async function main(): Promise<void> {
  const index = new OpportunityIndex(process.env['DOORWAY_INDEX_FILE']);
  const target = process.env['DOORWAY_INDEX_SEED'] ?? join(process.cwd(), '..', 'seed-index.json');

  const all = await index.all();
  const live = all.filter(
    (record) =>
      !deadlineHasPassed(record.deadlineRaw) && record.applicationStatus !== 'closed',
  );

  await writeFile(target, `${JSON.stringify(live, null, 0)}\n`, 'utf8');

  const out = (line = ''): void => void process.stdout.write(`${line}\n`);
  out(`  index holds     ${String(all.length)} records`);
  out(`  dropped closed  ${String(all.length - live.length)}`);
  out(`  written         ${String(live.length)} to ${target}`);
  out(`  sites           ${String(new Set(live.map((record) => record.host)).size)}`);
  out(`  with a deadline ${String(live.filter((record) => record.deadlineRaw !== null).length)}`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
