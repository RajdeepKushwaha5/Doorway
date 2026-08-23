import { randomUUID } from 'node:crypto';
import type { BrightDataClient } from '../brightdata/index.js';
import { validateRun } from '../contracts/index.js';
import {
  alreadyEntered,
  currentState,
  evaluateGate,
  transition,
  type GateDecision,
} from '../incident/index.js';
import type { CollectorRecord, IncidentRecord, Store } from '../store/index.js';

/**
 * The repair half of the loop.
 *
 * Ordered so that production is only ever modified after the candidate has
 * been shown to fix the incident and to leave every previously working page
 * intact. A green Self-Healing preview does not satisfy that, which is the
 * whole reason this step exists.
 */

export interface RepairDeps {
  client: BrightDataClient;
  store: Store;
  /**
   * How the candidate is executed before approval. Injected because whether
   * this is possible at all is what the Phase 0 matrix determines, and the
   * answer changes which branch of the plan is in force.
   */
  runCandidate: (collectorId: string, url: string) => Promise<unknown[]>;
  /** Polling cadence for the heal job. */
  pollIntervalMs?: number;
  healTimeoutMs?: number;
  now?: () => Date;
}

export type RepairOutcome =
  | { kind: 'approved'; decision: GateDecision; incident: IncidentRecord }
  | { kind: 'rejected'; decision: GateDecision; incident: IncidentRecord }
  | { kind: 'not_repairable'; reason: string; incident: IncidentRecord };

/**
 * Attempt to repair a collector, gated on verified evidence.
 *
 * @param incident Must be `extractor_drift` or `explicit_failure`. Anything
 *   else is refused rather than silently skipped, because sending a genuine
 *   source change to Self-Healing rewrites a working collector.
 */
export async function attemptRepair(
  collector: CollectorRecord,
  incident: IncidentRecord,
  deps: RepairDeps,
): Promise<RepairOutcome> {
  const now = deps.now ?? ((): Date => new Date());

  if (incident.classification !== 'extractor_drift' && incident.classification !== 'explicit_failure') {
    return {
      kind: 'not_repairable',
      reason: `classification "${incident.classification}" must not be repaired; the collector is working`,
      incident,
    };
  }

  if (incident.repairPrompt === null || incident.repairPrompt.trim() === '') {
    return { kind: 'not_repairable', reason: 'no diagnosis was produced', incident };
  }

  const incidentUrl = incident.witness?.url;
  if (incidentUrl === undefined) {
    return { kind: 'not_repairable', reason: 'no incident URL recorded', incident };
  }

  const contract = await deps.store.getContract(collector.id);
  if (contract === null) {
    return { kind: 'not_repairable', reason: 'no contract learned for this collector', incident };
  }

  const history = [...incident.history];
  history.push(
    transition('drift_confirmed', 'healing', {
      actor: 'system',
      reason: 'evidence-backed diagnosis synthesized',
    }),
  );

  // The incident URL leads `custom_input`. The CLI drops this, which is why
  // the API is used directly: without it the healer repairs a page it has
  // never seen.
  const regressionUrls = collector.goldenCases.map((golden) => golden.url);
  await deps.client.triggerSelfHealing(collector.brightDataCollectorId, incident.repairPrompt, [
    incidentUrl,
    ...regressionUrls,
  ]);

  history.push(
    transition('healing', 'awaiting_candidate', {
      actor: 'brightdata',
      reason: 'self-healing job accepted',
    }),
  );

  // Wait for the approval gate.
  const deadline = Date.now() + (deps.healTimeoutMs ?? 900_000);
  const pollIntervalMs = deps.pollIntervalMs ?? 10_000;
  let phase = 'pending';

  for (;;) {
    const progress = await deps.client.getHealProgress(collector.brightDataCollectorId);
    phase = progress.phase;
    if (phase === 'awaiting_approval' || phase === 'done') break;
    if (phase === 'failed' || phase === 'rejected') {
      history.push(
        transition('awaiting_candidate', 'repair_rejected', {
          actor: 'brightdata',
          reason: `self-healing ended in "${phase}"`,
        }),
      );
      const updated = { ...incident, history };
      await deps.store.saveIncident(updated);
      return {
        kind: 'rejected',
        decision: { approved: false, reasons: [`self-healing ended in "${phase}"`], results: [] },
        incident: updated,
      };
    }
    if (Date.now() + pollIntervalMs > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  history.push(
    transition('awaiting_candidate', 'verifying_candidate', {
      actor: 'system',
      reason: 'replaying the candidate against the incident and the regression corpus',
    }),
  );

  /*
   * Replay the candidate ourselves, and prove it was the candidate.
   *
   * The gate asks Bright Data for `version: 'dev'` and treats the answer as the
   * proposed repair. Finding 2 in the README records that `bdata scraper run
   * --version=dev` returned production's output rather than the pending
   * candidate, and nothing has demonstrated that the HTTP path behaves any
   * differently. So the gate may be replaying production while calling it the
   * candidate.
   *
   * While the candidate is broken that mistake is harmless: the replay fails
   * and the repair is rejected, which is the right outcome by luck. The
   * dangerous case is the other one. If production recovers for any unrelated
   * reason, a candidate nobody ever executed passes the gate and, on a
   * collector set to promote automatically, ships.
   *
   * So run production too and compare. Byte-identical output on the page that
   * failed means the two versions are indistinguishable through this path, and
   * an indistinguishable candidate has not been tested. Recorded, surfaced, and
   * on the automatic path, refused.
   */
  const candidateRowsByUrl = new Map<string, unknown[]>();
  let candidateIndistinguishable = false;

  try {
    const [candidateOnIncident, productionOnIncident] = await Promise.all([
      deps.runCandidate(collector.brightDataCollectorId, incidentUrl),
      deps.client.runCollector(collector.brightDataCollectorId, [incidentUrl], {
        version: 'production',
        timeoutMs: 600_000,
      }),
    ]);

    candidateIndistinguishable =
      JSON.stringify(candidateOnIncident) === JSON.stringify(productionOnIncident.rows);

    candidateRowsByUrl.set(incidentUrl, candidateOnIncident);

    await deps.store.appendAudit({
      id: randomUUID(),
      actor: 'system',
      eventType: candidateIndistinguishable
        ? 'candidate.indistinguishable_from_production'
        : 'candidate.distinct_from_production',
      entityId: incident.id,
      payload: { url: incidentUrl, indistinguishable: candidateIndistinguishable },
      at: now().toISOString(),
    });
  } catch (caught) {
    await deps.store.appendAudit({
      id: randomUUID(),
      actor: 'system',
      eventType: 'candidate.execution_failed',
      entityId: incident.id,
      payload: { url: incidentUrl, error: caught instanceof Error ? caught.message : String(caught) },
      at: now().toISOString(),
    });
  }

  for (const url of regressionUrls) {
    try {
      candidateRowsByUrl.set(url, await deps.runCandidate(collector.brightDataCollectorId, url));
    } catch (caught) {
      // Leave the URL absent. The gate treats an unrun case as unverified,
      // which is the safe reading: it has not been shown to work.
      await deps.store.appendAudit({
        id: randomUUID(),
        actor: 'system',
        eventType: 'candidate.execution_failed',
        entityId: incident.id,
        payload: { url, error: caught instanceof Error ? caught.message : String(caught) },
        at: now().toISOString(),
      });
    }
  }

  const incidentExpected = Object.fromEntries(
    (incident.witness?.values ?? []).map((value) => [value.path, value.value]),
  );

  const rawDecision = evaluateGate({
    incident: { url: incidentUrl, expected: incidentExpected },
    regression: collector.goldenCases,
    candidateRowsByUrl,
    protectedFields: collector.protectedFields,
    contract,
    // So a date is compared as a day rather than as a very large number.
    specs: collector.witnessSpecs,
  });

  /*
   * A pass we cannot attribute to the candidate is not a pass.
   *
   * When the dev and production runs are byte-identical on the page that
   * failed, this path cannot tell the two versions apart, so a green result
   * says nothing about the proposed repair. It might be a working candidate. It
   * might be production that recovered on its own while the candidate was never
   * executed at all. Promoting on that evidence would ship an untested template
   * on the strength of a coincidence.
   *
   * Downgraded rather than thrown: the operator still sees the full matrix and
   * can approve by hand having read it. What is withdrawn is the automatic
   * path's licence to act unattended.
   */
  const decision =
    rawDecision.approved && candidateIndistinguishable
      ? {
          approved: false as const,
          results: rawDecision.results,
          reasons: [
            'Every case passed, but the candidate run and the production run returned identical output on the incident page, so this path cannot demonstrate that the candidate was the thing executed.',
            'A pass that cannot be attributed to the candidate is not evidence the candidate works. Approve by hand only after confirming the proposed template differs from production.',
            ...rawDecision.reasons,
          ],
        }
      : rawDecision;

  if (!decision.approved) {
    // Tell Bright Data too. A candidate we blocked but never answered sits at
    // their approval gate indefinitely and blocks every later heal on this
    // collector. Failure to reject is logged, not thrown: our own decision to
    // block already stands regardless.
    try {
      await deps.client.rejectRepair(collector.brightDataCollectorId);
    } catch (caught) {
      await deps.store.appendAudit({
        id: randomUUID(),
        actor: 'system',
        eventType: 'repair.reject_failed',
        entityId: incident.id,
        payload: { error: caught instanceof Error ? caught.message : String(caught) },
        at: now().toISOString(),
      });
    }

    history.push(
      transition('verifying_candidate', 'repair_rejected', {
        actor: 'system',
        reason: decision.reasons.join('; '),
      }),
    );
    const updated = { ...incident, history, gateResults: decision.results };
    await deps.store.saveIncident(updated);
    await deps.store.appendAudit({
      id: randomUUID(),
      actor: 'system',
      eventType: 'repair.rejected',
      entityId: incident.id,
      payload: { reasons: decision.reasons },
      at: now().toISOString(),
    });
    return { kind: 'rejected', decision, incident: updated };
  }

  history.push(
    transition('verifying_candidate', 'awaiting_approval', {
      actor: 'system',
      reason: 'candidate passed every required case',
    }),
  );

  const updated: IncidentRecord = { ...incident, history, gateResults: decision.results };
  await deps.store.saveIncident(updated);

  // Stop here. Promotion is a separate, explicit call, so the system can never
  // modify a production collector as a side effect of investigating one.
  return { kind: 'approved', decision, incident: updated };
}

/** Refused promotion, with the reason, rather than a thrown string. */
export class PromotionRefusedError extends Error {
  constructor(
    readonly reason: string,
    readonly currentState: string,
  ) {
    super(reason);
    this.name = 'PromotionRefusedError';
  }
}

/**
 * Promote a repair that has already passed the gate.
 *
 * Three independent conditions, all required:
 *
 *  1. the incident's **actual** state, derived from its history, is
 *     `awaiting_approval`;
 *  2. a gate decision is recorded and every case in it passed;
 *  3. the incident has not already been approved.
 *
 * An earlier version passed a hardcoded `from` state to `transition()` and
 * relied on that call to reject illegal moves. It cannot: `transition()` only
 * validates the pair it is handed, so any caller could promote an incident
 * that never reached the gate, and the fabricated history would look correct
 * afterwards. The safety property has to be checked against stored state, not
 * asserted by the shape of a function call.
 *
 * @throws PromotionRefusedError when any condition fails. Nothing is sent to
 *   Bright Data in that case.
 */
export async function promoteRepair(
  collector: CollectorRecord,
  incident: IncidentRecord,
  deps: RepairDeps,
  actor: 'system' | 'user',
): Promise<IncidentRecord> {
  const state = currentState(incident.history);

  if (alreadyEntered(incident.history, 'approving')) {
    throw new PromotionRefusedError(
      'this incident has already been approved; promoting twice would re-run production for nothing',
      state,
    );
  }

  if (state !== 'awaiting_approval') {
    throw new PromotionRefusedError(
      `incident is in state "${state}", not "awaiting_approval"; only a candidate that passed the gate may be promoted`,
      state,
    );
  }

  if (incident.gateResults.length === 0) {
    throw new PromotionRefusedError(
      'no gate results are recorded for this incident, so the candidate has not been verified',
      state,
    );
  }

  const failedCases = incident.gateResults.filter((result) => !result.passed);
  if (failedCases.length > 0) {
    throw new PromotionRefusedError(
      `the gate recorded ${String(failedCases.length)} failing case(s): ${failedCases.map((c) => c.label).join(', ')}`,
      state,
    );
  }

  const history = [...incident.history];
  history.push(
    transition('awaiting_approval', 'approving', { actor, reason: 'gate passed, promoting' }),
  );

  await deps.client.approveRepair(collector.brightDataCollectorId);

  history.push(
    transition('approving', 'verifying_production', {
      actor: 'system',
      reason: 're-running production to confirm recovery',
    }),
  );

  const verificationUrl = incident.witness?.url ?? '';
  const verification = await deps.client.runCollector(
    collector.brightDataCollectorId,
    [verificationUrl],
    { timeoutMs: 600_000 },
  );

  // Hold production to the same bar the candidate had to clear.
  //
  // An earlier version accepted "at least one row without an error property",
  // which would have marked {"price":{"value":0,"currency":"USD"}} as resolved.
  // That is the exact silent corruption this project exists to catch, waved
  // through at the last step.
  const contract = await deps.store.getContract(collector.id);

  let recovered = verification.rows.length > 0;
  let failureReason = 'production returned no rows after promotion';

  if (contract === null) {
    // No contract means nothing to verify against. Refuse to call this
    // resolved: an unverifiable outcome is not a successful one.
    recovered = false;
    failureReason = 'no contract available to verify the post-promotion run against';
  } else if (recovered) {
    const hardFailures = validateRun({ rows: verification.rows, contract }).filter(
      (check) => check.status === 'fail',
    );

    const expected = Object.fromEntries(
      (incident.witness?.values ?? []).map((value) => [value.path, value.value]),
    );
    const postGate = evaluateGate({
      incident: { url: verificationUrl, expected },
      regression: collector.goldenCases,
      candidateRowsByUrl: new Map([[verificationUrl, verification.rows]]),
      protectedFields: collector.protectedFields,
      contract,
      specs: collector.witnessSpecs,
    });

    recovered = hardFailures.length === 0 && postGate.results[0]?.passed === true;
    if (!recovered) {
      failureReason =
        hardFailures[0]?.explanation ?? postGate.reasons[0] ?? 'post-promotion verification failed';
    }
  }

  history.push(
    transition('verifying_production', recovered ? 'resolved' : 'rollback_or_escalate', {
      actor: 'system',
      reason: recovered
        ? 'production reproduced the expected values and broke no invariant after promotion'
        : `production still wrong after promotion: ${failureReason}`,
    }),
  );

  const resolved: IncidentRecord = {
    ...incident,
    history,
    quarantined: !recovered,
    resolvedAt: recovered ? new Date().toISOString() : null,
  };
  await deps.store.saveIncident(resolved);
  return resolved;
}
