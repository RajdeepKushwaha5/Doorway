'use client';

import { useEffect, useState } from 'react';

/**
 * Three real runs, not three plausible ones.
 *
 * Every prompt is the sentence a collector was actually created from, every
 * command exists in package.json or the README, every witness line is what the
 * extractor read off the page, and every response is the shape the API really
 * returns. Confidence in particular is 0.95 and not 1.0, because
 * `pipeline/feed.ts` never issues 1.0 for anything: a page that agreed a moment
 * ago is the strongest claim this system makes, and rounding that to certainty
 * on the landing page contradicts the argument the page is making.
 */
const SCENARIOS = [
  {
    prompt: 'Extract the product name, the purchase price as a number, and the availability text',
    command: 'curl -s "$NOTICE_API/api/feed/$COLLECTOR"',
    witness: 'Price: **$249** · Availability: **In stock**',
    json: `{\n  "data": { "product_name": "Nova Headphones", "price": 249 },\n  "health": {\n    "status": "verified",\n    "confidence": 0.95,\n    "stale": false\n  }\n}`,
  },
  {
    prompt: 'Extract the book title, the price excluding tax as a number, and the availability text',
    command: 'claude mcp add notice -- npm run mcp',
    witness: 'Price excl tax: **£51.77** · Availability: **In stock (22 available)**',
    json: `VERIFIED. Two independent Bright Data sensors agree on this right now.\nconfidence    0.95\n\n{\n  "book_title": "A Light in the Attic",\n  "price_excl_tax": 51.77\n}`,
  },
  {
    prompt: 'Catch a layout change that returns a valid date from the wrong field',
    command: 'npm run blindspot -- c_mt36mo6tj37dmjgqh',
    witness: 'Application deadline: **18 September 2026** read from line 15 · collector said **1 September 2026**',
    json: `{\n  "verdict": "extractor_drift",\n  "collector": "1 September 2026",\n  "witness": "18 September 2026",\n  "confidence": 0.85,\n  "action": "quarantined"\n}`,
  },
];

export function AutoTypeTerminal() {
  const [index, setIndex] = useState(0);
  const [typedPrompt, setTypedPrompt] = useState('');
  const [typedCommand, setTypedCommand] = useState('');
  const [showOutput, setShowOutput] = useState(false);

  const scenario = SCENARIOS[index] ?? SCENARIOS[0]!;

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let charIndex = 0;
    setTypedPrompt('');
    setTypedCommand('');
    setShowOutput(false);

    // Step 1: Type the Prompt
    const typePrompt = () => {
      if (charIndex <= scenario.prompt.length) {
        setTypedPrompt(scenario.prompt.slice(0, charIndex));
        charIndex++;
        timeoutId = setTimeout(typePrompt, 35);
      } else {
        // Pause then type command
        charIndex = 0;
        timeoutId = setTimeout(typeCommand, 400);
      }
    };

    // Step 2: Type the Terminal Command
    const typeCommand = () => {
      if (charIndex <= scenario.command.length) {
        setTypedCommand(scenario.command.slice(0, charIndex));
        charIndex++;
        timeoutId = setTimeout(typeCommand, 30);
      } else {
        // Pause then show JSON output
        timeoutId = setTimeout(() => {
          setShowOutput(true);
          // Wait 3.5s then next scenario
          timeoutId = setTimeout(() => {
            setIndex((prev) => (prev + 1) % SCENARIOS.length);
          }, 3500);
        }, 300);
      }
    };

    typePrompt();

    return () => clearTimeout(timeoutId);
  }, [index, scenario]);

  return (
    <div className="border border-gray-200 rounded-2xl bg-gradient-to-br from-gray-50 to-white p-6 sm:p-7 flex flex-col min-w-0 font-mono text-[12px] space-y-3">
      {/* Step 1 Card: Prompt Autotype */}
      <div className="space-y-1">
        <div className="font-neuebit text-[10px] uppercase tracking-[0.16em] text-gray-400">
          ① YOU DESCRIBE IT (SCRAPER STUDIO)
        </div>
        <div className="flex items-center gap-2.5 px-4 py-3 bg-white border border-gray-200 rounded-lg min-h-[46px]">
          <span className="text-parse-accent font-bold flex-shrink-0">▶</span>
          <span className="text-gray-800 leading-relaxed truncate font-mono">
            {typedPrompt}
            <span className="w-1.5 h-4 bg-parse-accent inline-block ml-0.5 animate-pulse align-middle" />
          </span>
        </div>
      </div>

      <div className="text-center text-gray-300 leading-none select-none py-0.5">↓</div>

      {/* Step 2 Card: Markdown Witness */}
      <div className="space-y-1">
        <div className="font-neuebit text-[10px] uppercase tracking-[0.16em] text-gray-400">
          ② THE WITNESS READS IT (WEB UNLOCKER)
        </div>
        <div className="px-4 py-3 bg-gray-900 rounded-lg text-white space-y-1">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <span className="truncate min-w-0">
              <span className="text-emerald-400 font-bold">WITNESS</span>{' '}
              <span className="text-gray-300">{scenario.witness}</span>
            </span>
            <span className="font-neuebit text-[9px] uppercase tracking-[0.12em] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded shrink-0">
              VERIFIED
            </span>
          </div>
        </div>
      </div>

      <div className="text-center text-gray-300 leading-none select-none py-0.5">↓</div>

      {/* Step 3 Card: Terminal Autotype */}
      <div className="space-y-1">
        <div className="font-neuebit text-[10px] uppercase tracking-[0.16em] text-gray-400">
          ③ CALL IT FROM ANYWHERE (REST + MCP)
        </div>

        <div className="rounded-xl bg-gray-950 border border-gray-800 overflow-hidden shadow-2xl">
          {/* Mac window header */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/10 bg-gray-900/90">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
            </div>
            <span className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-400">
              NOTICE · REPLAY
            </span>
          </div>

          {/* Autotyping Terminal Body */}
          <div className="p-4 space-y-3 min-h-[160px] text-[11.5px] leading-relaxed">
            <div className="flex items-center gap-2 text-emerald-400">
              <span className="text-gray-500 font-bold">$</span>
              <span className="font-mono text-emerald-400 font-semibold">{typedCommand}</span>
              <span className="w-2 h-4 bg-emerald-400 inline-block animate-pulse" />
            </div>

            {showOutput ? (
              <pre className="text-gray-300 font-mono text-[11px] leading-relaxed pl-3 border-l-2 border-emerald-500/50 transition-opacity duration-300">
                {scenario.json}
              </pre>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
