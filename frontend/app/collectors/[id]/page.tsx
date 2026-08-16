import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BaselineReview, RunNowButton } from '@/components/CollectorControls';
import { ConfidenceBar, StatusChip } from '@/components/StatusChip';
import { api, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Collector detail.
 *
 * The operational screen: what this collector knows, how much it knows, what
 * it has seen recently, and the two controls that matter, running it now and
 * accepting a baseline.
 */
export default async function CollectorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail;
  try {
    detail = await api.getCollector(id);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) notFound();
    throw caught;
  }

  const { collector, contract, runs, incidents } = detail;
  const open = incidents.filter((incident) => incident.resolvedAt === null && incident.quarantined);
  const hasBaseline = (contract?.sampleCount ?? 0) > 0;

  return (
    <div className="space-y-10">
      <nav className="text-sm">
        <Link href="/" className="text-muted underline underline-offset-4 hover:text-ivory">
          Fleet
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-ivory">{collector.name}</h1>
        <p className="font-mono text-xs text-muted">
          {collector.brightDataCollectorId} on {collector.targetDomain}
        </p>
      </header>

      {!hasBaseline ? (
        <section className="border border-suspect/40 bg-suspect/10 p-4">
          <p className="font-mono text-sm uppercase tracking-wide text-suspect">
            No accepted baseline
          </p>
          <p className="mt-2 text-sm text-muted">
            Statistical checks are disabled until a human accepts specific runs. Declared invariants
            still apply, and every run fetches an independent witness, so nothing is published
            without confirmation. This is deliberate: learning a baseline from the first result
            would let a corrupt first run teach NOTICE that corruption is normal.
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Baseline runs" value={String(contract?.sampleCount ?? 0)} />
        <Stat label="Contract version" value={contract === null ? 'none' : `v${String(contract.version)}`} />
        <Stat label="Open incidents" value={String(open.length)} />
      </section>

      {contract !== null ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Contract confidence
          </h2>
          <ConfidenceBar value={contract.confidence} label="contract confidence" />
          <p className="text-xs text-muted">
            Derived from sample size and deliberately slow. Five runs gives roughly 0.5, twenty
            gives 0.8, and it never reaches 1. A profile learned from a handful of runs must not be
            able to justify rewriting a production collector.
          </p>
          {contract.requiredFields.length > 0 ? (
            <p className="font-mono text-xs text-muted">
              required: {contract.requiredFields.join(', ')}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Observe</h2>
        <RunNowButton collectorId={collector.id} {...(collector.watchUrls[0] === undefined ? {} : { url: collector.watchUrls[0] })} />
        <ul className="font-mono text-xs text-muted">
          {collector.watchUrls.map((url) => (
            <li key={url} className="break-all">
              {url}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Baseline acceptance
        </h2>
        <BaselineReview collectorId={collector.id} runs={runs} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Incidents</h2>
        {incidents.length === 0 ? (
          <p className="text-sm text-muted">Nothing has tripped a contract yet.</p>
        ) : (
          <ul className="space-y-2">
            {incidents.slice(0, 10).map((incident) => (
              <li key={incident.id}>
                <Link
                  href={`/incidents/${incident.id}`}
                  className="flex flex-wrap items-center justify-between gap-4 border border-surface-border bg-surface-raised p-4 hover:border-muted"
                >
                  <span>
                    <StatusChip classification={incident.classification} />
                    <span className="mt-1 block text-sm text-muted">
                      {incident.affectedFields.join(', ') || 'no field isolated'}
                    </span>
                  </span>
                  <time className="font-mono text-xs text-muted" dateTime={incident.createdAt}>
                    {new Date(incident.createdAt).toISOString().replace('T', ' ').slice(0, 16)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-surface-border bg-surface-raised p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl text-ivory">{value}</p>
    </div>
  );
}
