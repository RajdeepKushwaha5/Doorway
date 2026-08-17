'use client';

import { useEffect, useState } from 'react';

const SCENARIOS = [
  {
    prompt: 'Extract product title, price, and stock status from driftmart.com',
    command: 'curl -s https://notice.brightdata.com/api/feed/driftmart',
    witness: 'Purchase price: **$249.00** · Stock: **In Stock**',
    json: `{\n  "collectorId": "driftmart-headphones",\n  "status": "VERIFIED",\n  "sensors": { "scraperStudio": 249, "webUnlocker": 249 },\n  "quarantined": false\n}`,
  },
  {
    prompt: 'Watch books.toscrape.com for price drops with selector-free markdown witness',
    command: 'claude mcp add notice -- npm run mcp',
    witness: 'Price excl tax: **£51.77** · Availability: **In stock (22 available)**',
    json: `{\n  "collectorId": "books-toscrape",\n  "mcpTool": "get_verified_web_data",\n  "verified": true,\n  "confidenceScore": 1.0\n}`,
  },
  {
    prompt: 'Detect silent extractor drift when website changes HTML layout',
    command: 'notice prove --collector c_msvllpds1n1dcoz8qx --url /product/headphones',
    witness: 'Deposit label detected: **$25.00** vs Product price: **$249.00**',
    json: `{\n  "incident": "EXTRACTOR_DRIFT",\n  "action": "QUARANTINE_AND_GATE",\n  "proposedFix": "refactor_template",\n  "gateResult": "PASSED (3/3 regression cases)"\n}`,
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
              NOTICE · LIVE
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
