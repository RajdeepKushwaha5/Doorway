import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ShieldCheck, Wrench } from '@phosphor-icons/react/dist/ssr';
import { EvidenceTimeline, WitnessComparison } from '@/components/EvidenceTimeline';
import { apiBase } from '@/lib/env';
import { GateMatrix } from '@/components/GateMatrix';
import { RepairDiff } from '@/components/RepairDiff';
import { AuditLog } from '@/components/AuditLog';
import { AcquisitionPanel } from '@/components/AcquisitionPanel';
import { IncidentActions } from '@/components/IncidentActions';
import { ConfidenceBar, StatusChip, classificationHint } from '@/components/StatusChip';
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
 * The hero screen.
 *
 * Ordered as an argument, not a dashboard: what happened, what the independent
 * sensor saw, what NOTICE concluded and why, what it asked Bright Data to fix,
 * and whether the proposed repair earned its way into production.
 */
export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let incident;
  let run;
  let audit;
  try {
    ({ incident, run, audit } = await api.getIncident(id));
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) notFound();
    throw caught;
  }

  const gateApproved =
    incident.gateResults.length > 0 && incident.gateResults.every((result) => result.passed);

  return (
    <div className="bg-surface pt-20">
      <div className="section-index mx-auto max-w-7xl"><span>INCIDENT EVIDENCE</span><span>[ AUDIT RECORD ]</span></div>
      <div className="mx-auto max-w-7xl space-y-8 px-6 pb-24 pt-16 lg:px-8">
      <nav className="text-sm">
        <Link href="/#control-room" className="inline-flex items-center gap-2 text-muted transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-ivory">
          <ArrowLeft size={16} /> Control room
        </Link>
      </nav>

      <header data-reveal className="incident-hero">
        <div className="flex flex-wrap items-center gap-4">
          <StatusChip classification={incident.classification} />
          <ConfidenceBar value={incident.confidence} label="classification confidence" />
          {incident.quarantined ? (
            <span className="status-chip border-ember/40 bg-coralSoft text-ember">Quarantined</span>
          ) : null}
        </div>
        <p className="eyebrow mt-10">Incident evidence</p>
        <h1 className="mt-4 max-w-4xl break-all text-3xl font-medium tracking-tight text-ivory sm:break-words md:text-5xl">
          {incident.affectedFields.length > 0
            ? `${incident.affectedFields.join(', ')} on ${incident.witness?.url ?? 'unknown URL'}`
            : (incident.witness?.url ?? 'Incident')}
        </h1>
        <p className="mt-6 max-w-2xl text-sm text-muted">
          {classificationHint(incident.classification)}
        </p>
      </header>

      <section data-reveal data-delay="1" className="evidence-section">
        <div className="evidence-section__heading"><p>01</p><div><p className="eyebrow">Decision</p><h2>Why NOTICE reached this verdict</h2></div></div>
        <ul className="space-y-2 text-sm text-muted">
          {incident.evidence.map((line, index) => (
            <li key={index} className="border border-surface-border bg-surface-soft p-4 text-muted">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section data-reveal data-delay="2" className="evidence-section">
        <div className="evidence-section__heading"><p>02</p><div><p className="eyebrow">Second signal</p><h2>Independent Bright Data witness</h2></div></div>
        <WitnessComparison incident={incident} />
      </section>

      {/* Before a reader can accept that two sensors disagreed about a page,
          they have to be shown the two sensors were reading the same page.
          This rules the boring explanation out, or names it. */}
      <section data-reveal data-delay="2" className="evidence-section">
        <div className="evidence-section__heading">
          <p>02a</p>
          <div>
            <p className="eyebrow">Conditions</p>
            <h2>How each sensor reached the page</h2>
          </div>
        </div>
        <AcquisitionPanel incident={incident} />
      </section>

      {/* A verdict a reader cannot check is a verdict they have to take on
          trust, which is the thing this project argues against. */}
      <section data-reveal data-delay="2" className="evidence-section">
        <div className="evidence-section__heading">
          <p>02b</p>
          <div>
            <p className="eyebrow">Check it yourself</p>
            <h2>Evidence certificate</h2>
          </div>
        </div>
        <p className="text-sm leading-6 text-muted">
          This verdict, both readings, and a SHA-256 of the page body the witness read, in one
          document with a digest over all of it. Edit any value and the digest stops matching.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={`${apiBase()}/api/incidents/${incident.id}/certificate`}
            className="secondary-button"
          >
            Download certificate
          </a>
          <Link href="/verify" className="secondary-button">
            Verify one <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      {incident.screenshotId !== null ? (
        <section data-reveal data-delay="2" className="evidence-section">
          <div className="evidence-section__heading">
            <p>03</p>
            <div>
              <p className="eyebrow">What the page showed</p>
              <h2>The page at the moment it broke</h2>
            </div>
          </div>
          <p className="mb-6 max-w-2xl text-sm text-muted">
            Captured through Bright Data Web Unlocker when this incident opened. The witness above
            records what the page said; this records what it showed. Before approving a repair, the
            question is what was actually on the page, and two numbers in a table answer that less
            well than the page itself.
          </p>
          {/* A plain img, deliberately. This is a PNG of arbitrary size
              served from the API rather than a bundled asset, so the image
              optimizer has nothing to optimize and would only add a failure
              mode between the reader and their evidence. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${apiBase()}/api/incidents/${incident.id}/screenshot`}
            alt="Rendered capture of the page when the incident opened"
            className="w-full border border-surface-border bg-surface-soft"
            loading="lazy"
          />
        </section>
      ) : null}

      {incident.repairPrompt !== null ? (
        <section data-reveal data-delay="3" className="evidence-section">
          <div className="evidence-section__heading"><p>03b</p><div><p className="eyebrow">Repair instruction</p><h2>Diagnosis sent to Self Healing</h2></div></div>
          <pre className="overflow-x-auto whitespace-pre-wrap border border-surface-border bg-surface-soft p-6 font-mono text-sm text-muted">
            {incident.repairPrompt}
          </pre>
          <p className="text-sm text-muted">
            {incident.repairPrompt.length} of 1000 characters. The incident URL is sent in{' '}
            <code>custom_input</code>, which the CLI does not forward, so the healer sees the page
            that actually failed.
          </p>
        </section>
      ) : null}

      <section data-reveal className="evidence-section">
        <div className="evidence-section__heading"><p>04</p><ShieldCheck size={24} /><div><p className="eyebrow">Safety gate</p><h2>Candidate verification</h2></div></div>
        <GateMatrix
          results={incident.gateResults}
          approved={gateApproved}
          reasons={
            gateApproved
              ? ['The incident page recovered and every regression case held.']
              : [
                  'A repair is promoted only after it fixes the incident and leaves every previously working page intact.',
                ]
          }
        />
        {/* Pass or fail is the decision. This is the evidence behind it, which
            is what somebody is actually looking for with their hand on the
            approve button. */}
        <RepairDiff results={incident.gateResults} run={run} />
      </section>

      <section data-reveal className="evidence-section">
        <div className="evidence-section__heading"><p>05</p><Wrench size={24} /><div><p className="eyebrow">Operator</p><h2>What you can do about it</h2></div></div>
        <IncidentActions incident={incident} />
      </section>

      <section data-reveal className="evidence-section">
        <div className="evidence-section__heading"><p>06</p><div><p className="eyebrow">Audit trail</p><h2>Every transition, in order</h2></div></div>
        <EvidenceTimeline incident={incident} />

        {/* The timeline says how the incident moved between states. This says
            who moved it, which is the question anyone auditing an automated
            repair actually has. The backend has written these from the start
            and returned them on every fetch; nothing displayed them. */}
        <div className="mt-8">
          <p className="eyebrow">System log</p>
          <p className="mb-4 mt-1 text-sm leading-6 text-muted">
            Every action recorded against this incident, and whether NOTICE, Bright Data or an
            operator took it.
          </p>
          <AuditLog events={audit} />
        </div>
      </section>
      </div>
    </div>
  );
}
