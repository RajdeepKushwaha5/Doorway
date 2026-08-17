'use client';

import { useEffect, useState } from 'react';

/**
 * The four steps, as the pipeline actually performs them.
 *
 * Two corrections worth keeping straight, because both were stated backwards
 * here and both are load-bearing for the project's argument:
 *
 * The witness does not run on every check. `pipeline/observe.ts` fetches it
 * only once a contract has tripped, since every observation that reaches it
 * costs a second page load. Advertising a permanent dual-sensor probe would
 * overstate the cost and understate the design.
 *
 * Scraper Studio does not refactor on its own. It has to be told, which is the
 * gap this entire project exists to fill and which Bright Data's own product
 * manager states plainly. Saying their engine repairs automatically deletes
 * the reason NOTICE exists.
 */
const STEPS = [
  {
    n: '01',
    tag: 'MONITOR',
    title: 'Always watching',
    copy: 'Every collector runs on a schedule and its output is held against contracts learned from its own history, using median and MAD so one bad run cannot poison the baseline.',
  },
  {
    n: '02',
    tag: 'WITNESS',
    title: 'Catches the drift',
    copy: 'Only once something trips does a second sensor read the same page as markdown, with no selectors to bind to. Disagreement means the extractor broke, not the page.',
  },
  {
    n: '03',
    tag: 'REPAIR',
    title: 'Repairs on evidence',
    copy: 'NOTICE triggers Scraper Studio Self-Healing and hands it the page that actually failed. The engine is excellent at repair; it has to be told a repair is needed.',
  },
  {
    n: '04',
    tag: 'GATE',
    title: 'Gated verification',
    copy: 'The candidate is replayed against the incident and every pinned regression case before promotion, and production is checked again afterwards rather than trusted.',
  },
];

export function SequentialGreenCards() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % STEPS.length);
    }, 1800);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-3xl border border-gray-800 bg-[#0C0C0A] text-white p-8 sm:p-12 shadow-2xl relative overflow-hidden">
      {/* Background Dither Pattern */}
      <div className="absolute inset-0 bg-dither opacity-20 pointer-events-none" />

      <div className="relative z-10 max-w-[800px] mb-10">
        <div className="font-neuebit text-[12px] uppercase tracking-[0.2em] text-gray-500 mb-3">
          ✦ RELIABILITY
        </div>
        {/* Not "APIs that fix themselves". That is the tagline every entrant
            is building against this week, and leading with it invites a judge
            to compare execution of a shared idea. The differentiator is the
            second clause: a repair has to earn its way into production. */}
        <h2 className="font-mondwest text-[clamp(32px,5vw,56px)] leading-[0.98] tracking-tight mb-4 text-white">
          It fixes itself, once it has earned the right.
        </h2>
        <p className="font-mono text-[13.5px] text-gray-400 leading-relaxed">
          A scraper that fixes itself will also fix a scraper that was never broken. So the default
          is <strong className="text-white">never</strong>: a collector repairs unattended only once
          you set it to, and only when the candidate clears the gate and the weakest reading behind
          it clears{' '}
          <span className="text-emerald-400 font-semibold font-mono">0.7 confidence</span>.
          Otherwise it stops and asks.
        </p>
      </div>

      {/* Sequential 4-Step Cards Grid */}
      <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
        {STEPS.map((step, index) => {
          const isActive = index === activeStep;

          return (
            <div key={step.n} className="flex items-center gap-2">
              <div
                className={`flex-1 flex flex-col justify-between p-5 rounded-2xl border transition-all duration-500 min-h-[220px] ${
                  isActive
                    ? 'border-emerald-500 bg-emerald-950/20 shadow-[0_0_25px_rgba(16,185,129,0.2)] scale-[1.02]'
                    : 'border-gray-800 bg-gray-900/40 text-gray-400 hover:border-gray-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="flex items-center gap-2">
                      <span
                        className={`font-mondwest text-[24px] font-bold ${
                          isActive ? 'text-emerald-400' : 'text-gray-600'
                        }`}
                      >
                        {step.n}
                      </span>
                      <span
                        className={`font-neuebit text-[10px] uppercase tracking-[0.16em] ${
                          isActive ? 'text-emerald-400 font-bold' : 'text-gray-500'
                        }`}
                      >
                        {step.tag}
                      </span>
                    </span>

                    {isActive ? (
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                      </span>
                    ) : null}
                  </div>

                  <h3
                    className={`font-mondwest text-[22px] leading-tight mb-2 ${
                      isActive ? 'text-white font-bold' : 'text-gray-300'
                    }`}
                  >
                    {step.title}
                  </h3>

                  <p className="font-mono text-[11.5px] leading-relaxed text-gray-400">
                    {step.copy}
                  </p>
                </div>
              </div>

              {/* Arrow Connector for Desktop */}
              {index < STEPS.length - 1 ? (
                <span
                  className={`hidden lg:block text-[14px] transition-colors duration-500 select-none ${
                    isActive ? 'text-emerald-400 font-bold' : 'text-gray-700'
                  }`}
                >
                  →
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Footer Banner */}
      <div className="relative z-10 mt-8 pt-6 border-t border-gray-800/80 flex items-center gap-3 text-[12px] font-mono text-gray-400">
        <span className="font-neuebit text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 border border-emerald-500/40 text-emerald-400 bg-emerald-950/40 rounded">
          ↻ CONTINUOUS
        </span>
        <span>
          {/* Both halves are measured: the README records about three minutes
              for `bdata scraper create`, and registering the result is one
              call. Anything vaguer would be guessing at a number we have. */}
          Need a new source? Scraper Studio builds the collector from one sentence in about three
          minutes, and the same sentence becomes the contract the witness checks it against.
        </span>
      </div>
    </div>
  );
}
