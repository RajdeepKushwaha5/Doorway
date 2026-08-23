import { formatDeadline } from '@/lib/dates';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { DoorwayOpportunity } from '@/lib/types';

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
 * What a student is actually served, and what they are not.
 *
 * This page used to compare headphone prices, which belonged to the retail
 * demonstration the engine was first built against and says nothing about
 * Doorway. The question that matters here is narrower and much more
 * consequential: an aggregator shows you whatever it last scraped, and Doorway
 * shows you only what it can still stand behind.
 *
 * The difference is a deadline. A scholarship page whose closing date moved,
 * or whose extractor started reading the wrong line, will keep serving a date
 * to anyone who does not check. A student plans an evening of work around that
 * date. So every opportunity here is listed with what is known about it, and
 * the ones that cannot be confirmed are shown as held rather than quietly
 * served alongside the rest.
 */

const GROUPS = [
  {
    key: 'verified' as const,
    title: 'Served as current',
    blurb:
      'Two independent Bright Data sensors read the source page and agreed. These are safe to plan around.',
    tone: 'border-verified/40',
  },
  {
    key: 'partially_verified' as const,
    title: 'Served, with the weaker claim stated',
    blurb:
      'These passed the checks learned for their source, but the independent witness was not consulted on this reading. Real, and a smaller claim.',
    tone: 'border-suspect/40',
  },
  {
    key: 'stale' as const,
    title: 'Served with its age attached',
    blurb:
      'Two sensors agreed on this once, but not recently. The date is shown so nobody mistakes it for a fresh reading.',
    tone: 'border-suspect/40',
  },
  {
    key: 'quarantined' as const,
    title: 'Withheld',
    blurb:
      'The source changed and the two readings no longer agree. An aggregator would still be serving the old value. Doorway holds it back and says so.',
    tone: 'border-blocked/40',
  },
];

export default async function VerifiedPage() {
  let opportunities: DoorwayOpportunity[] = [];
  let offline = false;

  try {
    ({ opportunities } = await api.doorwayOpportunities());
  } catch {
    offline = true;
  }

  const counted = (status: DoorwayOpportunity['trust']['status']): DoorwayOpportunity[] =>
    opportunities.filter((opportunity) => opportunity.trust.status === status);

  const withheld = counted('quarantined').length;

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
            The verified feed
          </div>
          <h1 className="mt-3 max-w-[900px] font-mondwest text-[clamp(34px,5vw,60px)] leading-[0.95] tracking-[-0.02em]">
            Every opportunity, and how far we will vouch for it.
          </h1>
          <p className="mt-5 max-w-[760px] font-mono text-[13px] leading-relaxed text-gray-600">
            An aggregator shows whatever it last scraped. A closing date that moved, or an extractor
            that started reading the wrong line, keeps being served to anyone who does not check.
            Students plan around those dates. So nothing reaches the world above without a stated
            basis, and anything that cannot be confirmed is held rather than quietly mixed in.
          </p>
        </header>

        {offline ? (
          <p className="mt-10 border border-neutral-300 bg-neutral-50 p-5 font-mono text-[13px] leading-relaxed text-neutral-800">
            The Doorway API could not be reached, so this page cannot say what is currently served.
            It shows nothing rather than a cached guess.
          </p>
        ) : opportunities.length === 0 ? (
          <p className="mt-10 border border-gray-200 bg-gray-50 p-5 font-mono text-[13px] leading-relaxed text-gray-600">
            No opportunity source has produced a verified reading yet. Register a collector in the
            engine and the feed fills from the first agreed observation. Doorway does not seed
            itself with examples.
          </p>
        ) : (
          <>
            <div className="mt-10 grid gap-px border border-gray-200 bg-gray-200 sm:grid-cols-4">
              <Stat label="Opportunities" value={opportunities.length} />
              <Stat label="Two sensors agree" value={counted('verified').length} />
              <Stat label="Contract only" value={counted('partially_verified').length} />
              <Stat label="Withheld" value={withheld} tone={withheld > 0 ? 'text-blocked' : ''} />
            </div>

            {GROUPS.map((group) => {
              const rows = counted(group.key);
              if (rows.length === 0) return null;
              return (
                <section key={group.key} className={`mt-10 border ${group.tone}`}>
                  <div className="border-b border-inherit px-6 py-4">
                    <h2 className="font-mondwest text-2xl leading-tight">{group.title}</h2>
                    <p className="mt-1 max-w-[720px] font-mono text-[12px] leading-relaxed text-gray-600">
                      {group.blurb}
                    </p>
                  </div>
                  <ul className="divide-y divide-gray-200">
                    {rows.map((opportunity) => (
                      <li key={opportunity.id}>
                        <Link
                          href={`/opportunities/${opportunity.id}`}
                          className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 transition-colors hover:bg-gray-50"
                        >
                          <span className="min-w-0">
                            <span className="block font-mono text-[13px] font-semibold">
                              {opportunity.title}
                            </span>
                            <span className="block font-mono text-[11.5px] text-gray-500">
                              {opportunity.provider} · {opportunity.type.replace('-', ' ')}
                              {opportunity.deadline === null && opportunity.deadlineRaw === null
                                ? ''
                                : ` · ${formatDeadline(opportunity.deadline, opportunity.deadlineRaw)}`}
                            </span>
                          </span>
                          <span className="font-mono text-[11.5px] text-gray-500">
                            checked {opportunity.trust.lastVerifiedAt.replace('T', ' ').slice(0, 16)}
                            {opportunity.trust.fieldsDegraded.length > 0
                              ? ` · withheld: ${opportunity.trust.fieldsDegraded.join(', ')}`
                              : ''}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}

        <section className="mt-12 border border-black p-6">
          <h2 className="font-mondwest text-2xl leading-tight">Check any of it yourself</h2>
          <p className="mt-2 max-w-[760px] font-mono text-[12.5px] leading-relaxed text-gray-600">
            Every verdict exports as a certificate carrying both readings, the line the witness read
            them from, and a SHA-256 of the page body. The digest can be re-derived in your own
            browser, so none of this requires trusting our server.
          </p>
          <Link
            href="/verify"
            className="mt-5 inline-block border border-black px-5 py-2.5 font-neuebit text-[11px] uppercase tracking-[0.12em] transition-colors hover:bg-black hover:text-white"
          >
            Verify a certificate →
          </Link>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-white p-5">
      <div className={`font-mondwest text-4xl leading-none ${tone}`}>{value}</div>
      <div className="mt-1.5 font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-500">
        {label}
      </div>
    </div>
  );
}
