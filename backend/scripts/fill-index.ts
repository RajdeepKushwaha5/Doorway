/**
 * Fill the index, once, so a search becomes a lookup.
 *
 * A student's search reads the index and tops it up live. With a few dozen
 * records in there, most profiles match nothing however well they describe
 * themselves, because a profile is a filter and you cannot filter your way to
 * more results. This is the other half: crawl broadly, keep everything, and let
 * the searching be fast and full afterwards.
 *
 * Breadth is the point rather than depth. One profile's crawl covers one
 * subject, and an index that only knows about artificial intelligence answers
 * one question well and every other question badly. The plan below spreads
 * across subjects and across all six opportunity types.
 *
 * Every fetch is a paid request, so this reports what it is spending as it goes
 * and merges after each run rather than at the end. A crawl that dies halfway
 * keeps what it found.
 *
 * Usage:  npm run index:fill -- [pagesPerRun]
 */

import { crawl } from '../src/crawl/crawler.js';
import { OpportunityIndex } from '../src/crawl/index-store.js';
import type { DoorwayProfile, OpportunityType } from '../src/doorway/types.js';

const ALL_TYPES: OpportunityType[] = [
  'scholarship',
  'fellowship',
  'internship',
  'research-program',
  'grant',
  'hackathon',
];

/**
 * The subjects to crawl for.
 *
 * Chosen to be what students actually study rather than what is fashionable,
 * and deliberately including the non-technical ones: an index that only knows
 * about machine learning is a worse product than one that also knows about
 * public health and law, and the second is where the long-tail funding nobody
 * finds tends to live.
 */
const PLAN: { interests: string[]; types: OpportunityType[]; country: string }[] = [
  { interests: ['artificial intelligence'], types: ALL_TYPES, country: 'India' },
  { interests: ['machine learning', 'data science'], types: ALL_TYPES, country: 'India' },
  { interests: ['computer science'], types: ['scholarship', 'fellowship', 'internship'], country: 'India' },
  { interests: ['engineering'], types: ['scholarship', 'internship', 'research-program'], country: 'India' },
  { interests: ['climate change', 'renewable energy'], types: ['fellowship', 'grant', 'research-program'], country: 'India' },
  { interests: ['public health', 'medicine'], types: ['scholarship', 'fellowship', 'research-program'], country: 'India' },
  { interests: ['public policy'], types: ['fellowship', 'internship', 'grant'], country: 'India' },
  { interests: ['biotechnology'], types: ['scholarship', 'research-program', 'grant'], country: 'India' },
  { interests: ['robotics'], types: ['hackathon', 'internship', 'fellowship'], country: 'India' },
  { interests: ['design'], types: ['scholarship', 'internship', 'hackathon'], country: 'India' },
  { interests: ['economics', 'social science'], types: ['scholarship', 'fellowship'], country: 'India' },
  // A little reach beyond one country, since much of the funding an Indian
  // student can win is administered elsewhere.
  { interests: ['artificial intelligence'], types: ['scholarship', 'fellowship'], country: 'United Kingdom' },
  { interests: ['computer science'], types: ['scholarship', 'fellowship'], country: 'Germany' },
];

async function main(): Promise<void> {
  const apiKey = process.env['BRIGHTDATA_API_KEY'];
  const zone = process.env['BRIGHTDATA_UNLOCKER_ZONE'];
  if (apiKey === undefined || zone === undefined) {
    process.stderr.write('BRIGHTDATA_API_KEY and BRIGHTDATA_UNLOCKER_ZONE must be set\n');
    process.exitCode = 1;
    return;
  }

  const perRun = Number(process.argv[2] ?? '160');
  const index = new OpportunityIndex(process.env['DOORWAY_INDEX_FILE']);
  const out = (line = ''): void => void process.stdout.write(`${line}\n`);

  const before = await index.stats();
  out(`Index before: ${String(before.total)} opportunities across ${String(before.hosts)} sites`);
  out(`Plan: ${String(PLAN.length)} crawls of up to ${String(perRun)} pages each`);
  out(`Upper bound on spend: about ${String(PLAN.length * (perRun + 8))} requests`);
  out('='.repeat(70));

  let fetched = 0;
  const started = Date.now();

  for (const [position, entry] of PLAN.entries()) {
    const profile: DoorwayProfile = {
      country: entry.country,
      educationLevel: 'Undergraduate',
      interests: entry.interests,
      skills: [],
      opportunityTypes: entry.types,
      fundingRequirement: 'any',
      locations: [],
    };

    out();
    out(`[${String(position + 1)}/${String(PLAN.length)}] ${entry.interests.join(', ')} in ${entry.country}`);

    try {
      const result = await crawl(
        { apiKey, zone, country: entry.country === 'India' ? 'in' : 'us' },
        profile,
        {
          limits: { maxFetches: perRun, maxPerHost: 20, maxDepth: 2 },
          concurrency: 60,
          onEvent: (event) => {
            if (event.step === 'done') out(`      ${event.line}`);
          },
        },
      );

      fetched += result.fetched;
      // Merged per run rather than at the end: a crawl that dies halfway
      // through the plan keeps everything it found.
      const merged = await index.merge(result.drafts);
      out(`      indexed: ${String(merged.added)} new, ${String(merged.refreshed)} refreshed`);
    } catch (error: unknown) {
      // One subject failing is not a reason to abandon the other twelve.
      out(`      failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const after = await index.stats();
  const minutes = Math.round((Date.now() - started) / 60_000);

  out();
  out('='.repeat(70));
  out(`  pages fetched     ${String(fetched)}`);
  out(`  time              ${String(minutes)} minutes`);
  out(`  index before      ${String(before.total)} opportunities, ${String(before.hosts)} sites`);
  out(`  index after       ${String(after.total)} opportunities, ${String(after.hosts)} sites`);
  out(`  with a deadline   ${String(after.withDeadline)}`);
  out(`  with funding      ${String(after.withFunding)}`);
  out('='.repeat(70));
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
