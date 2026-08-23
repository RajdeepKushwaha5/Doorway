import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BaselineReview, RunNowButton } from '@/components/CollectorControls';
import { ConfidenceBar, StatusChip } from '@/components/StatusChip';
import { AutomationPolicy } from '@/components/AutomationPolicy';
import { ConsumerFeed } from '@/components/ConsumerFeed';
import { TrustHistory } from '@/components/TrustHistory';
import { WitnessSpecEditor } from '@/components/WitnessSpecEditor';
import { api, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/*
 * Long enough to outlast a cold start.
 *
 * This page reads on the server, and the backend runs on a free plan that
 * suspends after fifteen minutes idle. Without this, the platform ends the
 * render while the API is still waking and the visitor gets the unreachable
 * state for a service that was about to answer.
 */
export const maxDuration = 60;

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

  // A healthy observation is stored as an incident too, and listing those
  // filled this section with rows reading "Verified, no field isolated" that
  // buried the one incident worth opening.
  const notable = incidents.filter((incident) => incident.classification !== 'healthy');
  const hasBaseline = (contract?.sampleCount ?? 0) > 0;

  return (
    <div className="bg-surface pt-20">
      {/* Every other page constrains its width; this one did not, so on a wide
          monitor each row of JSON and the trust chart stretched the full
          viewport and the header sat under the fixed nav. */}
      <div className="section-index mx-auto max-w-6xl">
        <span>COLLECTOR</span>
        <span>[ OPERATIONS ]</span>
      </div>
      <div className="mx-auto max-w-6xl space-y-10 px-6 pb-24 pt-12 lg:px-8">
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
        {/* "v1" beside "Baseline runs 0" read as a contradiction. A contract is
            created empty on the first observation so declared invariants can be
            enforced immediately; the version is real, the statistics are not
            there yet, and saying which is which removes the confusion. */}
        <Stat
          label="Contract version"
          value={
            contract === null
              ? 'none'
              : contract.sampleCount === 0
                ? `v${String(contract.version)}, invariants only`
                : `v${String(contract.version)}`
          }
        />
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

      {/*
        * Where this scraper came from.
        *
        * Shown before anything about how it behaves, because whether to trust
        * a collector starts with what it was asked to do and what its author
        * looked at before deciding. Absence is printed as absence: a collector
        * built before anybody recorded this has no birth certificate, and
        * writing a plausible one afterwards would be manufacturing the exact
        * kind of confident, unverified claim this system exists to catch.
        */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          How this scraper was built
        </h2>
        {collector.provenance === undefined ? (
          <p className="border border-dashed border-muted/40 p-4 font-mono text-xs leading-relaxed text-muted">
            No record of how this collector was created. It predates provenance being kept, and
            nothing here will guess at a brief that was not written down.
          </p>
        ) : (
          <div className="space-y-4 border border-muted/30 p-4">
            {/*
              * A reconstruction says so, in the place the brief would be.
              *
              * These collectors were built before any of this was kept, and
              * Bright Data does not expose the original sentence for reading
              * back. What follows is what the page shows now and what this
              * collector protects, which is real and checkable and is not the
              * same as knowing what its author meant.
              */}
            {collector.provenance.description === undefined ? (
              <div className="border-l-2 border-muted/40 pl-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  Reconstructed, not recorded
                </div>
                <p className="mt-1 font-mono text-xs leading-relaxed text-muted">
                  This collector predates provenance being kept, and the brief it was built from
                  was not stored. Nothing here guesses at it. What follows was read from the page
                  and from what this collector is configured to protect.
                </p>
              </div>
            ) : (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {collector.provenance.reconstructed === true
                    ? 'Brief, reconstructed after the fact'
                    : 'The brief given to Scraper Studio'}
                </div>
                <p className="mt-1 font-mono text-xs leading-relaxed">
                  {collector.provenance.description}
                </p>
              </div>
            )}

            {collector.provenance.observations.length > 0 ? (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {collector.provenance.reconstructed === true
                    ? 'What the page shows now'
                    : 'What the agent saw before choosing'}
                </div>
                <ul className="mt-1 space-y-0.5 font-mono text-xs leading-relaxed text-muted">
                  {collector.provenance.observations.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {Object.keys(collector.provenance.protectedBecause).length > 0 ? (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  Protected, and why
                </div>
                <ul className="mt-1 space-y-0.5 font-mono text-xs leading-relaxed text-muted">
                  {Object.entries(collector.provenance.protectedBecause).map(([field, why]) => (
                    <li key={field}>
                      <span className="text-ivory">{field}</span> {why}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="font-mono text-[11px] text-muted">
              created by {collector.provenance.createdBy.replace(/_/g, ' ')}
              {collector.provenance.generationSeconds === undefined
                ? null
                : `, generated in ${String(
                    Math.round(collector.provenance.generationSeconds / 60),
                  )} minutes`}
            </div>
          </div>
        )}
      </section>

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

      <AutomationPolicy policy={collector.autoPromote} />

      <ConsumerFeed collectorId={collector.id} url={collector.watchUrls[0]} />

      {/* The runs were already listed one per row, which answers "did it run".
          The question about a source is whether its numbers have been worth
          trusting, and when that stopped. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Trust history
        </h2>
        <TrustHistory collector={collector} runs={runs} incidents={incidents} />
      </section>

      {/* PUT /api/collectors/:id existed to make exactly this correctable
          without a store reset, and had no interface until now. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          How the witness reads this page
        </h2>
        <WitnessSpecEditor collectorId={collector.id} specs={collector.witnessSpecs ?? []} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Baseline acceptance
        </h2>
        <BaselineReview collectorId={collector.id} runs={runs} incidents={incidents} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Incidents</h2>
        {notable.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing has disagreed yet. Every observation of this collector agreed with its
            independent witness.
          </p>
        ) : (
          <ul className="space-y-2">
            {notable.slice(0, 10).map((incident) => (
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
