'use client';

import { useMemo, useState, useTransition } from 'react';
import { IsometricWorld } from '@/components/IsometricWorld';
import Link from 'next/link';
import { buildDoorwayWorldAction } from '@/app/actions';
import type {
  DoorwayMatch,
  DoorwayProfile,
  DoorwayWorld,
  OpportunityType,
} from '@/lib/types';

const TYPES: { value: OpportunityType; label: string }[] = [
  { value: 'scholarship', label: 'Scholarships' },
  { value: 'fellowship', label: 'Fellowships' },
  { value: 'internship', label: 'Internships' },
  { value: 'research-program', label: 'Research' },
  { value: 'grant', label: 'Grants' },
  { value: 'hackathon', label: 'Hackathons' },
];

const DEFAULT_PROFILE: DoorwayProfile = {
  country: 'India',
  educationLevel: 'Undergraduate',
  interests: ['Artificial intelligence'],
  skills: [],
  opportunityTypes: ['scholarship', 'fellowship', 'internship', 'research-program'],
  fundingRequirement: 'full',
  locations: [],
};

export function DoorwayHome({ initialWorld = null }: { initialWorld?: DoorwayWorld | null }) {
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [interest, setInterest] = useState('Artificial intelligence');
  /*
   * Built on the server for the default profile, so the city is standing when
   * the page opens.
   *
   * This started empty and only filled after the form was submitted, which
   * meant anybody arriving at the site, a judge included, met an empty state
   * and had to work out that a button would populate it. The transformation is
   * the entire argument of this product; it should not be behind an
   * interaction. Changing the profile still rebuilds it live.
   */
  const [world, setWorld] = useState<DoorwayWorld | null>(initialWorld);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    const next = { ...profile, interests: splitList(interest) };
    setProfile(next);
    setError(null);
    startTransition(async () => {
      const result = await buildDoorwayWorldAction(next);
      if (result.ok) setWorld(result.data);
      else setError(result.error);
    });
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <section className="doorway-hero border-b border-gray-200">
        <div className="mx-auto grid min-h-[680px] max-w-[1400px] lg:grid-cols-[0.92fr_1.08fr]">
          <div className="flex flex-col justify-center border-gray-200 px-6 py-16 lg:border-r lg:px-12">
            <div className="mb-6 flex items-center gap-3 font-neuebit text-[12px] uppercase tracking-[0.18em] text-gray-500">
              <span className="h-2 w-2 bg-[#f06449]" /> Live opportunity infrastructure
            </div>
            <h1 className="font-mondwest text-[clamp(62px,7vw,108px)] font-normal leading-[0.83] tracking-[-0.04em]">
              The web is full of doors.
              <span className="block text-[#f06449]">Find yours.</span>
            </h1>
            <p className="mt-8 max-w-[610px] font-mono text-[15px] leading-7 text-gray-600">
              Doorway turns scattered scholarships, fellowships, internships and grants into a
              living world built from official sources. Bright Data keeps every door current when
              the web changes.
            </p>

            <div className="mt-9 grid gap-px border border-gray-200 bg-gray-200 sm:grid-cols-3">
              {[
                ['01', 'Discover', 'Official long-tail sources'],
                ['02', 'Structure', 'Scraper Studio collectors'],
                ['03', 'Prove', 'Two-sensor verification'],
              ].map(([number, title, copy]) => (
                <div key={number} className="bg-white p-4">
                  <div className="font-neuebit text-[11px] tracking-[0.15em] text-[#f06449]">{number}</div>
                  <div className="mt-4 font-mondwest text-2xl">{title}</div>
                  <div className="mt-1 font-mono text-[10px] leading-5 text-gray-500">{copy}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="doorway-grid relative flex items-center justify-center overflow-hidden bg-[#f6f4ef] p-6 lg:p-12">
            <div className="doorway-orbit doorway-orbit-one" />
            <div className="doorway-orbit doorway-orbit-two" />
            <div className="relative z-10 w-full max-w-[610px] border border-black bg-white shadow-[18px_18px_0_#0c0c0a]">
              <div className="flex items-center justify-between border-b border-black px-5 py-3 font-neuebit text-[11px] uppercase tracking-[0.15em]">
                <span>Build my opportunity world</span>
                <span className="text-[#f06449]">Bright Data live</span>
              </div>
              <div className="space-y-6 p-5 sm:p-7">
                <Field label="I am based in">
                  <input
                    value={profile.country}
                    onChange={(event) => setProfile({ ...profile, country: event.target.value })}
                    className="doorway-input"
                    aria-label="Country"
                  />
                </Field>
                <Field label="I am a">
                  <select
                    value={profile.educationLevel}
                    onChange={(event) =>
                      setProfile({ ...profile, educationLevel: event.target.value })
                    }
                    className="doorway-input"
                    aria-label="Education level"
                  >
                    <option>School student</option>
                    <option>Undergraduate</option>
                    <option>Postgraduate</option>
                    <option>Researcher</option>
                    <option>Early-career professional</option>
                  </select>
                </Field>
                <Field label="I want to work on">
                  <input
                    value={interest}
                    onChange={(event) => setInterest(event.target.value)}
                    className="doorway-input"
                    placeholder="AI, climate, public policy"
                    aria-label="Interests"
                  />
                </Field>
                <fieldset>
                  <legend className="font-neuebit text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Show me
                  </legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {TYPES.map((type) => {
                      const active = profile.opportunityTypes.includes(type.value);
                      return (
                        <button
                          key={type.value}
                          type="button"
                          onClick={() =>
                            setProfile({
                              ...profile,
                              opportunityTypes: active
                                ? profile.opportunityTypes.filter((value) => value !== type.value)
                                : [...profile.opportunityTypes, type.value],
                            })
                          }
                          className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ${
                            active
                              ? 'border-black bg-black text-white'
                              : 'border-gray-300 bg-white text-gray-600 hover:border-black'
                          }`}
                        >
                          {type.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending || profile.opportunityTypes.length === 0}
                  className="flex min-h-14 w-full items-center justify-between bg-[#f06449] px-5 font-neuebit text-[13px] uppercase tracking-[0.14em] text-black transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{pending ? 'Constructing your world' : 'Open the map'}</span>
                  <span>{pending ? '···' : '↗'}</span>
                </button>
                {error !== null ? (
                  <p className="border-l-2 border-red-600 pl-3 font-mono text-[11px] text-red-700">
                    {error}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <WorldSection world={world} pending={pending} />
      <HowItLives />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-neuebit text-[11px] uppercase tracking-[0.14em] text-gray-500">
        {label}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function WorldSection({ world, pending }: { world: DoorwayWorld | null; pending: boolean }) {
  return (
    <section id="world" className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-[1400px] px-6 py-20 lg:px-12">
        <div className="flex flex-col justify-between gap-7 border-b border-black pb-8 md:flex-row md:items-end">
          <div>
            <div className="font-neuebit text-[11px] uppercase tracking-[0.18em] text-[#f06449]">
              01 / Opportunity world
            </div>
            <h2 className="mt-4 max-w-[850px] font-mondwest text-[clamp(48px,6vw,82px)] leading-[0.9] tracking-[-0.03em]">
              Every building is a real door you can open.
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-px border border-gray-200 bg-gray-200 sm:grid-cols-4">
            {[
              ['Sources', world?.stats.sources ?? 0],
              ['Matches', world?.stats.opportunities ?? 0],
              ['Verified', world?.stats.verified ?? 0],
              ['Closing', world?.stats.closingSoon ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="min-w-[105px] bg-white p-3">
                <div className="font-mondwest text-3xl">{value}</div>
                <div className="font-neuebit text-[9px] uppercase tracking-[0.14em] text-gray-500">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {pending ? <WorldSkeleton /> : null}
        {!pending && world === null ? <EmptyWorld initial /> : null}
        {!pending && world !== null && world.matches.length === 0 ? <EmptyWorld initial={false} /> : null}
        {/* The world first, because the transformation is the point: a pile of
            unrelated websites became a place you can read at a glance. The
            cards stay underneath for the detail the geometry cannot carry. */}
        {!pending && world !== null && world.matches.length > 0 ? (
          <>
            <IsometricWorld matches={world.matches} />
            <div className="doorway-city mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {world.matches.map((match, index) => (
                <OpportunityBuilding key={match.opportunity.id} match={match} index={index} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function OpportunityBuilding({ match, index }: { match: DoorwayMatch; index: number }) {
  const { opportunity } = match;
  const deadline = useMemo(() => formatDeadline(opportunity.deadline), [opportunity.deadline]);
  const quarantined = opportunity.trust.status === 'quarantined';
  return (
    <article
      className={`doorway-building border border-black bg-white ${quarantined ? 'doorway-building-broken' : ''}`}
      style={{ animationDelay: `${String(index * 90)}ms` }}
    >
      <div className="doorway-building-roof flex items-center justify-between border-b border-black px-4 py-3 font-neuebit text-[10px] uppercase tracking-[0.12em]">
        <span>{opportunity.type.replace('-', ' ')}</span>
        <span>{match.score}% match</span>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-gray-500">
              {opportunity.provider}
            </p>
            <h3 className="mt-2 font-mondwest text-[34px] leading-[0.95]">{opportunity.title}</h3>
          </div>
          <TrustMark status={opportunity.trust.status} />
        </div>
        <p className="mt-5 line-clamp-3 font-mono text-[11px] leading-5 text-gray-600">
          {opportunity.summary || 'Open the official source for the complete programme description.'}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-px border border-gray-200 bg-gray-200">
          <Fact label="Funding" value={fundingLabel(opportunity.funding)} />
          <Fact label="Deadline" value={deadline} />
        </div>
        <div className="mt-5 min-h-[44px] font-mono text-[10px] leading-5 text-gray-500">
          {match.explanation.slice(0, 2).map((line) => (
            <div key={line}>+ {line}</div>
          ))}
        </div>
        <a
          href={opportunity.applicationUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-5 flex items-center justify-between border-t border-black pt-4 font-neuebit text-[11px] uppercase tracking-[0.12em] hover:text-[#f06449]"
        >
          <span>{quarantined ? 'Inspect evidence' : 'Open official door'}</span>
          <span>↗</span>
        </a>
      </div>
    </article>
  );
}

function TrustMark({ status }: { status: DoorwayMatch['opportunity']['trust']['status'] }) {
  const labels = {
    verified: 'Proved',
    partially_verified: 'Checked',
    stale: 'Aging',
    quarantined: 'Held',
  } as const;
  return (
    <span className={`doorway-trust doorway-trust-${status}`} title={`Trust status: ${status}`}>
      {labels[status]}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-3">
      <div className="font-neuebit text-[9px] uppercase tracking-[0.14em] text-gray-400">{label}</div>
      <div className="mt-1 font-mono text-[11px] text-gray-800">{value}</div>
    </div>
  );
}

function EmptyWorld({ initial }: { initial: boolean }) {
  return (
    <div className="doorway-grid relative mt-12 flex min-h-[360px] items-center justify-center overflow-hidden border border-gray-200 bg-[#f6f4ef] px-6 text-center">
      <div className="relative z-10 max-w-[580px] bg-white p-8 shadow-[10px_10px_0_#f06449]">
        <div className="font-mondwest text-4xl">
          {initial ? 'Your world has not been built yet.' : 'No verified doors match yet.'}
        </div>
        <p className="mt-4 font-mono text-[11px] leading-6 text-gray-500">
          {initial
            ? 'Complete the profile above. Doorway will ask the backend for records that came through verified Scraper Studio collectors.'
            : 'Doorway does not fill an empty map with invented opportunities. Add an official opportunity collector or broaden the profile, then build again.'}
        </p>
      </div>
    </div>
  );
}

function WorldSkeleton() {
  return (
    <div className="mt-12 grid gap-6 md:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-[360px] animate-pulse border border-gray-200 bg-[#f6f4ef]" />
      ))}
    </div>
  );
}

function HowItLives() {
  const steps = [
    ['01', 'Find', 'Bright Data searches beyond popular aggregators for official, long-tail programme pages.'],
    ['02', 'Build', 'A coding agent creates custom Scraper Studio collectors with one durable opportunity schema.'],
    ['03', 'Verify', 'The Trust Engine checks high-consequence fields against an independent Web Unlocker witness.'],
    ['04', 'Heal', 'When extraction breaks, Scraper Studio repairs it and Doorway proves the candidate before restoring the door.'],
  ];
  return (
    <section id="system" className="bg-[#f06449] text-black">
      <div className="mx-auto max-w-[1400px] px-6 py-20 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="font-neuebit text-[11px] uppercase tracking-[0.18em]">02 / Living infrastructure</div>
            <h2 className="mt-5 font-mondwest text-[clamp(52px,6vw,88px)] leading-[0.86] tracking-[-0.03em]">
              The map stays alive when the web moves.
            </h2>
            <Link
              href="/engine"
              className="mt-8 inline-flex border border-black bg-black px-6 py-4 font-neuebit text-[11px] uppercase tracking-[0.14em] text-white hover:bg-white hover:text-black"
            >
              Inspect the Trust Engine →
            </Link>
          </div>
          <div className="grid gap-px border border-black bg-black sm:grid-cols-2">
            {steps.map(([number, title, copy]) => (
              <div key={number} className="min-h-[230px] bg-[#f06449] p-6">
                <div className="font-neuebit text-[11px] tracking-[0.14em]">{number}</div>
                <h3 className="mt-10 font-mondwest text-4xl">{title}</h3>
                <p className="mt-4 font-mono text-[11px] leading-6">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function formatDeadline(value: string | null): string {
  if (value === null) return 'Not stated';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(value),
  );
}

function fundingLabel(funding: DoorwayMatch['opportunity']['funding']): string {
  if (funding.amount !== null && funding.currency !== null) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: funding.currency,
      maximumFractionDigits: 0,
    }).format(funding.amount);
  }
  if (funding.level === 'full') return 'Fully funded';
  if (funding.level === 'partial') return 'Partial funding';
  return 'Not stated';
}
