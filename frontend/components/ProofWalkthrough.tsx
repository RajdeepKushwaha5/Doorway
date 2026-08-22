'use client';

import { useCallback, useState, useTransition } from 'react';
import Link from 'next/link';
import { DecisionStream } from '@/components/DecisionStream';
import {
  setFixtureModeAction,
  type ProofScenario,
} from '@/app/actions';

/**
 * Check the system yourself, without a terminal and without trusting us.
 *
 * The argument this project makes is not complicated, but it is easy to assert
 * and hard to believe: a scraper can keep returning valid, plausible, wrong
 * data forever, and nothing in the stack notices. Every way of presenting that
 * claim is weaker than letting somebody break the page themselves and watch
 * what happens.
 *
 * Three rules this page holds to:
 *
 * 1. The expected verdict is stated *before* the run. A demonstration that
 *    only explains itself afterwards can never be wrong, which makes it worth
 *    nothing. If the system returns something else, the page says so plainly.
 * 2. Every step says what it costs a student. "extractor_drift" is a label. "A
 *    student sees 1 September, assumes applications close then, and never
 *    comes back" is the thing the label is about.
 * 3. Controls that cannot work say so before they are pressed, not after.
 */

interface ServedOpportunity {
  title: string;
  deadlineRaw: string | null;
  fundingLevel: string;
  applicationUrl: string;
  trustStatus: string;
  confirmedBy: string;
  fieldsDegraded: string[];
  lastVerifiedAt: string;
}

const TRUST_COPY: Record<string, { label: string; tone: string; meaning: string }> = {
  verified: {
    label: 'Served as current',
    tone: 'border-emerald-500/50 bg-emerald-50 text-emerald-800',
    meaning: 'Two independent Bright Data sensors read this page and agreed. Safe to plan around.',
  },
  partially_verified: {
    label: 'Served, weaker claim',
    tone: 'border-neutral-300 bg-neutral-50 text-neutral-800',
    meaning:
      'This passed the checks learned for its source, but the second sensor was not consulted on this reading.',
  },
  stale: {
    label: 'Served with its age',
    tone: 'border-neutral-300 bg-neutral-50 text-neutral-800',
    meaning: 'Two sensors agreed on this once, but not recently. The date is shown so nobody mistakes it for fresh.',
  },
  quarantined: {
    label: 'Held back',
    tone: 'border-red-500/50 bg-red-50 text-red-800',
    meaning:
      'The two readings no longer agree. The last value both sensors confirmed is still shown, and the disputed field is flagged rather than overwritten.',
  },
};

/**
 * What step 4 can truthfully say, given what the run actually decided.
 *
 * Four cases rather than one, because the walkthrough offers four faults and
 * two of them are supposed to come back clean. Saying "the sensors disagreed"
 * after a healthy run does not merely overstate the result, it demonstrates the
 * failure the page is here to argue against.
 */
function outcome(verdict: string): {
  heading: string;
  aggregator: string;
  doorway: string;
  next: string;
} {
  if (verdict === '') {
    return {
      heading: 'What each system would do',
      aggregator:
        'Publishes whatever it last scraped. If the request succeeded and the JSON was valid, nothing raises an error, and a wrong closing date is served with full confidence and no way for a reader to tell.',
      doorway:
        'Publishes a reading only when both sensors support it. When they disagree the last confirmed value stays up, the disputed field is named, and the record is marked as held.',
      next: 'Break the page above and run it again to see which of these actually happens. This panel reports the run, not the usual case.',
    };
  }

  if (verdict === 'healthy') {
    return {
      heading: 'What this run decided',
      aggregator:
        'Would have published, and would have been right. Nothing was wrong with this page, so the two systems agree here. That is the point of running it clean first.',
      doorway:
        'Both sensors read the page and agreed on every field, so the reading was published and no repair was proposed. A system that cried drift here would be useless: the next real drift would be ignored too.',
      next: 'Now break the page above and run it again. The interesting claim is not that a clean page passes, it is what happens to a broken one.',
    };
  }

  if (verdict === 'genuine_source_change') {
    return {
      heading: 'What this run decided',
      aggregator:
        'Publishes the new value, which is correct here, and would publish it just as confidently if the collector had been the thing that broke. It cannot tell those two apart, which is why being right this time is luck.',
      doorway:
        'Both sensors saw the same new value, so the page changed and the collector is fine. Blame was assigned to the source rather than the extractor, and no repair was proposed against a collector that is working. A required field going missing still blocks publication.',
      next: 'Put the page back to normal and run it once more to return the fixture to its baseline.',
    };
  }

  return {
    heading: 'What this run decided',
    aggregator:
      'Publishes whatever it last scraped. The request succeeded and the JSON was valid, so nothing raised an error. It now shows the wrong closing date, with full confidence and no way for a reader to tell.',
    doorway:
      'The two sensors did not support the same reading, so it was not published. The last value both confirmed is still shown, the disputed field is named, and the record is marked as held rather than quietly served alongside the rest.',
    next: 'Put the page back to normal and run it once more. The quarantine lifts on its own, because an incident opened by two sensors disagreeing is closed by the two of them agreeing again.',
  };
}

export function ProofWalkthrough({
  collectorId,
  watchUrl,
  initialMode,
  scenarios,
  opportunity,
  canRun,
  canSwitch,
}: {
  collectorId: string | null;
  watchUrl: string | null;
  initialMode: string | null;
  scenarios: ProofScenario[];
  opportunity: ServedOpportunity | null;
  canRun: boolean;
  canSwitch: boolean;
}) {
  const [mode, setMode] = useState(initialMode);
  const [chosen, setChosen] = useState<ProofScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * What the last run actually decided, empty until one has finished.
   *
   * Step 4 used to be a fixed paragraph asserting that the two sensors had
   * disagreed and the reading had been withheld. That is one of six outcomes,
   * and on a baseline page it is the wrong one: the sentence sat directly
   * beneath a stream reporting three agreements and a healthy verdict. A page
   * whose entire argument is that this system does not publish claims it has
   * not checked cannot itself narrate a result it did not read.
   */
  const [ranVerdict, setRanVerdict] = useState('');
  // Stable, so the stream's effect does not re-fire on every parent render.
  const handleVerdict = useCallback((verdict: string) => setRanVerdict(verdict), []);
  const told = outcome(ranVerdict);
  const [pending, startTransition] = useTransition();

  const switchTo = (scenario: ProofScenario | null): void => {
    const target = scenario?.id ?? 'baseline';
    setError(null);
    startTransition(async () => {
      const result = await setFixtureModeAction(target);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMode(target);
      setChosen(scenario);
    });
  };

  const trust = opportunity === null ? null : (TRUST_COPY[opportunity.trustStatus] ?? null);
  const blocked = collectorId === null;

  return (
    <div className="mt-10 space-y-px bg-gray-200">
      {/* ---------------------------------------------------------------- */}
      <Step
        n={1}
        title="Look at the opportunity as it stands"
        blurb="This is a real record, produced by a real Bright Data collector reading a real page. Note the deadline."
      >
        {opportunity === null ? (
          <p className="font-mono text-[13px] leading-relaxed text-gray-600">
            Nothing is being served yet. Run the collector once and this fills in. Doorway does not
            seed itself with examples, so an empty world here is the honest state rather than a
            broken one.
          </p>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="font-mondwest text-2xl leading-tight">{opportunity.title}</div>
              <dl className="mt-4 grid gap-x-8 gap-y-2 font-mono text-[13px] sm:grid-cols-[auto_1fr]">
                <dt className="text-gray-500">Closing date</dt>
                <dd className="font-semibold">{opportunity.deadlineRaw ?? 'not published'}</dd>
                <dt className="text-gray-500">Funding</dt>
                <dd>{opportunity.fundingLevel}</dd>
                <dt className="text-gray-500">Confirmed by</dt>
                <dd>
                  {opportunity.confirmedBy === 'two_sensors'
                    ? 'two independent sensors'
                    : opportunity.confirmedBy === 'contract_only'
                      ? 'learned checks only'
                      : 'nothing yet'}
                </dd>
              </dl>
              {opportunity.fieldsDegraded.length > 0 ? (
                <p className="mt-4 font-mono text-[12.5px] leading-relaxed text-red-700">
                  Currently disputed, and shown at its last agreed value:{' '}
                  <strong>{opportunity.fieldsDegraded.join(', ')}</strong>
                </p>
              ) : null}
            </div>

            {trust === null ? null : (
              <div className={`max-w-[280px] border px-4 py-3 ${trust.tone}`}>
                <div className="font-neuebit text-[11px] uppercase tracking-[0.14em]">
                  {trust.label}
                </div>
                <p className="mt-2 font-mono text-[11.5px] leading-relaxed">{trust.meaning}</p>
              </div>
            )}
          </div>
        )}

        {watchUrl === null ? null : (
          <p className="mt-6 font-mono text-[11.5px] text-gray-500">
            Source page:{' '}
            <a
              href={watchUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-black"
            >
              open it in a new tab
            </a>{' '}
            and read the closing date yourself. It is a controlled fixture, not a real foundation,
            so it can be made to misbehave on cue.
          </p>
        )}
      </Step>

      {/* ---------------------------------------------------------------- */}
      <Step
        n={2}
        title="Break the source page on purpose"
        blurb="Pick something a real funding page does. Each one says what a correct system should conclude, before you run it."
      >
        {!canSwitch ? (
          <Locked what="The fixture is locked on this deployment, so the page cannot be changed from here." />
        ) : null}

        <div className="grid gap-px bg-gray-200 sm:grid-cols-2">
          {scenarios.map((scenario) => {
            const active = chosen?.id === scenario.id;
            return (
              <button
                key={scenario.id}
                type="button"
                disabled={!canSwitch || pending}
                onClick={() => switchTo(scenario)}
                className={`bg-white p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active ? 'ring-2 ring-inset ring-emerald-500' : 'hover:bg-gray-50'
                }`}
              >
                <div className="font-mono text-[13px] font-semibold">{scenario.label}</div>
                <p className="mt-2 font-mono text-[12px] leading-relaxed text-gray-600">
                  {scenario.plain}
                </p>
                <p className="mt-3 font-mono text-[11.5px] leading-relaxed text-gray-500">
                  <span className="text-gray-400">If nobody catches it: </span>
                  {scenario.consequence}
                </p>
                <div className="mt-3 border-t border-gray-200 pt-3">
                  <div className="font-neuebit text-[10.5px] uppercase tracking-[0.12em] text-emerald-600 font-bold">
                    A correct system should
                  </div>
                  <p className="mt-1 font-mono text-[12px] leading-relaxed">{scenario.decision}</p>
                  <p className="mt-1 font-mono text-[11px] text-gray-400">
                    verdict: {scenario.verdicts.join(' or ')}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/*
          Two different failures, told apart.
          Saying "could not be reached" when the fixture answered and simply
          offered nothing sends a reader to check a network that is fine. The
          mode arriving is the proof it was reached.
        */}
        {scenarios.length === 0 ? (
          <p className="font-mono text-[13px] leading-relaxed text-gray-600">
            {mode === null
              ? 'The source page could not be reached, so what it can be made to do is unknown. Nothing is guessed here. Start it and reload.'
              : 'The source page answered but offered no faults to demonstrate, which means it is running a build older than this dashboard. Rebuild it and reload.'}
          </p>
        ) : null}

        {mode !== null ? (
          <p className="mt-5 font-mono text-[12px] text-gray-500">
            The page is currently serving <code className="text-black">{mode}</code>.{' '}
            {canSwitch ? (
              <button
                type="button"
                onClick={() => switchTo(null)}
                disabled={pending}
                className="underline underline-offset-4 hover:text-black disabled:opacity-50"
              >
                Put it back to normal
              </button>
            ) : null}
          </p>
        ) : null}

        {error === null ? null : (
          <p className="mt-4 border border-red-500/40 bg-red-50 p-4 font-mono text-[12.5px] text-red-800">
            {error}
          </p>
        )}
      </Step>

      {/* ---------------------------------------------------------------- */}
      <Step
        n={3}
        title="Run the check and watch it decide"
        blurb="Both sensors read the page. The line-by-line reasoning is printed as it happens, including the exact line the second sensor read the value from."
      >
        {chosen === null ? (
          /*
           * Keyed on what the fixture is serving, not on what was pressed here.
           *
           * `chosen` is only the fault clicked in this session, so after a
           * reload it is null while the page can still be serving a break from
           * before. This claimed nothing was broken directly beneath a banner
           * naming the mode that was.
           */
          mode === null || mode === 'baseline' ? (
            <p className="font-mono text-[13px] leading-relaxed text-gray-600">
              Nothing is broken right now, so a run should come back healthy. That is worth doing
              once before you break anything, so the green result means something when you see it.
            </p>
          ) : (
            <p className="font-mono text-[13px] leading-relaxed text-gray-600">
              The source page is currently serving{' '}
              <code className="text-black">{mode}</code>, set before this page was loaded. Run the
              sensors to see what that does, or put the page back to normal first.
            </p>
          )
        ) : (
          <div className="mb-6 border-l-2 border-emerald-500 bg-emerald-50/60 px-5 py-4">
            <div className="font-neuebit text-[11px] uppercase tracking-[0.14em] text-emerald-700 font-bold">
              Stated before the run
            </div>
            <p className="mt-2 font-mono text-[13px] leading-relaxed">
              {chosen.decision} That means a verdict of{' '}
              <strong>{chosen.verdicts.join(' or ')}</strong>. If the run says anything else, it
              got this wrong, and you should hold that against it.
            </p>
          </div>
        )}

        {blocked ? (
          <Locked what="No collector is registered on this deployment, so there is nothing to run." />
        ) : (
          <DecisionStream
            collectorId={collectorId}
            {...(watchUrl === null ? {} : { url: watchUrl })}
            label="Run both sensors now"
            onVerdict={handleVerdict}
            {...(canRun
              ? {}
              : {
                  disabledReason:
                    'This deployment has no admin token, so runs are read-only here. Everything above still shows real recorded state.',
                })}
          />
        )}

        <p className="mt-6 font-mono text-[12px] leading-relaxed text-gray-500">
          When the run finishes, reload this page to see what the world serves now. A verdict that
          is not publishable never overwrites the last value both sensors agreed on, which is why
          the closing date above stays correct even while the source page is lying.
        </p>
      </Step>

      {/* ---------------------------------------------------------------- */}
      <Step
        n={4}
        title="Read what changed, and what did not"
        blurb="The point is not that an alert fired. It is what a student is served while the source is wrong."
        last
      >
        <div className="font-neuebit text-[11px] uppercase tracking-[0.14em] text-gray-400 mb-3">
          {told.heading}
          {ranVerdict === '' ? null : (
            <span className="ml-2 normal-case tracking-normal font-mono text-gray-500">
              verdict: {ranVerdict}
            </span>
          )}
        </div>

        <div className="grid gap-px bg-gray-200 sm:grid-cols-2">
          <div className="bg-white p-5">
            <div className="font-neuebit text-[11px] uppercase tracking-[0.14em] text-gray-500">
              An ordinary aggregator
            </div>
            <p className="mt-3 font-mono text-[13px] leading-relaxed text-gray-700">
              {told.aggregator}
            </p>
          </div>
          <div className="bg-white p-5">
            <div className="font-neuebit text-[11px] uppercase tracking-[0.14em] text-emerald-600 font-bold">
              Doorway
            </div>
            <p className="mt-3 font-mono text-[13px] leading-relaxed text-gray-700">
              {told.doorway}
            </p>
          </div>
        </div>

        <p className="mt-6 font-mono text-[12.5px] leading-relaxed text-gray-600">{told.next}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/verified"
            className="border border-black px-5 py-2.5 font-neuebit text-[11px] uppercase tracking-[0.12em] transition-colors hover:bg-black hover:text-white"
          >
            See everything served, and its basis
          </Link>
          <Link
            href="/engine"
            className="border border-gray-300 px-5 py-2.5 font-neuebit text-[11px] uppercase tracking-[0.12em] text-gray-600 transition-colors hover:border-black hover:text-black"
          >
            Look inside the trust engine
          </Link>
        </div>
      </Step>
    </div>
  );
}

function Step({
  n,
  title,
  blurb,
  children,
  last = false,
}: {
  n: number;
  title: string;
  blurb: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={`bg-white p-6 sm:p-8 ${last ? '' : ''}`}>
      <div className="flex items-baseline gap-4">
        <span className="font-mondwest text-3xl leading-none text-emerald-600 font-bold">
          {String(n).padStart(2, '0')}
        </span>
        <div>
          <h2 className="font-mondwest text-2xl leading-tight">{title}</h2>
          <p className="mt-1.5 max-w-[720px] font-mono text-[12.5px] leading-relaxed text-gray-600">
            {blurb}
          </p>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Locked({ what }: { what: string }) {
  return (
    <p className="mb-5 border border-neutral-300 bg-neutral-50 p-4 font-mono text-[12.5px] leading-relaxed text-neutral-800">
      {what} The controls below are shown disabled rather than hidden, so what this deployment can
      and cannot do is visible before you press anything.
    </p>
  );
}
