import { api } from '@/lib/api';
import type { HealthEnvelope } from '@/lib/types';

/**
 * What a consumer actually receives for this collector.
 *
 * Everything else in the dashboard explains how NOTICE reached a decision.
 * This is the decision: the exact envelope served to a downstream application,
 * an agent over MCP, or anything else reading the feed.
 *
 * Worth showing verbatim because the interesting cases are the ones where the
 * payload is deliberately incomplete. A quarantined field is absent rather
 * than flagged, and staleness is stated rather than implied, so an operator
 * can see that the guarantee holds instead of taking it on trust.
 */
export async function ConsumerFeed({ collectorId, url }: { collectorId: string; url?: string }) {
  let feed: HealthEnvelope | null = null;
  try {
    feed = await api.feed(collectorId, url);
  } catch {
    return null;
  }

  const { status, confidence, lastVerified, stale, fieldsDegraded, reason, incidentId } =
    feed.health;

  const tone =
    status === 'verified'
      ? 'border-verified/40 text-verified'
      : status === 'stale'
        ? 'border-suspect/40 text-suspect'
        : 'border-blocked/40 text-blocked';

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          What a consumer receives
        </h2>
        <span className={`status-chip ${tone}`}>{status}</span>
      </div>

      <p className="max-w-2xl text-sm text-muted">
        The exact envelope served to a downstream application or to an agent over MCP. A
        quarantined field is withheld rather than flagged, so nothing reading this can act on a
        value NOTICE could not verify.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Cell label="Confidence" value={confidence.toFixed(2)} />
        <Cell label="Last verified" value={lastVerified ?? 'never'} />
        <Cell label="Stale" value={stale ? 'yes' : 'no'} />
      </div>

      {reason === null ? null : (
        <p className="border border-surface-border bg-surface-soft p-3 font-mono text-xs text-muted">
          reason: {reason}
          {incidentId === null ? '' : `  ·  incident ${incidentId}`}
        </p>
      )}

      {fieldsDegraded.length > 0 ? (
        <p className="border border-blocked/40 bg-blocked/10 p-3 text-sm text-blocked">
          Withheld: {fieldsDegraded.join(', ')}
        </p>
      ) : null}

      <pre className="overflow-x-auto border border-surface-border bg-surface-soft p-4 font-mono text-xs text-ivory/80">
        {JSON.stringify(feed.data, null, 2)}
      </pre>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-surface-border bg-surface-soft p-3">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 font-mono text-sm text-ivory">{value}</p>
    </div>
  );
}
