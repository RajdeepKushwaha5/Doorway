import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { DoorwayOpportunity } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * One opportunity, and everything known about where its values came from.
 *
 * The world shows which door to walk through. This page is what a student
 * needs before they spend an evening on an application: what the source
 * actually said, when anybody last checked, what could not be confirmed, and a
 * link to the page the values were read off so they can check it themselves.
 *
 * The trust state is not a badge in the corner. A deadline nobody has verified
 * this week is the difference between applying and missing, so where a field is
 * uncertain the page says so beside the field rather than in a footnote.
 */

const STATUS: Record<
  DoorwayOpportunity['trust']['status'],
  { label: string; tone: string; note: string }
> = {
  verified: {
    label: 'Verified',
    tone: 'border-emerald-500/40 bg-emerald-50 text-emerald-700 font-semibold',
    note: 'Two independent Bright Data sensors read this page and agreed on the values below.',
  },
  partially_verified: {
    label: 'Partially verified',
    tone: 'border-neutral-300 bg-neutral-50 text-neutral-800',
    note: 'These values passed the checks learned for this source, but the independent witness was not consulted on this reading.',
  },
  discovered: {
    label: 'Found live, not verified',
    tone: 'border-amber-500/40 bg-amber-50 text-amber-800 font-semibold',
    note: 'This page was found by searching the live web and read once, moments ago. There is no history to check it against and no second reading to agree with, so treat every value below as the page said it rather than as something we stand behind. Open the source before you plan around a date.',
  },
  stale: {
    label: 'Stale',
    tone: 'border-neutral-300 bg-neutral-50 text-neutral-800',
    note: 'Two sensors agreed on this once, but not recently. Treat the deadline in particular as unconfirmed.',
  },
  quarantined: {
    label: 'Withheld',
    tone: 'border-blocked/40 bg-red-50 text-blocked',
    note: 'The source changed and the readings no longer agree, so these values are held back rather than shown as current.',
  },
};

function formatDeadline(iso: string | null): string | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  const date = new Date(at).toISOString().slice(0, 10);
  if (days < 0) return `${date} · closed`;
  return `${date} · ${String(days)} day${days === 1 ? '' : 's'} left`;
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let opportunity: DoorwayOpportunity;
  try {
    opportunity = await api.doorwayOpportunity(id);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) notFound();
    throw caught;
  }

  const status = STATUS[opportunity.trust.status];
  const deadline = formatDeadline(opportunity.deadline);
  const quarantined = opportunity.trust.status === 'quarantined';
  const closed = opportunity.applicationStatus === 'closed';
  const singleReadMissing =
    opportunity.trust.status === 'discovered' &&
    opportunity.trust.confirmedBy === 'single_sensor';

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-[1100px] px-6 py-16 lg:px-10">
        <nav className="font-mono text-[12px]">
          <Link href="/" className="text-gray-500 underline underline-offset-4 hover:text-black">
            The world
          </Link>
        </nav>

        <header className="mt-6 border-b border-black pb-8">
          <div className="font-neuebit text-[11px] uppercase tracking-[0.18em] text-emerald-600 font-bold">
            {opportunity.type.replace('-', ' ')} · {opportunity.provider}
          </div>
          <h1 className="mt-3 max-w-[900px] font-mondwest text-[clamp(34px,5vw,60px)] leading-[0.95] tracking-[-0.02em]">
            {opportunity.title}
          </h1>
          {opportunity.summary === '' ? null : (
            <p className="mt-4 max-w-[760px] font-mono text-[13px] leading-relaxed text-gray-600">
              {opportunity.summary}
            </p>
          )}

          <div className={`mt-6 inline-block border px-4 py-2 font-mono text-[12px] ${status.tone}`}>
            <span className="font-semibold uppercase tracking-[0.12em]">{status.label}</span>
            <span className="ml-2">
              last checked {opportunity.trust.lastVerifiedAt.replace('T', ' ').slice(0, 16)}
            </span>
          </div>
          <p className="mt-2 max-w-[760px] font-mono text-[12px] leading-relaxed text-gray-600">
            {status.note}
          </p>
          <p className="mt-2 max-w-[760px] font-mono text-[12px] leading-relaxed text-gray-700">
            Application status: <strong>{opportunity.applicationStatus}</strong>.{' '}
            {opportunity.statusReason}
          </p>
        </header>

        <section className="mt-10 grid gap-px border border-gray-200 bg-gray-200 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Funding">
            {opportunity.funding.amount === null
              ? opportunity.funding.level
              : `${opportunity.funding.currency ?? ''} ${opportunity.funding.amount.toLocaleString()}`.trim()}
            <span className="mt-1 block text-[11px] text-gray-500">
              {opportunity.funding.level === 'unspecified'
                ? 'the source does not state what this covers'
                : `${opportunity.funding.level} funding${
                    opportunity.funding.coverage.length > 0
                      ? ` · ${opportunity.funding.coverage.join(', ')}`
                      : ''
                  }`}
            </span>
          </Fact>

          <Fact label="Deadline" degraded={opportunity.trust.fieldsDegraded.includes('deadline')}>
            {opportunity.deadlineRaw ?? deadline ?? 'not stated on the page'}
            {opportunity.deadlineRaw !== null && deadline !== null ? (
              <span className="mt-1 block text-[11px] text-gray-500">{deadline}</span>
            ) : null}
          </Fact>

          <Fact label="Where">
            {opportunity.locations.length > 0 ? opportunity.locations.join(', ') : 'not stated'}
            <span className="mt-1 block text-[11px] text-gray-500">
              {opportunity.remote === null
                ? 'remote status not stated'
                : opportunity.remote
                  ? 'remote'
                  : 'on site'}
            </span>
          </Fact>

          <Fact label="Confirmed by">
            {opportunity.trust.confirmedBy === 'two_sensors'
              ? 'two independent sensors'
              : opportunity.trust.confirmedBy === 'single_sensor'
                ? 'one live Bright Data reading'
                : 'learned contract only'}
          </Fact>
        </section>

        <section className="mt-10 grid gap-px border border-gray-200 bg-gray-200 md:grid-cols-2">
          <Panel title="Eligibility, as the page states it">
            {opportunity.eligibility.length === 0 ? (
              <p className="font-mono text-[12px] leading-relaxed text-gray-600">
                The source does not publish structured eligibility rules. Read the original page
                before applying; Doorway will not guess who qualifies.
              </p>
            ) : (
              <ul className="space-y-1.5 font-mono text-[12.5px] leading-relaxed">
                {opportunity.eligibility.map((rule) => (
                  <li key={rule}>· {rule}</li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="What you will need">
            {opportunity.requiredDocuments.length === 0 ? (
              <p className="font-mono text-[12px] leading-relaxed text-gray-600">
                The source does not list required documents.
              </p>
            ) : (
              <ul className="space-y-1.5 font-mono text-[12.5px] leading-relaxed">
                {opportunity.requiredDocuments.map((document) => (
                  <li key={document}>· {document}</li>
                ))}
              </ul>
            )}
          </Panel>
        </section>

        <section className="mt-10 border border-black">
          <div className="border-b border-black px-6 py-4 font-neuebit text-[11px] uppercase tracking-[0.16em]">
            Where these values came from
          </div>
          <div className="p-6">
            <p className="break-all font-mono text-[12.5px] text-gray-600">
              {opportunity.sourceUrl}
            </p>
            <p className="mt-3 max-w-[760px] font-mono text-[12px] leading-relaxed text-gray-600">
              {opportunity.trust.status === 'discovered'
                ? opportunity.trust.confirmedBy === 'two_sensors'
                  ? 'Bright Data found and opened this live page. NOTICE then compared its visible text with the page structured data, and the two readings agreed on the deadline.'
                  : 'Bright Data found and opened this live page. It has not yet joined the continuously watched Scraper Studio fleet, so NOTICE labels it as one reading rather than pretending it is verified.'
                : 'A Bright Data Scraper Studio collector extracted this page and NOTICE checked its fields against the source contract. Two-sensor records were also confirmed by the independent Web Unlocker witness.'}
            </p>

            {opportunity.trust.fieldsDegraded.length > 0 ? (
              <p
                className={`mt-4 border p-3 font-mono text-[12px] leading-relaxed ${
                  singleReadMissing
                    ? 'border-amber-500/40 bg-amber-50 text-amber-800'
                    : 'border-blocked/40 bg-red-50 text-blocked'
                }`}
              >
                {singleReadMissing
                  ? `Not stated in this live reading: ${opportunity.trust.fieldsDegraded.join(', ')}. Doorway leaves these fields unknown instead of guessing.`
                  : `Currently withheld: ${opportunity.trust.fieldsDegraded.join(', ')}. The verification checks could not support the current values, so Doorway does not present them as trusted.`}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={opportunity.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-black px-5 py-2.5 font-neuebit text-[11px] uppercase tracking-[0.12em] transition-colors hover:bg-black hover:text-white"
              >
                Read the source ↗
              </a>

              {quarantined || closed ? (
                <span className="border border-blocked bg-red-50 px-5 py-2.5 font-neuebit text-[11px] uppercase tracking-[0.12em] text-blocked">
                  {closed ? 'Applications closed' : 'Application held until re-verified'}
                </span>
              ) : (
                <a
                  href={opportunity.applicationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-black bg-black px-5 py-2.5 font-neuebit text-[11px] uppercase tracking-[0.12em] text-white transition-colors hover:bg-white hover:text-black"
                >
                  Apply ↗
                </a>
              )}

              {opportunity.trust.incidentId === null ? null : (
                <Link
                  href={`/incidents/${opportunity.trust.incidentId}`}
                  className="border border-black px-5 py-2.5 font-neuebit text-[11px] uppercase tracking-[0.12em] transition-colors hover:bg-black hover:text-white"
                >
                  Why it is held ↗
                </Link>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Fact({
  label,
  degraded = false,
  children,
}: {
  label: string;
  degraded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-white p-5 ${degraded ? 'ring-1 ring-inset ring-blocked/40' : ''}`}>
      <div className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-500">
        {label}
        {degraded ? <span className="ml-2 text-blocked">withheld</span> : null}
      </div>
      <div className="mt-1.5 font-mono text-[13.5px] leading-snug">{children}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white p-6">
      <div className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-500">
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
