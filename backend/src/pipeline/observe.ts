import { randomUUID } from 'node:crypto';
import type { BrightDataClient } from '../brightdata/index.js';
import { scrapeMarkdown } from '../brightdata/index.js';
import { learnContract, validateRun } from '../contracts/index.js';
import { classify, synthesizeRepairPrompt, transition } from '../incident/index.js';
import type { AcquisitionContext } from '../shared/index.js';
import { observeMarkdown, reconcile } from '../witness/index.js';
import type { CollectorRecord, IncidentRecord, RunRecord, Store } from '../store/index.js';

/**
 * The observation half of the loop.
 *
 * Run the collector, check the output, and when something looks wrong fetch an
 * independent witness and decide what it means. Repair is deliberately a
 * separate step: this function never calls Self-Healing, so the decision to
 * modify a production collector always crosses a visible boundary.
 */

export interface ObserveDeps {
  client: BrightDataClient;
  store: Store;
  /** Injected so tests can drive the witness without touching the network. */
  fetchMarkdown?: (url: string) => Promise<{ markdown: string; fetchedAt: string }>;
  now?: () => Date;
}

export interface ObserveResult {
  run: RunRecord;
  incident: IncidentRecord | null;
  /** Set when the run was clean and the data may be published. */
  publishable: boolean;
}

function contextFrom(url: string, at: string): AcquisitionContext {
  return { requestedUrl: url, deviceType: 'unknown', variantMarkers: [], observedAt: at };
}

/**
 * Run one collector against one URL and decide what happened.
 *
 * @param collector The registered collector, carrying its witness specs,
 *   invariants and protected fields.
 */
export async function observeOnce(
  collector: CollectorRecord,
  url: string,
  deps: ObserveDeps,
): Promise<ObserveResult> {
  const now = deps.now ?? ((): Date => new Date());
  // Default to the CLI only when no fetcher was supplied. Production wires in
  // the Unlocker HTTP path, which does not require the CLI to be installed.
  const fetchMarkdown = deps.fetchMarkdown ?? ((target: string) => scrapeMarkdown(target));

  const startedAt = now().toISOString();
  const result = await deps.client.runCollector(collector.brightDataCollectorId, [url], {
    timeoutMs: 600_000,
  });

  let contract = await deps.store.getContract(collector.id);
  if (contract === null) {
    // First sight of this collector.
    //
    // Deliberately learn from NO runs. An earlier version seeded the baseline
    // from this very run, which meant a corrupt first result (a $0 price with
    // missing fields, say) taught NOTICE that corruption was normal, and the
    // detector went quiet on exactly the thing it exists to catch.
    //
    // The user's declared invariants still apply immediately, because those
    // are asserted facts rather than observations. Statistical profiles stay
    // empty until a human accepts a baseline via POST /collectors/:id/baseline.
    contract = learnContract(collector.id, [], collector.invariants);
    await deps.store.saveContract(contract);
  }

  const checks = validateRun({ rows: result.rows, contract });

  const run: RunRecord = {
    id: randomUUID(),
    collectorId: collector.id,
    brightDataSnapshotId: result.snapshotId,
    targetUrls: [url],
    version: 'production',
    rows: result.rows,
    checks,
    durationMs: result.durationMs,
    observedAt: startedAt,
  };
  await deps.store.saveRun(run);

  // A collector with no accepted baseline has never been verified against
  // anything except its own declared invariants. Publishing its first result
  // as "verified" would let a corrupt first run become the last-known-good
  // value that every later quarantine falls back to.
  const hasBaseline = contract.sampleCount > 0;

  const needsWitness =
    !hasBaseline || checks.some((check) => check.status === 'fail' || check.status === 'warn');
  if (!needsWitness) {
    // Record the verified snapshot here, not only on the incident path. An
    // earlier version returned straight away, so a collector that was healthy
    // every single run never produced a verified snapshot and /api/feed
    // reported "no verified observation yet" forever.
    const healthyRow = result.rows[0] ?? null;
    if (healthyRow !== null) {
      await deps.store.saveVerifiedSnapshot({
        collectorId: collector.id,
        url,
        data: healthyRow,
        contractVersion: contract.version,
        verifiedAt: startedAt,
        // No witness was fetched, so there is no body to hash. Recorded as
        // empty rather than faked, because a hash nobody can check is worse
        // than an absent one.
        contentHash: '',
      });
    }
    return { run, incident: null, publishable: true };
  }

  // Something tripped. Fetch the independent sensor before concluding
  // anything: without it there is no way to tell a broken extractor from a
  // changed page, and guessing in either direction is destructive.
  //
  // The fetch can fail for ordinary reasons: the CLI is absent, the target is
  // blocking, the request times out. That must become a quarantined
  // `inconclusive` incident rather than an exception, because an exception
  // here leaves a suspicious run unrecorded and the downstream feed still
  // serving as though nothing happened.
  let witnessFetch: { markdown: string; fetchedAt: string };
  try {
    witnessFetch = await fetchMarkdown(url);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const inconclusive: IncidentRecord = {
      id: randomUUID(),
      collectorId: collector.id,
      runId: run.id,
      classification: 'inconclusive',
      confidence: 0,
      affectedFields: [...new Set(checks.filter((c) => c.status !== 'pass').map((c) => c.field).filter((f): f is string => f !== undefined))],
      evidence: [
        ...checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => c.explanation),
        `the independent witness could not be obtained: ${message}`,
        'without a second sensor there is no way to tell a broken extractor from a changed page, so this run is quarantined rather than judged',
      ],
      witness: null,
      repairPrompt: null,
      history: [
        transition('observed', 'validating', { actor: 'system', reason: 'collector run ingested' }),
        transition('validating', 'witness_pending', {
          actor: 'system',
          reason: 'contract checks tripped',
        }),
        transition('witness_pending', 'inconclusive', {
          actor: 'system',
          reason: `witness acquisition failed: ${message}`,
        }),
      ],
      gateResults: [],
      quarantined: true,
      createdAt: startedAt,
      resolvedAt: null,
    };

    await deps.store.saveIncident(inconclusive);
    await deps.store.appendAudit({
      id: randomUUID(),
      actor: 'system',
      eventType: 'witness.fetch_failed',
      entityId: inconclusive.id,
      payload: { url, error: message },
      at: startedAt,
    });

    return { run, incident: inconclusive, publishable: false };
  }

  const observation = observeMarkdown(
    url,
    witnessFetch.markdown,
    collector.witnessSpecs,
    witnessFetch.fetchedAt,
  );

  const firstRow = result.rows[0] ?? null;
  const reconciliation = reconcile(firstRow, observation, collector.witnessSpecs);

  const classification = classify({
    checks,
    reconciliation,
    collectorContext: contextFrom(url, startedAt),
    witnessContext: contextFrom(url, witnessFetch.fetchedAt),
    departsFromBaseline: checks.some((check) => check.status === 'warn' || check.status === 'fail'),
  });

  const history = [
    transition('observed', 'validating', { actor: 'system', reason: 'collector run ingested' }),
    transition('validating', 'witness_pending', {
      actor: 'system',
      reason: 'contract checks tripped',
    }),
    transition('witness_pending', 'classifying', {
      actor: 'system',
      reason: `witness observed ${observation.values.length} field(s)`,
      evidenceRefs: [observation.contentHash],
    }),
  ];

  const terminalByVerdict = {
    healthy: 'healthy',
    genuine_source_change: 'genuine_change',
    extractor_drift: 'drift_confirmed',
    access_anomaly: 'access_retry',
    inconclusive: 'inconclusive',
    explicit_failure: 'drift_confirmed',
  } as const;

  history.push(
    transition('classifying', terminalByVerdict[classification.verdict], {
      actor: 'system',
      reason: classification.evidence[0] ?? classification.verdict,
    }),
  );

  // A repair prompt is only synthesized for verdicts that may be repaired.
  // Generating one for a genuine source change would put a ready-to-fire
  // instruction next to a collector that is working correctly.
  const repairable =
    classification.verdict === 'extractor_drift' ||
    classification.verdict === 'explicit_failure';

  const repairPrompt = repairable
    ? synthesizeRepairPrompt({
        classification,
        reconciliation,
        specs: collector.witnessSpecs,
        protectedFields: collector.protectedFields,
      }).text
    : null;

  const incident: IncidentRecord = {
    id: randomUUID(),
    collectorId: collector.id,
    runId: run.id,
    classification: classification.verdict,
    confidence: classification.confidence,
    affectedFields: classification.affectedFields,
    evidence: classification.evidence,
    witness: observation,
    repairPrompt,
    history,
    gateResults: [],
    // Quarantine anything not positively verified. Publishing a row that only
    // "probably" survived is the failure this system exists to prevent.
    quarantined: classification.verdict !== 'healthy' && classification.verdict !== 'genuine_source_change',
    createdAt: startedAt,
    resolvedAt: null,
  };

  await deps.store.saveIncident(incident);
  await deps.store.appendAudit({
    id: randomUUID(),
    actor: 'system',
    eventType: `incident.${classification.verdict}`,
    entityId: incident.id,
    payload: { checks, evidence: classification.evidence },
    at: startedAt,
  });

  const publishable =
    classification.verdict === 'healthy' || classification.verdict === 'genuine_source_change';

  if (publishable) {
    await deps.store.saveVerifiedSnapshot({
      collectorId: collector.id,
      url,
      data: firstRow,
      contractVersion: contract.version,
      verifiedAt: startedAt,
      contentHash: observation.contentHash,
    });
  }

  return { run, incident, publishable };
}
