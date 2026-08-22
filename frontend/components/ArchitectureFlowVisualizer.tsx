'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface NodeDetail {
  id: string;
  title: string;
  category: string;
  icon: string;
  shortDesc: string;
  payloadTitle: string;
  payload: string;
  badge: string;
}

const FLOW_DATA: Record<string, NodeDetail> = {
  seed: {
    id: 'seed',
    title: '01. Target Opportunity Seed',
    category: 'INPUT SOURCE',
    icon: '🌐',
    shortDesc: 'Official university websites, fellowship portals, and government research grant listings.',
    payloadTitle: 'Target Web Request',
    payload: `GET https://cprgindia.org/fellowship\nHost: cprgindia.org\nTarget: AI Policy Fellowship 2026`,
    badge: 'LONG-TAIL SOURCE',
  },
  unlocker: {
    id: 'unlocker',
    title: '02. Bright Data Web Unlocker',
    category: 'INFRASTRUCTURE',
    icon: '⚡',
    shortDesc: 'Bypasses bot protections, executes dynamic JavaScript, and guarantees 99.9% unblocked access.',
    payloadTitle: 'Unlocker Proxy Stream',
    payload: `bdata request get https://cprgindia.org/fellowship --unblocker\nStatus: 200 OK (Clean HTML + JS Executed)`,
    badge: '99.9% UNBLOCKED',
  },
  sensor1: {
    id: 'sensor1',
    title: '03A. Sensor 1: Scraper Studio',
    category: 'DUAL SENSOR',
    icon: '🤖',
    shortDesc: 'Autonomous LLM-generated collector (c_*) extracting structured opportunity schema into JSON.',
    payloadTitle: 'Structured JSON Extraction',
    payload: `{\n  "title": "CPRG Senior Research Fellowship",\n  "stipend": "50,000 INR / month",\n  "deadline": "2026-09-18",\n  "application_url": "https://cprgindia.org/apply"\n}`,
    badge: 'LLM COLLECTOR',
  },
  sensor2: {
    id: 'sensor2',
    title: '03B. Sensor 2: Markdown Witness',
    category: 'DUAL SENSOR',
    icon: '👁️',
    shortDesc: 'Isolated Web Unlocker request rendering raw DOM into deterministic semantic Markdown ground truth.',
    payloadTitle: 'Raw Semantic Witness',
    payload: `## CPRG Senior Research Fellowship\n* Stipend: Rs 50,000 monthly\n* Application Deadline: 18 September 2026\n* [Start Application](/apply)`,
    badge: 'ZERO SHARED CODE',
  },
  gavel: {
    id: 'gavel',
    title: '04. Trust Engine Consensus Gavel',
    category: 'RECONCILIATION',
    icon: '⚖️',
    shortDesc: 'Compares Sensor 1 against Sensor 2 with date parsing (18 Sep = 2026-09-18) and link normalization.',
    payloadTitle: 'Consensus Adjudication',
    payload: `reconcile({\n  sensor1: { deadline: "2026-09-18", stipend: 50000 },\n  sensor2: { deadline: "18 September 2026", stipend: 50000 }\n})\n=> Verdict: HEALTHY (Dual Confirmation)`,
    badge: '6-WAY CONSENSUS',
  },
  proof: {
    id: 'proof',
    title: '05A. Cryptographic Proof Gate',
    category: 'EVIDENCE AUDIT',
    icon: '🔒',
    shortDesc: 'Dual sensor agreement hashes the payload and seals an immutable SHA-256 evidence certificate.',
    payloadTitle: 'SHA-256 Certificate Chain',
    payload: `Certificate ID: cert_e891f04a\nDual Sensors: 100% Corroborated\nSHA-256: 8f2a91b...c9e102\nStatus: VERIFIED & PUBLISHED`,
    badge: 'SHA-256 SEALED',
  },
  quarantine: {
    id: 'quarantine',
    title: '05B. Quarantine & Self-Healing Loop',
    category: 'DRIFT ISOLATION',
    icon: '🛡️',
    shortDesc: 'If Sensor 1 drifts (e.g. class renamed), Doorway isolates failure, holds listing, and auto-heals via CLI.',
    payloadTitle: 'Self-Healing Auto-Repair',
    payload: `[EXTRACTOR DRIFT DETECTED]\nAction: bdata scraper heal c_fellowship "deadline moved to table"\nSandbox Test: PASS (Regressions Validated)\nPromotion: APPROVED`,
    badge: 'AUTO-REPAIR LOOP',
  },
  mcp: {
    id: 'mcp',
    title: '06. Model Context Protocol (MCP)',
    category: 'AI AGENT INTERFACE',
    icon: '⚡',
    shortDesc: 'Serves zero-hallucination verified data to Claude, Cursor, and AI agents for student roadmaps.',
    payloadTitle: 'Native MCP Tool Execution',
    payload: `mcp.call("search_verified_opportunities", {\n  domain: "Artificial Intelligence",\n  educationLevel: "Undergraduate"\n})\n=> 100% Ground Truth Guaranteed`,
    badge: 'MCP PROTOCOL',
  },
};

export function ArchitectureFlowVisualizer() {
  const [activeNode, setActiveNode] = useState<string>('gavel');
  const [simStep, setSimStep] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);

  // Auto animation simulation loop
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setSimStep((prev) => (prev + 1) % 6);
    }, 2400);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const stepToNode: Record<number, string> = {
    0: 'seed',
    1: 'unlocker',
    2: 'sensor1',
    3: 'gavel',
    4: 'proof',
    5: 'mcp',
  };

  const currentActive = FLOW_DATA[activeNode] ?? FLOW_DATA['gavel']!;

  return (
    <section className="bg-[#09090b] text-white border-t border-b border-neutral-800 relative overflow-hidden py-16 select-none">
      {/* Background Matrix Grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgba(16, 185, 129, 0.15) 0%, transparent 70%), linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 32px 32px, 32px 32px',
        }}
      />

      <div className="mx-auto max-w-[1400px] px-6 lg:px-12 relative z-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-10 border-b border-neutral-800">
          <div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-400 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              03 / END-TO-END DATA FLOW DIAGRAM
            </div>
            <h2 className="mt-2 font-mondwest text-[clamp(38px,4.5vw,64px)] leading-[0.9] tracking-tight text-white">
              How Data Flows Through Doorway.
            </h2>
            <p className="mt-2 font-mono text-[12.5px] text-neutral-400 max-w-[680px] leading-relaxed">
              An unforgeable dual-sensor pipeline: from raw university portal unblocking to cryptographic consensus and downstream AI agent execution.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex items-center gap-2 border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-white font-mono text-[11px] uppercase font-bold tracking-wider px-4 py-2.5 rounded-md transition-colors"
            >
              <span className={`h-2 w-2 rounded-full ${isPlaying ? 'bg-emerald-400 animate-ping' : 'bg-neutral-500'}`} />
              <span>{isPlaying ? 'Simulation Active' : 'Resume Simulation'}</span>
            </button>
            <Link
              href="/proof"
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-[11px] uppercase tracking-wider px-4 py-2.5 rounded-md transition-all shadow-sm whitespace-nowrap"
            >
              Test Live Fault ↗
            </Link>
          </div>
        </div>

        {/* Visual Data Flow Diagram Canvas */}
        <div className="mt-12 bg-black/80 border border-neutral-800 rounded-2xl p-6 sm:p-10 shadow-2xl relative">
          {/* FLOW ROW 1: Source & Unlocker */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center max-w-[850px] mx-auto relative">
            {/* Step 1: Target Opportunity Seed */}
            <div
              onClick={() => {
                setActiveNode('seed');
                setIsPlaying(false);
              }}
              className={`p-5 rounded-xl border transition-all cursor-pointer relative group ${
                activeNode === 'seed' || (isPlaying && simStep === 0)
                  ? 'bg-neutral-900 border-emerald-500 shadow-lg shadow-emerald-950/60 ring-2 ring-emerald-500/20'
                  : 'bg-neutral-950/90 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-emerald-400 uppercase">
                  STAGE 01 · INPUT
                </span>
                <span className="text-sm">🌐</span>
              </div>
              <h4 className="mt-2 font-mondwest text-xl text-white">
                Official Web Seed
              </h4>
              <p className="mt-1 font-mono text-[11px] text-neutral-400 line-clamp-2">
                University lab, fellowship site, or research grant portal.
              </p>
              <div className="mt-3 flex items-center justify-between font-mono text-[9px] text-neutral-400 border-t border-neutral-800/80 pt-2">
                <span>Payload: URL</span>
                <span className="text-emerald-400">cprgindia.org</span>
              </div>
            </div>

            {/* Step 2: Bright Data Web Unlocker */}
            <div
              onClick={() => {
                setActiveNode('unlocker');
                setIsPlaying(false);
              }}
              className={`p-5 rounded-xl border transition-all cursor-pointer relative group ${
                activeNode === 'unlocker' || (isPlaying && simStep === 1)
                  ? 'bg-neutral-900 border-emerald-500 shadow-lg shadow-emerald-950/60 ring-2 ring-emerald-500/20'
                  : 'bg-neutral-950/90 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-emerald-400 uppercase">
                  STAGE 02 · UNBLOCK
                </span>
                <span className="text-sm">⚡</span>
              </div>
              <h4 className="mt-2 font-mondwest text-xl text-white">
                Web Unlocker Proxy
              </h4>
              <p className="mt-1 font-mono text-[11px] text-neutral-400 line-clamp-2">
                Automated proxy rotation, JS rendering &amp; anti-bot bypass.
              </p>
              <div className="mt-3 flex items-center justify-between font-mono text-[9px] text-neutral-400 border-t border-neutral-800/80 pt-2">
                <span>Network: Proxy Mesh</span>
                <span className="text-emerald-400 font-bold">99.9% Live</span>
              </div>
            </div>
          </div>

          {/* Central Flow Split Indicator */}
          <div className="my-6 flex flex-col items-center justify-center">
            <div className="h-6 w-px bg-gradient-to-b from-emerald-500 to-emerald-400/20" />
            <div className="font-mono text-[9.5px] uppercase font-bold tracking-widest text-emerald-400 px-3 py-1 rounded-full bg-emerald-950/90 border border-emerald-800/50 my-1 shadow-sm">
              ⚡ PARALLEL DUAL-SENSOR ISOLATION (ZERO SHARED CODE)
            </div>
            <div className="h-6 w-px bg-gradient-to-b from-emerald-400/20 to-emerald-500" />
          </div>

          {/* FLOW ROW 2: Dual Independent Sensors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-[950px] mx-auto">
            {/* Sensor 1: Scraper Studio */}
            <div
              onClick={() => {
                setActiveNode('sensor1');
                setIsPlaying(false);
              }}
              className={`p-5 rounded-xl border transition-all cursor-pointer relative group ${
                activeNode === 'sensor1' || (isPlaying && simStep === 2)
                  ? 'bg-neutral-900 border-emerald-500 shadow-lg shadow-emerald-950/60 ring-2 ring-emerald-500/20'
                  : 'bg-neutral-950/90 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-emerald-400 uppercase">
                  SENSOR A · STRUCTURED PARSER
                </span>
                <span className="text-sm">🤖</span>
              </div>
              <h4 className="mt-2 font-mondwest text-xl text-white">
                Scraper Studio Collector (c_*)
              </h4>
              <p className="mt-1 font-mono text-[11px] text-neutral-400">
                LLM-powered schema collector extracting typed JSON (deadline, stipend, eligibility).
              </p>
              <div className="mt-3 bg-black/60 p-2 rounded border border-neutral-800/80 font-mono text-[10px] text-emerald-300">
                Output: JSON Fields
              </div>
            </div>

            {/* Sensor 2: Markdown Witness */}
            <div
              onClick={() => {
                setActiveNode('sensor2');
                setIsPlaying(false);
              }}
              className={`p-5 rounded-xl border transition-all cursor-pointer relative group ${
                activeNode === 'sensor2' || (isPlaying && simStep === 2)
                  ? 'bg-neutral-900 border-emerald-500 shadow-lg shadow-emerald-950/60 ring-2 ring-emerald-500/20'
                  : 'bg-neutral-950/90 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-emerald-400 uppercase">
                  SENSOR B · INDEPENDENT GROUND TRUTH
                </span>
                <span className="text-sm">👁️</span>
              </div>
              <h4 className="mt-2 font-mondwest text-xl text-white">
                Markdown Witness Stream
              </h4>
              <p className="mt-1 font-mono text-[11px] text-neutral-400">
                Raw semantic Markdown snapshot converted directly from target DOM via Web Unlocker.
              </p>
              <div className="mt-3 bg-black/60 p-2 rounded border border-neutral-800/80 font-mono text-[10px] text-emerald-300">
                Output: Semantic Markdown
              </div>
            </div>
          </div>

          {/* Convergence Arrow into Consensus */}
          <div className="my-6 flex flex-col items-center justify-center">
            <div className="h-6 w-px bg-gradient-to-b from-emerald-500 to-emerald-400/20" />
            <div className="font-mono text-[9.5px] uppercase font-bold tracking-widest text-emerald-400 px-3 py-1 rounded-full bg-emerald-950/90 border border-emerald-800/50 my-1 shadow-sm">
              ⚖️ CONVERGENCE &amp; MATHEMATICAL RECONCILIATION
            </div>
            <div className="h-6 w-px bg-gradient-to-b from-emerald-400/20 to-emerald-500" />
          </div>

          {/* FLOW ROW 3: The Trust Engine Gavel */}
          <div className="max-w-[700px] mx-auto">
            <div
              onClick={() => {
                setActiveNode('gavel');
                setIsPlaying(false);
              }}
              className={`p-6 rounded-xl border text-center transition-all cursor-pointer relative group ${
                activeNode === 'gavel' || (isPlaying && simStep === 3)
                  ? 'bg-neutral-900 border-emerald-500 shadow-xl shadow-emerald-950/70 ring-2 ring-emerald-500/30'
                  : 'bg-neutral-950/90 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="font-mono text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                  STAGE 04 · TRUST ENGINE GAVEL
                </span>
              </div>
              <h3 className="mt-2 font-mondwest text-2xl sm:text-3xl text-white">
                6-Way Consensus Classifier
              </h3>
              <p className="mt-1 font-mono text-[12px] text-neutral-300 max-w-[500px] mx-auto">
                Resolves relative URLs, normalizes date timestamps across formats, and adjudicates agreement vs extractor drift.
              </p>
            </div>
          </div>

          {/* FLOW ROW 4: Branching Outcomes */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-[950px] mx-auto">
            {/* Branch A: Verified & Proof Gate */}
            <div
              onClick={() => {
                setActiveNode('proof');
                setIsPlaying(false);
              }}
              className={`p-5 rounded-xl border transition-all cursor-pointer relative group ${
                activeNode === 'proof' || (isPlaying && simStep === 4)
                  ? 'bg-neutral-900 border-emerald-500 shadow-lg shadow-emerald-950/60 ring-2 ring-emerald-500/20'
                  : 'bg-neutral-950/90 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-emerald-400 uppercase">
                  BRANCH A · 100% CONSENSUS
                </span>
                <span className="text-sm">🔒</span>
              </div>
              <h4 className="mt-2 font-mondwest text-xl text-white">
                Cryptographic Proof Gate
              </h4>
              <p className="mt-1 font-mono text-[11px] text-neutral-400">
                Payload sealed with SHA-256 certificate chain and published to verified opportunity feed.
              </p>
              <div className="mt-3 flex items-center justify-between font-mono text-[9px] text-emerald-400 border-t border-neutral-800/80 pt-2 font-bold">
                <span>Verdict: HEALTHY</span>
                <span>SHA-256 Sealed ↗</span>
              </div>
            </div>

            {/* Branch B: Drift Isolation & Self-Healing */}
            <div
              onClick={() => {
                setActiveNode('quarantine');
                setIsPlaying(false);
              }}
              className={`p-5 rounded-xl border transition-all cursor-pointer relative group ${
                activeNode === 'quarantine'
                  ? 'bg-neutral-900 border-emerald-500 shadow-lg shadow-emerald-950/60 ring-2 ring-emerald-500/20'
                  : 'bg-neutral-950/90 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-amber-400 uppercase">
                  BRANCH B · DRIFT ISOLATED
                </span>
                <span className="text-sm">🛡️</span>
              </div>
              <h4 className="mt-2 font-mondwest text-xl text-white">
                Quarantine &amp; Self-Healing Loop
              </h4>
              <p className="mt-1 font-mono text-[11px] text-neutral-400">
                Corrupted fields withheld immediately; repair prompt dispatched to Scraper Studio API (bdata heal).
              </p>
              <div className="mt-3 flex items-center justify-between font-mono text-[9px] text-amber-400 border-t border-neutral-800/80 pt-2 font-bold">
                <span>Verdict: EXTRACTOR DRIFT</span>
                <span>Auto-Repair Sandbox ↗</span>
              </div>
            </div>
          </div>

          {/* FLOW ROW 5: Downstream Consumer (MCP & AI Agents) */}
          <div className="mt-8 max-w-[700px] mx-auto">
            <div
              onClick={() => {
                setActiveNode('mcp');
                setIsPlaying(false);
              }}
              className={`p-6 rounded-xl border text-center transition-all cursor-pointer relative group ${
                activeNode === 'mcp' || (isPlaying && simStep === 5)
                  ? 'bg-neutral-900 border-emerald-500 shadow-xl shadow-emerald-950/70 ring-2 ring-emerald-500/30'
                  : 'bg-neutral-950/90 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <span className="font-mono text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                  STAGE 06 · DOWNSTREAM EXECUTION
                </span>
              </div>
              <h3 className="mt-2 font-mondwest text-2xl sm:text-3xl text-white">
                Model Context Protocol (MCP) Server
              </h3>
              <p className="mt-1 font-mono text-[12px] text-neutral-300 max-w-[520px] mx-auto">
                Serves verified opportunities to Claude Desktop, Cursor, and AI agents to calculate student readiness and build tailored application roadmaps.
              </p>
            </div>
          </div>
        </div>

        {/* Interactive Deep-Dive Inspector Panel */}
        <div className="mt-10 border border-neutral-800 rounded-2xl bg-neutral-950 p-6 sm:p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8 shadow-2xl">
          {/* Left: Node Explanation */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/90 border border-emerald-800/40 px-2.5 py-1 rounded">
                {currentActive.category}
              </span>
              <span className="font-mono text-[11px] text-neutral-400">
                {currentActive.badge}
              </span>
            </div>

            <h3 className="font-mondwest text-3xl sm:text-4xl text-white">
              {currentActive.title}
            </h3>

            <p className="font-mono text-[13px] text-neutral-300 leading-relaxed">
              {currentActive.shortDesc}
            </p>

            <div className="pt-2">
              <div className="font-mono text-[11px] text-neutral-400">
                Click any stage block in the diagram above to inspect its real-time payload, consensus rules, and live telemetry.
              </div>
            </div>
          </div>

          {/* Right: Live Payload Snippet */}
          <div className="bg-black border border-neutral-800 rounded-xl p-5 font-mono flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                <span className="text-[11px] font-bold text-neutral-300">
                  {currentActive.payloadTitle}
                </span>
                <span className="text-[10px] text-emerald-400 uppercase">
                  DOORWAY ENGINE
                </span>
              </div>
              <div className="mt-3 p-3 bg-neutral-950 rounded-lg border border-neutral-800/80 text-[11px] text-emerald-300 overflow-x-auto">
                <pre className="leading-relaxed whitespace-pre-wrap">{currentActive.payload}</pre>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-neutral-800/80 flex items-center justify-between text-[11px]">
              <span className="text-neutral-400">Status: Zero-Hallucination Verified</span>
              <Link href="/verify" className="text-emerald-400 hover:text-emerald-300 font-bold">
                Verify Proofs →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
