import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CollectorRecord, Store } from './types.js';

/**
 * Restore the monitored fleet when the store comes up empty.
 *
 * Free hosting tiers have no persistent disk, so the store resets on every
 * restart and every wake from idle. That turns a deployed dashboard into one
 * that is usually empty, and an empty dashboard is indistinguishable from a
 * broken product to anyone arriving at the link.
 *
 * Seeding is deliberately narrow. It runs only when there are no collectors at
 * all, so it can never overwrite a fleet somebody curated, and it registers
 * them without running them, because a run costs page loads from the account's
 * monthly allowance and a restart should not quietly spend it.
 *
 * The file holds collector definitions, which are configuration rather than
 * secrets: a `c_...` id, a URL and a description of what each field means.
 */

export interface SeedResult {
  seeded: number;
  reason: 'seeded' | 'store-not-empty' | 'no-seed-file' | 'unreadable';
}

/** Fields a seed entry must carry. The rest of a record is derived. */
type SeedEntry = Omit<CollectorRecord, 'id' | 'status' | 'acquisitionContext' | 'createdAt'>;

export async function seedCollectors(
  store: Store,
  path: string | undefined,
  now: () => Date = () => new Date(),
): Promise<SeedResult> {
  if (path === undefined || path.trim() === '') return { seeded: 0, reason: 'no-seed-file' };

  const existing = await store.listCollectors();
  if (existing.length > 0) return { seeded: 0, reason: 'store-not-empty' };

  let entries: SeedEntry[];
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(parsed)) return { seeded: 0, reason: 'unreadable' };
    entries = parsed as SeedEntry[];
  } catch {
    // A missing or malformed seed file must not stop the server starting. An
    // API that refuses to boot over optional demo data is worse than an empty
    // dashboard.
    return { seeded: 0, reason: 'unreadable' };
  }

  let seeded = 0;
  for (const entry of entries) {
    if (typeof entry?.brightDataCollectorId !== 'string') continue;
    const collector: CollectorRecord = {
      ...entry,
      id: randomUUID(),
      status: 'active',
      acquisitionContext: {},
      createdAt: now().toISOString(),
    };
    await store.saveCollector(collector);
    seeded += 1;
  }

  return { seeded, reason: 'seeded' };
}
