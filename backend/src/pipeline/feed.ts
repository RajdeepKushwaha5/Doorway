import type { HealthEnvelope } from '../shared/index.js';
import type { IncidentRecord, Store, VerifiedSnapshot } from '../store/index.js';

/**
 * The downstream feed.
 *
 * Consumers never receive a suspect row. They receive either verified data or
 * the last known good with staleness stated. The hackathon brief promises
 * "nothing downstream of it ever sees a gap", and this is where that becomes
 * true rather than aspirational.
 *
 * Staleness is never hidden. Last-known-good is a resilience mechanism, not
 * permission to present old data as current, so `stale` and `lastVerified` are
 * always populated when serving from quarantine.
 */
export async function buildFeed(
  store: Store,
  collectorId: string,
  url: string,
  options: { maxAgeMs?: number; now?: number } = {},
): Promise<HealthEnvelope> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = options.now ?? Date.now();
  const snapshot = await store.getVerifiedSnapshot(collectorId, url);
  const incidents = await store.listIncidents(collectorId);
  const open = incidents.find(
    (incident) => incident.quarantined && incident.resolvedAt === null && incidentTargets(incident, url),
  );

  if (open === undefined) {
    return snapshot === null ? unavailable() : verified(snapshot, maxAgeMs, now);
  }

  if (snapshot === null) {
    return {
      data: null,
      health: {
        status: 'unavailable',
        confidence: 0,
        lastVerified: null,
        stale: false,
        fieldsDegraded: open.affectedFields,
        incidentId: open.id,
        confirmedBy: 'none',
        reason: `${open.classification}: no previously verified data to fall back on`,
      },
    };
  }

  return {
    data: snapshot.data,
    health: {
      status: 'quarantined',
      // Confidence in the *served* payload, which is the older verified one.
      // It was correct when captured; the uncertainty is about its age.
      confidence: Math.max(0, 1 - open.confidence),
      lastVerified: snapshot.verifiedAt,
      stale: true,
      // The payload served here is the older snapshot, so it carries that
      // reading's provenance and not the current run's.
      confirmedBy: snapshot.confirmedBy ?? 'contract_only',
      fieldsDegraded: open.affectedFields,
      incidentId: open.id,
      reason: reasonFor(open),
    },
  };
}

function incidentTargets(incident: IncidentRecord, url: string): boolean {
  return incident.witness === null || incident.witness.url === url;
}

function reasonFor(incident: IncidentRecord): string {
  switch (incident.classification) {
    case 'extractor_drift':
      return 'collector_witness_disagreement';
    case 'explicit_failure':
      return 'collector_returned_error_or_empty';
    case 'access_anomaly':
      return 'sensors_observed_different_page_variants';
    case 'inconclusive':
      return 'insufficient_evidence_to_verify';
    default:
      return incident.classification;
  }
}

/**
 * How long a verified value stays verified.
 *
 * Nothing about a value being correct on Tuesday makes it correct today, and
 * until now a snapshot with no incident against it reported `verified` forever.
 * A collector that last ran three weeks ago looked identical to one that ran
 * five minutes ago.
 *
 * Bright Data's own analysis of data decay puts the useful life of a retail or
 * finance page at roughly thirty days and a social page at under one, so the
 * right number is a property of the source rather than of this code. Twenty-four
 * hours is the default because it is short enough to be honest about most
 * commercial pages and long enough not to mark a daily collector stale between
 * its own runs. A collector declares its own when its subject decays faster.
 *
 * Passing the age threshold does not withhold the value. It publishes it and
 * says how old it is, which is the difference between caution and refusing to
 * answer.
 */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function verified(snapshot: VerifiedSnapshot, maxAgeMs: number, now: number): HealthEnvelope {
  const ageMs = now - new Date(snapshot.verifiedAt).getTime();
  const expired = Number.isFinite(ageMs) && ageMs > maxAgeMs;
  const ageHours = Math.floor(ageMs / (60 * 60 * 1000));

  /*
   * Two sensors, or only the contracts?
   *
   * The witness is skipped when a baseline exists and every contract check
   * passes, which is a deliberate saving of a Web Unlocker read on a run that
   * looks ordinary. The snapshot was still published at 0.95 carrying the claim
   * that two independent sensors had confirmed it, which was simply not true
   * for those values: a plausible wrong number sitting inside the learned
   * distribution could be published without any second sensor ever looking.
   *
   * Snapshots written before this field existed are read as the weaker claim.
   * Assuming the stronger one for unlabelled history is how a system starts
   * overstating its own evidence.
   */
  const confirmedBy = snapshot.confirmedBy ?? 'contract_only';
  const dual = confirmedBy === 'two_sensors';

  // A contract-only reading is a real state and a weaker one, so it is scored
  // below the 0.7 bar that authorises an automatic promotion.
  const fresh = dual ? 0.95 : 0.6;

  const provenanceNote = dual
    ? null
    : 'confirmed against this source\u2019s learned contract only; the independent witness was not consulted on this reading';

  return {
    data: snapshot.data,
    health: {
      status: expired ? 'stale' : 'verified',
      // Age is not a fault, so confidence decays rather than collapsing. The
      // only question for an agreed value is when it was agreed.
      confidence: expired ? fresh / 2 : fresh,
      lastVerified: snapshot.verifiedAt,
      stale: expired,
      fieldsDegraded: [],
      incidentId: null,
      confirmedBy,
      reason: expired
        ? `last confirmed ${String(ageHours)}h ago, beyond the ${String(Math.round(maxAgeMs / 3_600_000))}h freshness window`
        : provenanceNote,
    },
  };
}

function unavailable(): HealthEnvelope {
  return {
    data: null,
    health: {
      status: 'unavailable',
      confidence: 0,
      confirmedBy: 'none',
      lastVerified: null,
      stale: false,
      fieldsDegraded: [],
      incidentId: null,
      reason: 'no verified observation yet',
    },
  };
}
