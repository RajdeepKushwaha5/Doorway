import { createHash } from 'node:crypto';
import type { CollectorRecord, IncidentRecord, VerifiedSnapshot } from '../store/index.js';
import type { Opportunity, OpportunityType } from './types.js';

const TYPES = new Set<OpportunityType>([
  'scholarship',
  'fellowship',
  'internship',
  'grant',
  'hackathon',
  'research-program',
]);

export function opportunitiesFromSnapshots(
  snapshots: VerifiedSnapshot[],
  collectors: CollectorRecord[],
  incidents: IncidentRecord[],
  now = Date.now(),
): Opportunity[] {
  const byCollector = new Map(collectors.map((collector) => [collector.id, collector]));
  const records: Opportunity[] = [];

  /*
   * The fault fixture is not somebody's opportunity.
   *
   * A controlled page we host exists so the proof walkthrough can break it on
   * demand. It is a real Scraper Studio collector reading a real page, so it
   * belongs in the engine and on /proof, and it verified cleanly enough that it
   * arrived in a student's results alongside genuine fellowships, offering a
   * door that leads to a page we wrote.
   *
   * Labelling it "controlled fixture" in the provider name was not enough. A
   * student scanning a list reads titles and deadlines, and by the time they
   * notice the label they have already clicked. So it is kept out of the world
   * entirely and stays where it is useful.
   */
  const labHost = (process.env['DOORWAY_LAB_HOST'] ?? '').trim().toLowerCase();

  for (const snapshot of snapshots) {
    const collector = byCollector.get(snapshot.collectorId);
    if (collector === undefined) continue;
    if (labHost !== '' && collector.targetDomain.trim().toLowerCase() === labHost) continue;
    const rows = Array.isArray(snapshot.data) ? snapshot.data : [snapshot.data];
    for (const row of rows) {
      const parsed = parseOpportunity(row, collector, snapshot, incidents, now);
      if (parsed !== null) records.push(parsed);
    }
  }

  return deduplicate(records).sort((a, b) => {
    const aTime = a.deadline === null ? Number.POSITIVE_INFINITY : Date.parse(a.deadline);
    const bTime = b.deadline === null ? Number.POSITIVE_INFINITY : Date.parse(b.deadline);
    return aTime - bTime;
  });
}

function parseOpportunity(
  value: unknown,
  collector: CollectorRecord,
  snapshot: VerifiedSnapshot,
  incidents: IncidentRecord[],
  now: number,
): Opportunity | null {
  if (!isRecord(value)) return null;
  const title = text(value, ['title', 'opportunity_title', 'name']);
  const provider = text(value, ['provider', 'organization', 'organisation', 'host']);
  const applicationUrl = url(value, ['application_url', 'apply_url', 'url']) ?? snapshot.url;
  if (title === null || provider === null || applicationUrl === null) return null;

  const rawType = (text(value, ['opportunity_type', 'type', 'category']) ?? '').toLowerCase();
  const type = TYPES.has(rawType as OpportunityType)
    ? (rawType as OpportunityType)
    : inferType(`${title} ${rawType}`);
  if (type === null) return null;

  const openIncident = incidents.find(
    (incident) =>
      incident.collectorId === collector.id &&
      incident.quarantined &&
      incident.resolvedAt === null &&
      (incident.witness === null || incident.witness.url === snapshot.url),
  );
  const ageMs = now - Date.parse(snapshot.verifiedAt);
  const staleAfterMs = (collector.freshnessMinutes ?? 24 * 60) * 60_000;
  const confirmedBy = snapshot.confirmedBy ?? 'contract_only';
  const status =
    openIncident !== undefined
      ? 'quarantined'
      : ageMs > staleAfterMs
        ? 'stale'
        : confirmedBy === 'two_sensors'
          ? 'verified'
          : 'partially_verified';

  const fundingRecord = record(value['funding']);
  const amount = number(value, ['funding_amount', 'amount']) ?? nestedNumber(fundingRecord, 'amount');
  const currency =
    text(value, ['funding_currency', 'currency']) ?? nestedText(fundingRecord, 'currency');
  const coverage = unique([
    ...strings(value, ['funding_coverage', 'coverage']),
    ...nestedStrings(fundingRecord, 'coverage'),
  ]);
  const fundingLevel = inferFundingLevel(
    `${text(value, ['funding_level']) ?? ''} ${coverage.join(' ')} ${text(value, ['summary']) ?? ''}`,
    coverage,
  );

  const deadlineRaw = text(value, ['deadline_raw', 'application_deadline', 'deadline']);
  const deadline = isoDate(text(value, ['deadline', 'application_deadline']));
  const sourceKey = `${collector.id}:${snapshot.url}:${title}:${provider}`;

  return {
    id: createHash('sha256').update(sourceKey).digest('hex').slice(0, 18),
    collectorId: collector.id,
    sourceUrl: snapshot.url,
    title,
    provider,
    type,
    summary: text(value, ['summary', 'description']) ?? '',
    eligibility: strings(value, ['eligibility', 'eligibility_rules', 'requirements']),
    interests: strings(value, ['interests', 'fields', 'subjects', 'categories']),
    funding: {
      amount,
      currency: currency?.toUpperCase() ?? null,
      coverage,
      level: fundingLevel,
    },
    deadline,
    deadlineRaw,
    locations: strings(value, ['locations', 'location', 'countries']),
    remote: boolean(value, ['remote', 'is_remote']),
    requiredDocuments: strings(value, ['required_documents', 'documents']),
    applicationUrl,
    trust: {
      status,
      confirmedBy,
      lastVerifiedAt: snapshot.verifiedAt,
      incidentId: openIncident?.id ?? null,
      fieldsDegraded: openIncident?.affectedFields ?? [],
    },
  };
}

function deduplicate(opportunities: Opportunity[]): Opportunity[] {
  const byKey = new Map<string, Opportunity>();
  for (const opportunity of opportunities) {
    const key = `${opportunity.title.toLowerCase()}::${opportunity.provider.toLowerCase()}`;
    const existing = byKey.get(key);
    if (
      existing === undefined ||
      Date.parse(opportunity.trust.lastVerifiedAt) > Date.parse(existing.trust.lastVerifiedAt)
    ) {
      byKey.set(key, opportunity);
    }
  }
  return [...byKey.values()];
}

function inferType(textValue: string): OpportunityType | null {
  const lower = textValue.toLowerCase();
  if (lower.includes('scholar')) return 'scholarship';
  if (lower.includes('fellow')) return 'fellowship';
  if (lower.includes('intern')) return 'internship';
  if (lower.includes('grant')) return 'grant';
  if (lower.includes('hackathon')) return 'hackathon';
  if (lower.includes('research')) return 'research-program';
  return null;
}

/**
 * What the source actually says about how much of the cost is covered.
 *
 * This looked only for the literal phrases "fully funded" and "full funding",
 * so a page that published `coverage: ["tuition", "travel"]` alongside a
 * concrete amount was recorded as `unspecified`. A student who requires full
 * funding then saw "the source does not clearly state the funding level" on an
 * opportunity that plainly states it, which both lowers the match and adds an
 * uncertainty that is not real.
 *
 * Coverage of tuition together with any living cost is full funding by any
 * ordinary reading, and is treated as such. Coverage that names something
 * narrower is partial. An amount on its own stays `unspecified`, because a
 * number without a scope genuinely does not say whether it covers everything,
 * and guessing there would be exactly the overreach this project refuses.
 */
function inferFundingLevel(
  textValue: string,
  coverage: readonly string[],
): Opportunity['funding']['level'] {
  const lower = textValue.toLowerCase();
  if (lower.includes('fully funded') || lower.includes('full funding')) return 'full';
  if (lower.includes('partial')) return 'partial';

  const covered = coverage.map((entry) => entry.toLowerCase());
  const tuition = covered.some((entry) => /tuition|fees|course/.test(entry));
  const living = covered.some((entry) =>
    /living|stipend|travel|accommodation|housing|allowance/.test(entry),
  );

  if (tuition && living) return 'full';
  if (covered.length > 0) return 'partial';
  return 'unspecified';
}

function isoDate(value: string | null): string | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function text(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function number(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function boolean(row: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && ['true', 'yes', 'remote'].includes(value.toLowerCase())) return true;
    if (typeof value === 'string' && ['false', 'no', 'onsite'].includes(value.toLowerCase())) return false;
  }
  return null;
}

function strings(row: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) return unique(value.filter((item): item is string => typeof item === 'string'));
    if (typeof value === 'string' && value.trim() !== '') {
      return unique(value.split(/[;,|]/).map((item) => item.trim()).filter(Boolean));
    }
  }
  return [];
}

function url(row: Record<string, unknown>, keys: string[]): string | null {
  const candidate = text(row, keys);
  if (candidate === null) return null;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function nestedText(row: Record<string, unknown> | null, key: string): string | null {
  return row === null ? null : text(row, [key]);
}

function nestedNumber(row: Record<string, unknown> | null, key: string): number | null {
  return row === null ? null : number(row, [key]);
}

function nestedStrings(row: Record<string, unknown> | null, key: string): string[] {
  return row === null ? [] : strings(row, [key]);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
