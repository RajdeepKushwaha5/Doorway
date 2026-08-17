'use client';

import { useState, useTransition } from 'react';
import { setFixtureModeAction, runCollectorAction } from '@/app/actions';

/**
 * Cause the fault and catch it, without leaving the page.
 *
 * The demonstration this project rests on has three moves: change the page,
 * run the collector, read the verdict. Until now those lived in a terminal,
 * which proves the system is real and proves nothing about whether it is
 * usable. This is the same three moves as an interface.
 *
 * The fixture is shown in an iframe rather than described, because the entire
 * point of `selector_drift` is that the page still looks correct to a person.
 * A screenshot of that claim is weaker than the page itself sitting there
 * looking innocent while the verdict underneath says otherwise.
 */

interface Mode {
  id: string;
  label: string;
  /** What the page means after the switch, in the fewest words that are true. */
  effect: string;
  /** Whether a correct system should treat this as the collector's fault. */
  fault: boolean;
}

const MODES: Mode[] = [
  {
    id: 'baseline',
    label: 'Baseline',
    effect: 'Price 249, stable layout. Nothing wrong.',
    fault: false,
  },
  {
    id: 'selector_drift',
    label: 'Redesign the page',
    effect: 'Price still 249, but the old selector now wraps the 25 deposit.',
    fault: true,
  },
  {
    id: 'genuine_price_change',
    label: 'Genuinely drop the price',
    effect: 'Price really is 229 now. The collector is fine.',
    fault: false,
  },
  {
    id: 'silent_zero',
    label: 'Corrupt the metadata',
    effect: 'Structured data says 0 USD while the visible price is right.',
    fault: true,
  },
];

type Phase =
  | { kind: 'idle' }
  | { kind: 'switching'; mode: string }
  | { kind: 'running' }
  | { kind: 'done'; message: string; ok: boolean };

export function LiveConsole({
  collectorId,
  fixtureUrl,
}: {
  collectorId: string;
  fixtureUrl: string;
}) {
  const [mode, setMode] = useState('baseline');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // Bumped on every switch so the iframe refetches. Without it the browser
  // serves the previous layout and the page appears not to have changed,
  // which is the one thing this panel cannot afford to get wrong.
  const [frame, setFrame] = useState(0);
  const [pending, startTransition] = useTransition();

  const current = MODES.find((entry) => entry.id === mode) ?? MODES[0];

  function switchTo(next: Mode): void {
    setPhase({ kind: 'switching', mode: next.id });
    startTransition(() => {
      void setFixtureModeAction(next.id).then((result) => {
        if (result.ok) {
          setMode(next.id);
          setFrame((count) => count + 1);
          setPhase({ kind: 'idle' });
        } else {
          setPhase({ kind: 'done', message: result.error, ok: false });
        }
      });
    });
  }

  function observe(): void {
    setPhase({ kind: 'running' });
    startTransition(() => {
      void runCollectorAction(collectorId).then((result) => {
        setPhase({
          kind: 'done',
          ok: result.ok,
          message: result.ok
            ? 'Observation complete. The verdict is in the fleet below.'
            : result.error,
        });
      });
    });
  }

  const busy = pending || phase.kind === 'switching' || phase.kind === 'running';

  return (
    <div className="panel overflow-hidden" data-reveal>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-6 py-4">
        <p className="text-[13px] uppercase tracking-eyebrow">Break it yourself</p>
        <span className="status-chip border-surface-border text-muted">
          {collectorId}
        </span>
      </div>

      <div className="grid gap-px bg-surface-border lg:grid-cols-[0.9fr_1.1fr]">
        {/* Controls -------------------------------------------------- */}
        <div className="bg-surface-raised p-6">
          <p className="text-[13px] leading-6 text-muted">
            Change the page, then run the real Scraper Studio collector against it. Nothing here is
            simulated and no terminal is involved.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            {MODES.map((entry) => {
              const active = entry.id === mode;
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    switchTo(entry);
                  }}
                  className={`rounded-card border px-4 py-3 text-left transition-colors disabled:opacity-40 ${
                    active
                      ? 'border-ivory/30 bg-surface'
                      : 'border-surface-border hover:border-ivory/20'
                  }`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-[13px]">{entry.label}</span>
                    {active ? (
                      <span className="text-[11px] uppercase tracking-eyebrow text-muted">live</span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-muted">
                    {entry.effect}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={observe}
            disabled={busy}
            className="accent-button mt-6 w-full justify-center disabled:opacity-40"
          >
            {phase.kind === 'running' ? 'Observing, about 30s' : 'Run the collector'}
          </button>

          {phase.kind === 'done' ? (
            <p
              className={`mt-4 text-[12px] leading-5 ${phase.ok ? 'text-verified' : 'text-blocked'}`}
            >
              {phase.message}
            </p>
          ) : null}

          {/* Naming the expected verdict before the run is the honest way to
              show a decision procedure. Announcing it afterwards would be
              indistinguishable from describing whatever happened. */}
          <p className="mt-6 border-t border-surface-border pt-4 text-[12px] leading-5 text-muted">
            Expected verdict{' '}
            <span className={current?.fault === true ? 'text-blocked' : 'text-verified'}>
              {current?.fault === true ? 'the extractor drifted' : 'leave the collector alone'}
            </span>
          </p>
        </div>

        {/* The page itself ------------------------------------------- */}
        <div className="bg-surface-raised p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">The page Bright Data scrapes</p>
            <a
              href={`${fixtureUrl}/product/headphones`}
              className="text-[12px] text-muted transition-colors hover:text-ivory"
            >
              Open <span aria-hidden>↗</span>
            </a>
          </div>

          <div className="mt-4 overflow-hidden rounded-card border border-surface-border bg-white">
            <iframe
              key={frame}
              src={`${fixtureUrl}/product/headphones`}
              title="DriftMart product page, live"
              className="h-[300px] w-full"
              sandbox="allow-same-origin"
            />
          </div>

          <p className="mt-4 text-[12px] leading-5 text-muted">
            Look at it after a redesign. It reads correctly to a person, which is exactly why no
            alert fires and why a second sensor is the only thing that catches it.
          </p>
        </div>
      </div>
    </div>
  );
}
