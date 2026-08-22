'use client';

import { useState, useTransition } from 'react';
import { setFixtureModeAction } from '@/app/actions';
import { DecisionStream } from '@/components/DecisionStream';

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
  /**
   * The verdict this mode should produce, named before the run.
   *
   * Carried per mode rather than derived from `fault`, because that binary
   * collapsed three outcomes into two: an unchanged page is `healthy`, not a
   * `genuine_source_change`. Announcing the wrong expectation and then being
   * proved right by the system is worse than announcing nothing.
   */
  verdict: string;
}

const MODES: Mode[] = [
  {
    id: 'baseline',
    label: 'Baseline',
    effect: 'Price 249, stable layout. Nothing wrong.',
    fault: false,
    verdict: 'healthy',
  },
  {
    id: 'selector_drift',
    label: 'Redesign the page',
    effect: 'Price still 249, but the old selector now wraps the 25 deposit.',
    fault: true,
    verdict: 'extractor_drift',
  },
  {
    id: 'genuine_price_change',
    label: 'Genuinely drop the price',
    effect: 'Price really is 229 now. The collector is fine.',
    fault: false,
    verdict: 'genuine_source_change (do not heal)',
  },
  {
    id: 'silent_zero',
    label: 'Corrupt the metadata',
    effect: 'Structured data says 0 USD while the visible price is right.',
    fault: true,
    verdict: 'extractor_drift',
  },
  {
    id: 'sponsored_insertion',
    label: 'Insert a sponsored card',
    effect: 'A sponsored listing at 99 is placed above the real product, carrying the same class.',
    fault: true,
    verdict: 'extractor_drift',
  },
  {
    id: 'missing_field',
    label: 'Delete a field from the page',
    effect: 'Availability is removed. Both sensors agree it is gone, so nothing is repaired.',
    fault: false,
    verdict: 'genuine_source_change (do not heal)',
  },
  {
    id: 'pagination_collapse',
    label: 'Add a pager, change nothing',
    effect: 'A next-page link appears. Every value on the page is unchanged.',
    fault: false,
    verdict: 'healthy',
  },
];

/**
 * Only the fixture switch has phases now.
 *
 * Running the collector used to live here too, as a disabled button and a
 * one-line result. It moved into `DecisionStream`, which owns its own state
 * because it has far more to say than done-or-failed.
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'switching'; mode: string }
  | { kind: 'failed'; message: string };

export function LiveConsole({
  collectorId,
  brightDataId,
  fixtureUrl,
  searchCollector,
  initialMode,
  canRunCollector,
  canSwitchFixture,
}: {
  /**
   * The NOTICE record id, which is what every API route keys on.
   *
   * Distinct from `brightDataId` and easy to confuse, which is exactly what
   * happened: this panel was handed the `c_...` identifier, every run returned
   * "collector not found", and the button at the centre of the demo had never
   * worked on a seeded deployment. Two separate props now, so the one that is
   * displayed cannot be mistaken for the one that is called.
   */
  collectorId: string;
  /** The `c_...` identifier, shown because it is the one a reader recognises. */
  brightDataId: string;
  fixtureUrl: string;
  /**
   * The interaction collector, when one is registered.
   *
   * Kept separate rather than folded into the mode list above, because
   * `search_drift` breaks a different page read by a different collector. A
   * button in that list would have announced a verdict about the product page
   * while breaking the search page, which is worse than not offering it.
   */
  searchCollector?: { id: string; brightDataId: string; url: string };
  /**
   * What the fixture is serving right now, read on the server.
   *
   * Null when the fixture could not be reached. Shown as unknown rather than
   * assumed, because a panel that claims a mode it never checked is the thing
   * this whole page argues against.
   */
  initialMode: string | null;
  /** Whether this deployment holds the token that runs a collector. */
  canRunCollector: boolean;
  /** Whether this deployment holds the token that switches the fixture. */
  canSwitchFixture: boolean;
}) {
  const [mode, setMode] = useState<string | null>(initialMode);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // Bumped on every switch so the iframe refetches. Without it the browser
  // serves the previous layout and the page appears not to have changed,
  // which is the one thing this panel cannot afford to get wrong.
  const [frame, setFrame] = useState(0);
  const [pending, startTransition] = useTransition();

  // No fallback to MODES[0]. An unreachable fixture is not baseline, and
  // saying so was how this panel came to display a mode nobody had checked.
  const current = MODES.find((entry) => entry.id === mode);

  function switchTo(next: Mode): void {
    setPhase({ kind: 'switching', mode: next.id });
    startTransition(() => {
      void setFixtureModeAction(next.id).then((result) => {
        if (result.ok) {
          setMode(next.id);
          setFrame((count) => count + 1);
          setPhase({ kind: 'idle' });
        } else {
          setPhase({ kind: 'failed', message: result.error });
        }
      });
    });
  }

  const busy = pending || phase.kind === 'switching';
  // Locked is not busy. A control that cannot work should say why rather than
  // look momentarily unavailable.
  const locked = !canSwitchFixture;
  const drifted = mode === 'search_drift';

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
          COLLECTOR: {brightDataId}
        </span>
      </div>

      <div className="grid gap-px bg-surface-border lg:grid-cols-[0.95fr_1.05fr]">
        {/* Controls -------------------------------------------------- */}
        <div className="bg-white p-6 font-mono">
          <p className="text-[13px] leading-relaxed text-muted">
            Inject a live change into the page Bright Data is about to read, then run the
            collector. Some of these are the collector&apos;s fault and some are the page telling
            the truth about itself, which is the distinction a monitor cannot make.
          </p>

          {locked ? (
            <p className="mt-4 rounded-lg border border-neutral-300 bg-neutral-50 p-3 text-[12px] leading-relaxed text-neutral-800">
              The fixture token is not set, so this button cannot switch the fixture. Run the
              collector against whatever DriftMart is currently serving.
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2">
            {MODES.map((entry) => {
              const active = entry.id === mode;
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={busy || locked}
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
                    {/* The badge marks the mode the fixture is serving. Calling
                        that a live fault on `baseline` labelled the innocent
                        state a fault, on the one panel that has to be precise
                        about which is which. */}
                    {active ? (
                      <span
                        className={`text-[10px] uppercase tracking-pixel px-2 py-0.5 rounded font-semibold text-white ${
                          entry.fault ? 'bg-blocked' : 'bg-parse-accent'
                        }`}
                      >
                        {entry.fault ? 'LIVE FAULT' : 'SERVING NOW'}
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

          {/* Sits with the mode list it describes. It used to render below the
              interaction panel, where it read as the expectation for the
              search collector's run and contradicted the verdict shown just
              above it. */}
          <div className="mt-4 border-t border-surface-border pt-3 text-[12px] leading-normal text-muted">
            Expected verdict for the product page:{' '}
            {/* Three states, not two. "Could not be reached" and "serving a
                mode this panel does not control" are different facts, and
                collapsing them is the same mistake as assuming baseline. */}
            {mode === null ? (
              <span className="font-semibold text-muted">
                unknown, the fixture could not be reached
              </span>
            ) : current === undefined ? (
              <span className="font-semibold text-muted">
                none. The fixture is serving <span className="text-ivory">{mode}</span>, which
                changes the search page rather than this one.
              </span>
            ) : (
              <span className={`font-semibold ${current.fault ? 'text-blocked' : 'text-verified'}`}>
                {current.verdict}
              </span>
            )}
          </div>

          {/* The wait is thirty real seconds against Bright Data. Showing the
              reasoning during them turns the worst part of the demo into the
              part worth watching. */}
          <div className="mt-5">
            <DecisionStream
              collectorId={collectorId}
              label="Run real collector"
              {...(canRunCollector
                ? {}
                : {
                    disabledReason:
                      'NOTICE_ADMIN_TOKEN is not set on the server that renders this dashboard, so no run can be authorized.',
                  })}
            />
          </div>

          {phase.kind === 'failed' ? (
            <p className="mt-3 rounded border border-blocked/30 bg-red-50 p-2.5 font-mono text-[12px] leading-normal text-blocked">
              {phase.message}
            </p>
          ) : null}

          {/* The interaction failure, on its own collector.

              A Scraper Studio collector that types into a box and clicks
              search keeps working after the form renames its field: the input
              id it was bound to is unchanged, so every step succeeds and the
              term is silently dropped. The page returns a real product at a
              real price, for a search nobody performed. Nothing in the run
              errors, which is why it needs the same two-sensor test as a price
              and not a new detector. */}
          {searchCollector === undefined ? null : (
            <div className="mt-5 border-t border-surface-border pt-4">
              <p className="text-[11px] uppercase tracking-pixel text-muted font-semibold">
                Interaction failure
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                A different collector, on a different page. It types a search term and clicks. The
                form renames its field while leaving the input id alone, so every step still
                succeeds and the term is dropped. The results are real, and for a search nobody
                ran.
              </p>

              <button
                type="button"
                disabled={busy || locked}
                onClick={() => {
                  // A toggle, not a one-way switch. Pressed while already
                  // renamed it used to re-send the same mode and do nothing
                  // visible, leaving the only way back a scroll up to the
                  // Baseline button.
                  switchTo(
                    drifted
                      ? {
                          id: 'baseline',
                          label: 'Restore the search field',
                          effect: 'The form submits its original field again.',
                          fault: false,
                          verdict: 'healthy',
                        }
                      : {
                          id: 'search_drift',
                          label: 'Rename the search field',
                          effect: 'The search box still works. The term never reaches the server.',
                          fault: true,
                          verdict: 'extractor_drift',
                        },
                  );
                }}
                /* Centred, uppercase and tracked. Left-aligned text in a
                   full-width bordered box reads as a text input, and people
                   tried to type in it. This is an action, so it is shaped
                   like the run button below rather than like a field. */
                className={`mt-3 inline-flex w-full items-center justify-center rounded-md border-2 px-6 py-3 font-mono text-[12px] font-semibold uppercase tracking-pixel transition-all disabled:opacity-40 ${
                  drifted
                    ? 'border-blocked bg-red-50 text-blocked hover:bg-red-100'
                    : 'border-ivory bg-transparent text-ivory hover:bg-ivory hover:text-white'
                }`}
              >
                {drifted ? 'Restore the search field' : 'Rename the search field \u25b8'}
              </button>

              {drifted ? (
                <p className="mt-2 text-[11.5px] leading-normal text-blocked">
                  Renamed. The box still works and the term is being dropped.
                </p>
              ) : null}

              <div className="mt-2">
                <DecisionStream
                  collectorId={searchCollector.id}
                  url={searchCollector.url}
                  label="Run the search collector"
                  {...(canRunCollector
                ? {}
                : {
                    disabledReason:
                      'NOTICE_ADMIN_TOKEN is not set on the server that renders this dashboard, so no run can be authorized.',
                  })}
                />
              </div>

              <p className="mt-2 text-[11px] leading-normal text-muted">
                Collector {searchCollector.brightDataId} on {searchCollector.url}
              </p>

              {/* The row the collector returns carries the proof in its own
                  output: it is handed `?q=Nova` and ends up on `?query=Nova`.
                  Worth naming, because it is the most convincing artifact here
                  and it is easy to miss in the stream. */}
              <p className="mt-2 border-t border-surface-border pt-2 text-[12px] leading-normal text-muted">
                Expected verdict:{' '}
                <span className={`font-semibold ${drifted ? 'text-blocked' : 'text-verified'}`}>
                  {drifted ? 'extractor_drift' : 'healthy'}
                </span>
                {drifted ? (
                  <>
                    {' '}
                    The collector is asked for <code>?q=Nova</code> and its own row comes back
                    naming <code>?query=Nova</code>, carrying Vega Earbuds at 79 for a search of
                    Nova. Every step succeeded.
                  </>
                ) : null}
              </p>
            </div>
          )}

        </div>

        {/* The target page preview ---------------------------------- */}
        <div className="bg-surface-soft/30 p-6 font-mono flex flex-col">
          {/* `min-h-0` on both, or a flex child refuses to shrink below its
              content and the iframe pushes the column taller instead of
              filling it. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-pixel text-muted font-semibold">Target Page Render</span>
                <span className="text-[10px] font-mono uppercase bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">
                  {mode ?? 'unknown'}
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
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-md">
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
                  <span className="truncate">doorway-lab.onrender.com/opportunity/ai-fellowship</span>
                </div>
              </div>

              {/*
                The real page, embedded.

                This was a hand-drawn reconstruction of DriftMart inside browser
                chrome, which cannot carry the argument it was placed here to
                make. The claim is that after a redesign the page still looks
                correct to a person; a redrawing of the page proves only that
                the drawing looks correct. It also invented a SKU, a category
                and a shipping time that appear nowhere on the real page, and
                asserted an HTTP status nothing had measured.

                Keyed on `frame` so switching modes refetches instead of
                serving the previous layout from cache.
              */}
              <iframe
                key={frame}
                src={`${fixtureUrl}/product/headphones`}
                title="DriftMart product page, live"
                className="min-h-[340px] w-full flex-1 bg-white"
                sandbox="allow-same-origin"
              />
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
