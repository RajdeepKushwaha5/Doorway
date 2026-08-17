'use client';

import { useEffect, useState } from 'react';

export function ComparisonAnimation() {
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          setStep((s) => (s + 1) % 4);
          return 0;
        }
        return prev + 2;
      });
    }, 80);

    return () => clearInterval(interval);
  }, []);

  const typedText = step >= 1 ? '$25.00 (Deposit Captured)' : 'Extracting CSS selector...';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_120px_1fr] gap-5 items-stretch">
      {/* Left Card: The Old Way (Conventional Monitor) */}
      <div className="flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-3 font-mono text-[11px]">
          {/* The comparison is against the checks a careful team already has,
              not against a browser agent. That is the claim `npm run blindspot`
              actually demonstrates, and it is the one a reader can reproduce. */}
          <span className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-400">
            ✕ EVERY CHECK YOU ALREADY HAVE
          </span>
          <span className="tabular-nums text-gray-500 font-semibold">9 PASSED</span>
        </div>

        <div className="relative flex-1 rounded-[10px] border border-gray-300 bg-white overflow-hidden shadow-lg card-perspective-left p-0 flex flex-col justify-between min-h-[300px]">
          {/* Browser Address Bar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-200 bg-gray-100/90 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            <span className="ml-2 flex-1 truncate font-mono text-[11px] text-gray-500 bg-white border border-gray-200 rounded px-2.5 py-0.5 flex items-center gap-1.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              driftmart-3ut8.onrender.com/product/headphones
            </span>
          </div>

          {/* Animated Browser Content */}
          <div className="p-5 font-mono text-[12px] space-y-3 flex-1 flex flex-col justify-center">
            <div className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">
              DOM Selector: div.price-container &gt; span
            </div>

            <div className="relative border border-gray-200 rounded-md p-3 bg-gray-50 flex items-center justify-between">
              <span className="text-gray-800 font-semibold">{typedText}</span>
              {step < 2 ? (
                <span className="w-2 h-4 bg-gray-600 animate-pulse inline-block" />
              ) : (
                <span className="text-red-600 text-[10px] font-bold uppercase border border-red-200 bg-red-50 px-1.5 py-0.5 rounded">
                  Wrong Field
                </span>
              )}
            </div>

            <div className="mt-2 text-[11px] text-gray-500 space-y-1">
              <div className="flex justify-between">
                <span>Status Code:</span>
                <span className="text-emerald-600 font-bold">200 OK</span>
              </div>
              <div className="flex justify-between">
                <span>Zod Schema:</span>
                <span className="text-emerald-600 font-bold">PASSED (valid float)</span>
              </div>
              <div className="flex justify-between">
                <span>Alert Triggered:</span>
                <span className="text-red-600 font-bold">NONE (Silent Drift)</span>
              </div>
            </div>
          </div>

          {/* Card Footer Warning */}
          <div className="px-4 py-2.5 bg-red-50 border-t border-red-100 text-red-700 font-mono text-[11px] font-semibold flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-600 shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Shipped corrupted price to production model</span>
          </div>
        </div>
      </div>

      {/*
        Two sensors reading the same page, not a race.

        This column previously ran the NOTICE track at 3.5x the other and
        labelled the pair START and FINISH, which asserted that verification is
        faster than not verifying. It is not, and cannot be: NOTICE performs the
        collector's read and then a second independent one. Every observation
        costs two page loads and takes longer than one. Claiming otherwise
        inverts the actual tradeoff, and it is trivially disproved by running
        the thing.

        So the bars now fill together, because that is what the two reads do,
        and the honest cost is printed underneath rather than hidden.
      */}
      <div className="hidden lg:flex flex-col items-center justify-between py-2 px-3 relative rounded-[10px] border border-gray-200 bg-gray-50/80">
        <div className="font-neuebit text-[9px] uppercase tracking-[0.18em] text-gray-400 text-center">
          SAME PAGE
        </div>

        <div className="relative w-full flex-1 my-3 flex justify-around items-center">
          {/* Collector: selector-bound. */}
          <div className="relative w-2 bg-gray-200 h-full rounded-full overflow-hidden">
            <div
              className="w-full bg-gray-400 transition-all duration-100 ease-linear rounded-full"
              style={{ height: `${progress}%` }}
            />
          </div>

          <div className="w-[1px] h-full border-r border-dashed border-gray-300" />

          {/* Witness: markdown, no selectors. Reads concurrently. */}
          <div className="relative w-2 bg-emerald-100 h-full rounded-full overflow-hidden">
            <div
              className="w-full bg-emerald-500 transition-all duration-100 ease-linear rounded-full"
              style={{ height: `${progress}%` }}
            />
          </div>
        </div>

        <div className="font-neuebit text-[9px] uppercase tracking-[0.18em] text-gray-500 text-center leading-tight">
          2 READS
          <br />
          <span className="text-gray-400">2 PAGE LOADS</span>
        </div>
      </div>

      {/* Right Card: The NOTICE Way (Dual Sensor) */}
      <div className="flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-3 font-mono text-[11px]">
          <span className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-parse-accent font-semibold flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-parse-accent">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            THE NOTICE WAY · DUAL SENSOR
          </span>
          <span className="tabular-nums text-parse-accent font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
            1 CAUGHT
          </span>
        </div>

        <div className="relative flex-1 rounded-[10px] border border-emerald-500/40 bg-emerald-50/30 overflow-hidden p-5 font-mono text-[12.5px] card-perspective-right flex flex-col justify-between min-h-[300px]">
          <div className="space-y-3">
            {/* Live Status Chip */}
            <div className="flex items-center justify-between border-b border-emerald-200/60 pb-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span className="text-emerald-800 font-bold uppercase text-[11px] tracking-wider">
                  DUAL_SENSOR_RECONCILIATION
                </span>
              </div>
              {/* This panel is a scripted replay of a run that happened, not a
                  live feed. The control room below is the live surface, and
                  labelling both the same way would make the real one worthless. */}
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                REPLAY
              </span>
            </div>

            {/* Live Dual Comparison Output */}
            <div className="space-y-2 text-[12px] pt-1">
              <div className="flex items-center justify-between p-2 rounded bg-white/80 border border-emerald-100">
                <span className="text-gray-600">Scraper Studio Extractor:</span>
                <span className="text-red-600 font-bold">$25.00</span>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-white/80 border border-emerald-100">
                <span className="text-gray-600">Web Unlocker Markdown:</span>
                <span className="text-emerald-700 font-bold">$249.00</span>
              </div>
            </div>

            {/* Verdict Box */}
            <div className="p-3 rounded-md bg-emerald-950 text-white font-mono text-[11px] space-y-1 shadow-inner">
              <div className="text-amber-300 font-bold flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-amber-300">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                EXTRACTOR_DRIFT DISAGREEMENT
              </div>
              <div className="text-gray-300 text-[10.5px]">
                Rule: Extractor changed while Markdown stayed $249.00. Extractor selector drifted to deposit field.
              </div>
            </div>
          </div>

          {/* Action Resolution Banner */}
          <div className="px-3 py-2 bg-emerald-600 text-white rounded-md font-mono text-[11px] font-bold flex items-center justify-between mt-3">
            <span className="flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              QUARANTINED &amp; GATED
            </span>
            <span className="text-[10px] bg-emerald-700 px-2 py-0.5 rounded uppercase">Refused</span>
          </div>
        </div>
      </div>
    </div>
  );
}
