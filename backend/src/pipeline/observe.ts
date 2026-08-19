import { randomUUID } from 'node:crypto';
import type { BrightDataClient } from '../brightdata/index.js';
import { scrapeMarkdown } from '../brightdata/index.js';
import { learnContract, validateRun } from '../contracts/index.js';
import { brief, type ObserveEmitter } from './events.js';
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
  /**
   * Publish the reasoning as it happens.
   *
   * Optional and never load-bearing: nothing downstream reads these, and a
   * throwing consumer must not be able to change a verdict. Absent means the
   * observation behaves exactly as it did before streaming existed.
   */
  onEvent?: ObserveEmitter;
  /** Injected so tests can drive the witness without touching the network. */
  fetchMarkdown?: (
    url: string,
  ) => Promise<{
    markdown: string;
    fetchedAt: string;
    country?: string;
    deviceType?: 'desktop' | 'mobile';
  }>;
  /**
   * Capture a rendered image of the page and return an id for it.
   *
   * Optional on purpose. Every test runs without it, and a deployment without
   * an Unlocker zone simply records no picture rather than failing.
   */
  captureScreenshot?: (url: string) => Promise<string>;
  /**
   * Announce an incident to whoever is on the hook for the data.
   *
   * Optional, and never allowed to affect the verdict. Detection that reaches
   * no human is indistinguishable from no detection, but a chat service being
   * down must not cost a quarantine.
   */
  notifyIncident?: (incident: IncidentRecord, collectorName: string) => Promise<unknown>;
  now?: () => Date;
}

export interface ObserveResult {
  run: RunRecord;
  incident: IncidentRecord | null;
  /** Set when the run was clean and the data may be published. */
  publishable: boolean;
}

/**
 * @param country ISO 3166-1 alpha-2 exit country, when the fetch pinned one.
 *   Recording it is what lets the classifier tell a region-priced page apart
 *   from a broken extractor. Left undefined it stays absent rather than being
 *   guessed, because a wrong country here produces a confident wrong verdict.
 */
function contextFrom(
  url: string,
  at: string,
  country?: string,
  deviceType: AcquisitionContext['deviceType'] = 'unknown',
): AcquisitionContext {
  return {
    requestedUrl: url,
    deviceType,
    variantMarkers: [],
    observedAt: at,
    ...(country === undefined || country === '' ? {} : { country }),
  };
}

/**
 * Close incidents whose source has recovered on its own.
 *
 * Until this existed, `resolvedAt` was set in exactly one place: after a
 * repair was promoted and production re-verified. Every other route out of a
 * quarantine was a route that did not exist. So a collector that broke and
 * then came good again, because the site reverted its redesign, or the drift
 * was transient, or somebody fixed the page, stayed quarantined forever and
 * its feed kept serving a stale value with a disagreement attached.
 *
 * Detecting that something is fixed is the same problem as detecting that it
 * broke, and it has the same answer: the contracts pass again. A run reaching
 * here has satisfied every check against the collector's own learned history,
 * which is the same bar that would have opened an incident had it failed.
 *
 * Only incidents for this URL are closed, and only those still open, so a
 * healthy read of one page cannot vouch for another.
 */
async function closeRecoveredIncidents(
  deps: ObserveDeps,
  collectorId: string,
  url: string,
  runId: string,
  at: string,
): Promise<number> {
  const incidents = await deps.store.listIncidents(collectorId);
  const open = incidents.filter(
    (incident) =>
      incident.resolvedAt === null &&
      incident.quarantined &&
      (incident.witness === null || incident.witness.url === url),
  );

  for (const incident of open) {
    await deps.store.saveIncident({
      ...incident,
      quarantined: false,
      resolvedAt: at,
      history: [
        ...incident.history,
        {
          from: incident.history.at(-1)?.to ?? 'observed',
          to: 'resolved',
          at,
          actor: 'system',
          reason: `source recovered: run ${runId} satisfied every contract for ${url}`,
          evidenceRefs: [],
        },
      ],
    });
  }

  return open.length;
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

  // Swallow anything the consumer throws. A broken log must never be able to
  // change a verdict, and a stream is the least important thing in this file.
  const emit: ObserveEmitter = (event) => {
    try {
      deps.onEvent?.(event);
    } catch {
      /* a spectator cannot break the game */
    }
  };

  const startedAt = now().toISOString();

  emit({
    step: 'triggering',
    line: `triggering ${collector.brightDataCollectorId} via /dca/trigger`,
    detail: { collectorId: collector.brightDataCollectorId, url },
  });

  const result = await deps.client.runCollector(collector.brightDataCollectorId, [url], {
    timeoutMs: 600_000,
  });

  emit({
    step: 'rows',
    line: `row returned    ${
      result.rows.length === 0
        ? 'no rows'
        : Object.entries((result.rows[0] ?? {}) as Record<string, unknown>)
            .filter(([key]) => key !== 'input')
            .slice(0, 3)
            .map(([key, value]) => `${key}: ${brief(value, 24)}`)
            .join('   ')
    }`,
    detail: { rowCount: result.rows.length, durationMs: result.durationMs },
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

  emit({
    step: 'contracts',
    line: `contracts       ${
      checks.length === 0
        ? 'no contract learned yet'
        : checks
            .slice(0, 4)
            .map((check) => `${check.field ?? check.checkId} ${check.status.toUpperCase()}`)
            .join(' · ')
    }`,
    detail: {
      total: checks.length,
      failed: checks.filter((check) => check.status === 'fail').length,
      warned: checks.filter((check) => check.status === 'warn').length,
    },
  });

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
    const closed = await closeRecoveredIncidents(deps, collector.id, url, run.id, startedAt);

    emit({
      step: 'witness-skip',
      line: 'second sensor    not needed, every contract passed',
      detail: { reason: 'contracts_passed' },
    });
    emit({
      step: 'verdict',
      line: `verdict         healthy · published${closed > 0 ? ` · ${String(closed)} incident(s) closed` : ''}`,
      detail: { verdict: 'healthy', publishable: true, incidentsClosed: closed },
    });

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
  let witnessFetch: {
    markdown: string;
    fetchedAt: string;
    country?: string;
    deviceType?: 'desktop' | 'mobile';
  };
  emit({
    step: 'witness-wake',
    line: 'waking the second sensor',
    detail: {
      reason: hasBaseline ? 'a contract tripped' : 'no accepted baseline yet',
    },
  });

  try {
    witnessFetch = await fetchMarkdown(url);
    emit({
      step: 'witness-fetch',
      line: `Web Unlocker    markdown, ${(witnessFetch.markdown.length / 1024).toFixed(1)} KB${
        witnessFetch.country === undefined ? '' : `, exit country ${witnessFetch.country}`
      }${witnessFetch.deviceType === undefined ? '' : `, ${witnessFetch.deviceType}`}`,
      detail: {
        bytes: witnessFetch.markdown.length,
        country: witnessFetch.country ?? null,
        deviceType: witnessFetch.deviceType ?? null,
      },
    });
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
      // No picture either: if the witness could not read the page, a capture
      // of it is unlikely to succeed and would delay a quarantine decision.
      screenshotId: null,
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

    // Worth telling someone about, arguably more than a clean drift: the
    // system has stopped being able to check, and silence here looks exactly
    // like everything being fine.
    if (deps.notifyIncident !== undefined) {
      try {
        await deps.notifyIncident(inconclusive, collector.name);
      } catch {
        // Courtesy, not correctness.
      }
    }
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
  for (const value of observation.values) {
    emit({
      step: 'witness-read',
      line: `witness reads   ${value.path} = ${brief(value.value, 28)}   from "${value.evidence.line.trim().slice(0, 46)}"   confidence ${value.confidence.toFixed(2)}`,
      detail: {
        path: value.path,
        value: value.value,
        line: value.evidence.line,
        strategy: value.evidence.strategy,
        confidence: value.confidence,
      },
    });
  }
  for (const path of observation.notFound) {
    emit({
      step: 'witness-read',
      line: `witness reads   ${path} = nothing, the page did not state it`,
      detail: { path, value: null },
    });
  }

  const reconciliation = reconcile(firstRow, observation, collector.witnessSpecs);

  for (const comparison of reconciliation.comparisons) {
    const verdictWord =
      comparison.agreement.kind === 'agree'
        ? 'AGREE'
        : comparison.agreement.kind === 'disagree'
          ? 'DISAGREE'
          : 'INCOMPARABLE';
    emit({
      step: 'compare',
      line: `compare         ${comparison.path}: ${brief(comparison.collectorValue, 20)} vs ${brief(comparison.witnessValue, 20)} → ${verdictWord}`,
      detail: {
        path: comparison.path,
        collector: comparison.collectorValue,
        witness: comparison.witnessValue,
        agreement: comparison.agreement.kind,
      },
    });
  }

  const classification = classify({
    checks,
    reconciliation,
    // The collector's device is declared on the record, never guessed. A
    // Scraper Studio scraper can emulate a phone with `emulate_device`, and
    // only whoever built it knows whether it did.
    collectorContext: contextFrom(
      url,
      startedAt,
      collector.acquisitionContext.country,
      collector.acquisitionContext.deviceType,
    ),
    witnessContext: contextFrom(
      url,
      witnessFetch.fetchedAt,
      witnessFetch.country,
      witnessFetch.deviceType,
    ),
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

  emit({
    step: 'verdict',
    line: `verdict         ${classification.verdict} · confidence ${classification.confidence.toFixed(2)}`,
    detail: {
      verdict: classification.verdict,
      confidence: classification.confidence,
      affectedFields: classification.affectedFields,
      evidence: classification.evidence,
      // Named here because it is the one thing a reader wants next, and the
      // difference between the two is the whole argument of the project.
      action:
        classification.verdict === 'genuine_source_change'
          ? 'the page changed and the collector is right. Do not repair.'
          : classification.verdict === 'access_anomaly'
            ? 'the sensors saw different regions or devices. Do not blame the collector.'
            : classification.verdict === 'healthy'
              ? 'publish'
              : 'withhold the field and repair with evidence',
    },
  });

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

  // Illustrate the incident, but never let the illustration decide whether
  // there is one. Capture costs a request and roughly 200KB, so it happens
  // only for verdicts a human will have to rule on, and a failure here is
  // swallowed: an incident without a picture is still an incident.
  let screenshotId: string | null = null;
  if (deps.captureScreenshot !== undefined && classification.verdict !== 'healthy') {
    try {
      screenshotId = await deps.captureScreenshot(url);
    } catch {
      screenshotId = null;
    }
  }

  const incident: IncidentRecord = {
    id: randomUUID(),
    collectorId: collector.id,
    runId: run.id,
    classification: classification.verdict,
    confidence: classification.confidence,
    affectedFields: classification.affectedFields,
    evidence: classification.evidence,
    witness: observation,
    screenshotId,
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

  // After the record is durable, never before. A notification describing an
  // incident that failed to save would send someone looking for something
  // that does not exist.
  if (deps.notifyIncident !== undefined) {
    try {
      await deps.notifyIncident(incident, collector.name);
    } catch {
      // Courtesy, not correctness.
    }
  }
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
