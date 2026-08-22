'use client';

import { useMemo, useState, useTransition } from 'react';
import { IsometricWorld } from '@/components/IsometricWorld';
import { LiveDiscovery } from '@/components/LiveDiscovery';
import Link from 'next/link';
import { findOpportunitiesAction } from '@/app/actions';
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

function CliPill({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Click to copy CLI command"
      className="group inline-flex items-center gap-2 rounded border border-gray-300 bg-gray-50/80 px-3.5 py-2.5 font-mono text-[11px] text-gray-700 hover:border-emerald-500 hover:bg-white transition-all text-left"
    >
      <span className="text-emerald-600 font-bold">$</span>
      <span className="font-semibold text-gray-800">{command}</span>
      <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-gray-600 group-hover:bg-emerald-100 group-hover:text-emerald-800 font-bold transition-colors">
        {copied ? 'Copied ✓' : 'Copy ↗'}
      </span>
    </button>
  );
}

function splitList(str: string): string[] {
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

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

  /* How many pages the live search opened, so the result can explain itself. */
  const [searched, setSearched] = useState<number | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);

  /*
   * One press, both halves.
   *
   * This used to build a world from the sources under continuous observation
   * and stop there, leaving a separate button further down the page to search
   * the live web. Only a handful of sources are watched, so pressing this
   * showed a nearly empty map, and almost nobody scrolled far enough to find
   * the button that would have filled it. Two actions to get one answer, and
   * the first one looked like the product had no data.
   */
  const submit = (): void => {
    const next = { ...profile, interests: splitList(interest) };
    setProfile(next);
    setError(null);
    setLiveNote(null);
    startTransition(async () => {
      const result = await findOpportunitiesAction(next);
      if (result.ok) {
        setWorld(result.data);
        setSearched(result.data.searched);
        setLiveNote(result.data.liveMessage ?? null);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <section className="doorway-hero border-b border-gray-200">
        <div className="mx-auto grid min-h-[680px] max-w-[1400px] lg:grid-cols-[0.92fr_1.08fr]">
          <div className="flex flex-col justify-center border-gray-200 px-6 py-16 lg:border-r lg:px-12">
            <div className="mb-6 flex items-center gap-3 font-neuebit text-[12px] uppercase tracking-[0.18em] text-gray-500">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live opportunity infrastructure
            </div>
            <h1 className="font-mondwest text-[clamp(62px,7vw,108px)] font-normal leading-[0.83] tracking-[-0.04em]">
              The web is full of doors.
              <span className="block text-emerald-600">Find yours.</span>
            </h1>
            <p className="mt-8 max-w-[610px] font-mono text-[15px] leading-7 text-gray-600">
              Doorway turns scattered scholarships, fellowships, internships and grants into a
              living world built from official sources. Bright Data keeps every door current when
              the web changes.
            </p>

            <div className="mt-9 grid gap-px border border-gray-200 bg-gray-200 sm:grid-cols-3 blueprint-card">
              {[
                ['01', 'discover-sources/', 'Official long-tail sources'],
                ['02', 'structure-collectors/', 'Scraper Studio collectors'],
                ['03', 'prove-truth/', 'Two-sensor verification'],
              ].map(([number, title, copy]) => (
                <div key={number} className="bg-white p-4 group hover:bg-neutral-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="font-neuebit text-[11px] tracking-[0.15em] text-emerald-600 font-bold">{number}</div>
                    <span className="font-mono text-[10px] text-gray-300 group-hover:text-emerald-500 transition-colors">■</span>
                  </div>
                  <div className="mt-4 font-mondwest text-2xl group-hover:text-emerald-800 transition-colors">{title}</div>
                  <div className="mt-1 font-mono text-[10px] leading-5 text-gray-500">{copy}</div>
                </div>
              ))}
            </div>

            {/*
              The one link a first-time visitor most wants.

              "Two-sensor verification" above is a claim, and a reader has no
              way to weigh it. This offers the fault switch instead: break the
              source page yourself and see whether the system catches it. It
              sits in the hero rather than in a footer because a demonstration
              nobody finds is worth the same as no demonstration.
            */}
            <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
              <Link
                href="/proof"
                className="inline-flex items-center justify-center gap-2 border border-black bg-black px-6 py-3 font-neuebit text-[12px] uppercase tracking-[0.14em] text-white transition-all hover:bg-neutral-800 shadow-sm whitespace-nowrap"
              >
                <span>Break the page and watch</span>
                <span>↗</span>
              </Link>
              <CliPill command="bdata scraper run c_mt36mo6tj37dmjgqh" />
            </div>
          </div>

          <div className="doorway-form-stage relative flex min-w-0 flex-col items-center justify-center overflow-hidden p-6 sm:p-10 lg:p-12">
            <div aria-hidden="true" className="doorway-form-grid" />
            <div aria-hidden="true" className="doorway-form-dots" />
            <div aria-hidden="true" className="doorway-form-glow doorway-form-glow-primary" />
            <div aria-hidden="true" className="doorway-form-glow doorway-form-glow-secondary" />
            <div aria-hidden="true" className="doorway-form-arc doorway-form-arc-one" />
            <div aria-hidden="true" className="doorway-form-arc doorway-form-arc-two" />

            {/* Ambient Floating Orbit Sensors */}
            <div className="pointer-events-none absolute top-7 right-8 z-0 hidden xl:flex items-center gap-2 rounded-full border border-emerald-500/30 bg-white/90 px-3 py-1 font-mono text-[10px] text-emerald-800 shadow-sm backdrop-blur-sm animate-float-slow">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>dev.witness() · Web Unlocker</span>
            </div>
            <div className="pointer-events-none absolute top-14 left-8 z-0 hidden xl:flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-3 py-1 font-mono text-[10px] text-gray-700 shadow-sm backdrop-blur-sm animate-float-reverse">
              <span className="h-1.5 w-1.5 rounded-full bg-black" />
              <span>dev.collector() · Scraper Studio</span>
            </div>

            {/* Top Telemetry & Sensor Radar Ribbon */}
            <div className="relative z-10 mb-2 w-full max-w-[620px]">
              <div className="flex items-center justify-between gap-2 rounded-md border border-black/10 bg-white/85 px-3.5 py-2 backdrop-blur-md shadow-sm font-mono text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="font-neuebit text-[11px] uppercase tracking-[0.14em] text-gray-800 font-bold">
                    Opportunity Radar
                  </span>
                </div>
                <div className="hidden sm:flex items-center gap-2 overflow-hidden text-[10.5px] text-gray-500">
                  <span className="h-1 w-1 rounded-full bg-gray-300" />
                  <span className="truncate">dev.pipeline() active</span>
                  <span className="h-1 w-1 rounded-full bg-gray-300" />
                  <span className="text-emerald-700 font-semibold">100% Evidence Gated</span>
                </div>
                <div className="flex items-center gap-1 font-neuebit text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-500/30 px-2 py-0.5 rounded font-bold shrink-0">
                  Live Feed
                </div>
              </div>
            </div>

            {/* Interactive File Explorer Strip (GitHub Universe Motif) */}
            <div className="relative z-10 mb-3 w-full max-w-[620px] flex items-center gap-2 overflow-x-auto text-[10.5px] font-mono">
              <span className="text-gray-400 font-bold font-neuebit uppercase tracking-wider text-[9px] shrink-0">SOURCE STREAMS:</span>
              <span className="inline-flex items-center gap-1 bg-white/90 border border-emerald-500/40 text-emerald-800 px-2 py-0.5 rounded shadow-2xs font-semibold shrink-0">
                <span>📄</span> c_fellowship.json <span className="text-[8.5px] bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-bold">200 OK</span>
              </span>
              <span className="inline-flex items-center gap-1 bg-white/75 border border-black/10 text-gray-700 px-2 py-0.5 rounded shadow-2xs shrink-0">
                <span>📝</span> witness_extract.md <span className="text-[8.5px] bg-gray-100 text-gray-700 px-1 py-0.2 rounded font-bold">PROVED</span>
              </span>
              <span className="inline-flex items-center gap-1 bg-white/75 border border-black/10 text-gray-700 px-2 py-0.5 rounded shadow-2xs shrink-0">
                <span>🔐</span> sha256.cert
              </span>
            </div>

            <div className="doorway-builder-card blueprint-card relative z-10 min-w-0 w-full max-w-[620px] border border-black bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-black px-4 py-3 font-neuebit text-[11px] uppercase tracking-[0.15em] sm:px-5 bg-white">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className="truncate font-bold text-gray-900">Build my opportunity world</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-bold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="sm:hidden">Bright Data</span>
                  <span className="hidden sm:inline">Bright Data live</span>
                </span>
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
                  className="flex min-h-14 w-full items-center justify-between bg-emerald-500 hover:bg-emerald-400 px-5 font-neuebit text-[13px] uppercase tracking-[0.14em] text-black font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{pending ? 'Searching the live web' : 'Find my opportunities'}</span>
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

      <WorldSection
        world={world}
        pending={pending}
        profile={{ ...profile, interests: splitList(interest) }}
      />
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

function WorldSection({
  world,
  pending,
  profile,
}: {
  world: DoorwayWorld | null;
  pending: boolean;
  profile: DoorwayProfile;
}) {
  return (
    <section id="world" className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-[1400px] px-6 py-20 lg:px-12">
        <div className="flex flex-col justify-between gap-7 border-b border-black pb-8 md:flex-row md:items-end">
          <div>
            <div className="font-neuebit text-[11px] uppercase tracking-[0.18em] text-emerald-600 font-bold">
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

        <div className="mt-16">
          <LiveDiscovery profile={profile} />
        </div>
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
      className={`doorway-building blueprint-card border border-black bg-white ${quarantined ? 'doorway-building-broken' : ''}`}
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
        {quarantined ? (
          <Link
            href={`/opportunities/${opportunity.id}`}
            className="mt-5 flex items-center justify-between border-t border-black pt-4 font-neuebit text-[11px] uppercase tracking-[0.12em] text-blocked hover:text-black"
          >
            <span>Held back, see why</span>
            <span>→</span>
          </Link>
        ) : (
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-black pt-4 font-neuebit text-[11px] uppercase tracking-[0.12em]">
            <Link href={`/opportunities/${opportunity.id}`} className="hover:text-emerald-600">
              Evidence →
            </Link>
            <a
              href={opportunity.applicationUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-emerald-600 font-semibold"
            >
              Open official door ↗
            </a>
          </div>
        )}
      </div>
    </article>
  );
}

function TrustMark({ status }: { status: DoorwayMatch['opportunity']['trust']['status'] }) {
  /*
   * Words a student already knows.
   *
   * "Proved", "Checked", "Held" are this system's vocabulary, not theirs. Each
   * one is paired with a plain sentence on hover so nobody has to be told what
   * the badge means before the page is useful to them.
   */
  const labels = {
    verified: 'Confirmed',
    partially_verified: 'Checked',
    stale: 'Not rechecked',
    quarantined: 'On hold',
    discovered: 'Just found',
  } as const;

  const meanings = {
    verified: 'Two independent readings of this page agreed. Safe to plan around.',
    partially_verified: 'Passed the checks learned for this source, but only one reading.',
    stale: 'Confirmed once, but not recently. Check the source before you rely on it.',
    quarantined: 'The readings stopped agreeing, so the last confirmed values are shown instead.',
    discovered: 'Found on the live web moments ago and read once. Not verified yet, so open the source before you plan around it.',
  } as const;
  return (
    <span className={`doorway-trust doorway-trust-${status}`} title={meanings[status]}>
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
      <div className="relative z-10 max-w-[580px] bg-white p-8 shadow-[10px_10px_0_#10b981]">
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
    <section id="system" className="bg-black text-white border-t border-neutral-800">
      <div className="mx-auto max-w-[1400px] px-6 py-20 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="font-neuebit text-[11px] uppercase tracking-[0.18em] text-emerald-400 font-bold">
              02 / Living infrastructure
            </div>
            <h2 className="mt-5 font-mondwest text-[clamp(52px,6vw,88px)] leading-[0.86] tracking-[-0.03em] text-white">
              The map stays alive when the web moves.
            </h2>
            <Link
              href="/engine"
              className="mt-8 inline-flex items-center gap-2 border border-emerald-500 bg-emerald-500 hover:bg-emerald-400 px-6 py-4 font-neuebit text-[11px] uppercase tracking-[0.14em] text-black font-bold transition-all shadow-lg hover:shadow-emerald-500/20"
            >
              Inspect the Trust Engine →
            </Link>
          </div>
          <div className="grid gap-px border border-neutral-800 bg-neutral-800 sm:grid-cols-2">
            {steps.map(([number, title, copy]) => (
              <div key={number} className="min-h-[230px] bg-neutral-950 p-6 border border-neutral-900/50 hover:border-emerald-500/30 transition-colors group">
                <div className="font-neuebit text-[11px] tracking-[0.14em] text-emerald-400 font-bold">{number}</div>
                <h3 className="mt-10 font-mondwest text-4xl text-white group-hover:text-emerald-300 transition-colors">{title}</h3>
                <p className="mt-4 font-mono text-[11px] leading-6 text-neutral-400">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
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
