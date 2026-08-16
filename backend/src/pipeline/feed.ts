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
): Promise<HealthEnvelope> {
  const snapshot = await store.getVerifiedSnapshot(collectorId, url);
  const incidents = await store.listIncidents(collectorId);
  const open = incidents.find(
    (incident) => incident.quarantined && incident.resolvedAt === null && incidentTargets(incident, url),
  );

  if (open === undefined) {
    return snapshot === null ? unavailable() : verified(snapshot);
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

function verified(snapshot: VerifiedSnapshot): HealthEnvelope {
  return {
    data: snapshot.data,
    health: {
      status: 'verified',
      confidence: 0.95,
      lastVerified: snapshot.verifiedAt,
      stale: false,
      fieldsDegraded: [],
      incidentId: null,
      reason: null,
    },
  };
}

function unavailable(): HealthEnvelope {
  return {
    data: null,
    health: {
      status: 'unavailable',
      confidence: 0,
      lastVerified: null,
      stale: false,
      fieldsDegraded: [],
      incidentId: null,
      reason: 'no verified observation yet',
    },
  };
}
