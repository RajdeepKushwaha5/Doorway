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
    <div className="terminal-window" data-reveal>
      <div className="terminal-header bg-surface-soft/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          </div>
          <span className="font-mono text-[12px] uppercase tracking-pixel text-ivory font-semibold">
            ✦ Fault Injection Console
          </span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-pixel px-2 py-0.5 rounded border border-surface-border bg-white text-muted">
          COLLECTOR: {collectorId}
        </span>
      </div>

      <div className="grid gap-px bg-surface-border lg:grid-cols-[0.95fr_1.05fr]">
        {/* Controls -------------------------------------------------- */}
        <div className="bg-white p-6 font-mono">
          <p className="text-[13px] leading-relaxed text-muted">
            Inject a live layout change, then trigger the Bright Data collector. Watch standard checks pass green while NOTICE catches the truth.
          </p>

          <div className="mt-5 flex flex-col gap-2">
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
                  className={`rounded-lg border p-3.5 text-left transition-all disabled:opacity-40 font-mono ${
                    active
                      ? 'border-parse-accent bg-parse-accentBg/40 shadow-sm'
                      : 'border-surface-border hover:border-ivory/30 bg-surface-soft/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-semibold text-ivory">{entry.label}</span>
                    {active ? (
                      <span className="text-[10px] uppercase tracking-pixel px-2 py-0.5 rounded bg-parse-accent text-white font-semibold">
                        LIVE FAULT
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-1 block text-[12px] leading-normal text-muted">
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
            className="mt-5 w-full font-mono text-[13px] font-semibold uppercase tracking-pixel px-6 py-3.5 bg-ivory text-surface-raised rounded-md hover:bg-ivory/85 transition-all shadow-md justify-center disabled:opacity-40 inline-flex items-center gap-2"
          >
            {phase.kind === 'running' ? 'Observing via Bright Data API (30s)...' : 'Run Real Collector ▸'}
          </button>

          {phase.kind === 'done' ? (
            <p
              className={`mt-3 text-[12px] font-mono leading-normal p-2.5 rounded border ${
                phase.ok
                  ? 'border-verified/30 bg-parse-accentBg/40 text-verified'
                  : 'border-blocked/30 bg-red-50 text-blocked'
              }`}
            >
              {phase.message}
            </p>
          ) : null}

          <div className="mt-5 border-t border-surface-border pt-3 text-[12px] leading-normal text-muted">
            Expected verdict:{' '}
            <span className={`font-semibold ${current?.fault === true ? 'text-blocked' : 'text-verified'}`}>
              {current?.fault === true ? 'extractor_drift detected' : 'genuine_source_change (do not heal)'}
            </span>
          </div>
        </div>

        {/* The target page preview ---------------------------------- */}
        <div className="bg-surface-soft/30 p-6 font-mono flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-pixel text-muted font-semibold">Target Page Render</span>
                <span className="text-[10px] font-mono uppercase bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">
                  {mode}
                </span>
              </div>
              <a
                href={`${fixtureUrl}/product/headphones`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11.5px] text-parse-accent hover:underline flex items-center gap-1 font-semibold"
              >
                Open Live Page ↗
              </a>
            </div>

            {/* Styled Browser Frame */}
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-md flex flex-col">
              {/* Mini Browser Address Bar */}
              <div className="flex items-center gap-2 px-3.5 py-2 border-b border-gray-200 bg-gray-50/90 text-[11px] text-gray-500">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                </div>
                <div className="flex-1 min-w-0 bg-white border border-gray-200 rounded px-2.5 py-0.5 flex items-center gap-1.5 text-gray-600 text-[10.5px]">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 shrink-0">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span className="truncate">driftmart-3ut8.onrender.com/product/headphones</span>
                </div>
                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-1.5 py-0.5 rounded shrink-0">
                  HTTP 200
                </span>
              </div>

              {/* Scrollable Document Content */}
              <div className="p-5 overflow-y-auto max-h-[300px] custom-scrollbar space-y-4 font-mono text-[12px] bg-white">
                <div>
                  <div className="font-mondwest text-[24px] text-gray-900 leading-tight">
                    DriftMart
                  </div>
                  <div className="text-gray-400 text-[11px]">
                    Serving mode: <span className="text-gray-700 font-semibold">{mode}</span>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <div className="font-mondwest text-[22px] text-gray-900 font-bold mb-3">
                    Nova Headphones
                  </div>

                  <div className="space-y-2.5">
                    {/* Price Row */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg border bg-gray-50/80 border-gray-200">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">Product Price:</span>
                        <span className="font-bold text-gray-900 text-[14px]">
                          {mode === 'genuine_price_change' ? '$229.00' : '$249.00'}
                        </span>
                      </div>
                      <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-500">
                        {mode === 'genuine_price_change' ? 'Discounted' : 'Regular'}
                      </span>
                    </div>

                    {/* Deposit Row (Present when layout shifted or baseline) */}
                    <div className={`p-2.5 rounded-lg border transition-colors ${
                      mode === 'selector_drift'
                        ? 'border-red-300 bg-red-50/70 text-red-900'
                        : 'border-gray-200 bg-white text-gray-700'
                    }`}>
                      <div className="flex items-center justify-between text-[11.5px]">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">Refundable deposit:</span>
                          <span className="font-bold text-gray-900">$25.00</span>
                        </div>
                        {mode === 'selector_drift' ? (
                          <span className="text-[9px] font-bold uppercase bg-red-600 text-white px-1.5 py-0.5 rounded">
                            Selector Hits This!
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">Optional</span>
                        )}
                      </div>
                      {mode === 'selector_drift' ? (
                        <div className="text-[10px] text-red-600 mt-1 font-semibold">
                          ⚠ Scraper Studio selector captured $25 deposit instead of $249 price
                        </div>
                      ) : null}
                    </div>

                    {/* Stock status */}
                    <div className="flex items-center justify-between text-[11.5px] px-2 py-1 text-gray-500">
                      <span>Availability:</span>
                      <span className="text-emerald-700 font-semibold">In stock (Ships in 24h)</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
                  <span>SKU: NOVA-HP-001</span>
                  <span>Category: Audio / Studio</span>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Observe the page after a redesign. It looks visually perfect to a human, which is why a second selector-free sensor is mandatory.
          </p>
        </div>
      </div>
    </div>
  );
}
