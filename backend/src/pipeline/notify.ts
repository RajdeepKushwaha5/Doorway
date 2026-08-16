import type { IncidentRecord } from '../store/index.js';

/**
 * Tell someone when data stops being trustworthy.
 *
 * Until now an incident opened, the row was quarantined, and the only trace was
 * a line in a log nobody reads. That is the difference between a detector and
 * a monitoring system: detection that reaches no human is indistinguishable
 * from no detection at all, because the outcome is the same. Somebody finds out
 * days later, from the damage.
 *
 * Deliberately a plain webhook rather than an integration. Slack, Discord,
 * Teams and every incident tool accept an inbound URL taking JSON, so one
 * mechanism covers all of them and adds no dependency. The payload leads with
 * `text` because that is the field Slack and Discord render, and carries the
 * structured fields alongside for anything that parses.
 */

export interface NotifyConfig {
  /** Inbound webhook. Absent means notification is simply off. */
  webhookUrl?: string | undefined;
  /** Dashboard origin, so the message can link to the incident. */
  dashboardUrl?: string | undefined;
  timeoutMs?: number;
}

/** Verdicts worth waking someone for. */
const NOTIFIABLE = new Set(['extractor_drift', 'explicit_failure', 'inconclusive', 'access_anomaly']);

/**
 * One line a person can act on, without opening anything.
 *
 * A notification that only says "an incident occurred" forces a context switch
 * to learn whether it matters. The two values that disagree are the whole
 * story, so they go in the first line.
 */
function summarize(incident: IncidentRecord, collectorName: string): string {
  const fields = incident.affectedFields.join(', ') || 'unknown field';

  // The reconciliation line names both readings. It is the most useful
  // sentence NOTICE produces, so prefer it over the invariant failure.
  const comparison = incident.evidence.find((line) => line.includes('witness read'));

  const headline =
    incident.classification === 'genuine_source_change'
      ? `${collectorName}: the site changed, collector left alone`
      : `${collectorName}: ${fields} is not trustworthy (${incident.classification})`;

  return comparison === undefined ? headline : `${headline}\n${comparison}`;
}

/**
 * Send an incident to a webhook.
 *
 * Never throws. A notification is a courtesy on top of a decision that has
 * already been recorded, and losing the quarantine because a chat service was
 * down would be an absurd trade.
 *
 * @returns True when a request was made and accepted.
 */
export async function notifyIncident(
  config: NotifyConfig,
  incident: IncidentRecord,
  collectorName: string,
): Promise<boolean> {
  const url = config.webhookUrl?.trim();
  if (url === undefined || url === '') return false;
  if (!NOTIFIABLE.has(incident.classification)) return false;

  const link =
    config.dashboardUrl === undefined || config.dashboardUrl.trim() === ''
      ? undefined
      : `${config.dashboardUrl.replace(/\/+$/, '')}/incidents/${incident.id}`;

  const text = [
    summarize(incident, collectorName),
    incident.quarantined ? 'The value is withheld from the feed.' : null,
    link,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // Slack and Discord both render this field. Everything else is for
        // whatever parses the body instead of displaying it.
        text,
        incidentId: incident.id,
        collector: collectorName,
        classification: incident.classification,
        confidence: incident.confidence,
        affectedFields: incident.affectedFields,
        quarantined: incident.quarantined,
        evidence: incident.evidence,
        ...(link === undefined ? {} : { url: link }),
      }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
