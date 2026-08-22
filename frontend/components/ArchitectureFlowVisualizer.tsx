'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface FlowNode {
  id: string;
  step: string;
  title: string;
  tagline: string;
  badge: string;
  badgeType: 'emerald' | 'blue' | 'purple' | 'amber';
  description: string;
  input: string;
  output: string;
  codeSnippet: string;
  details: string[];
}

const FLOW_NODES: FlowNode[] = [
  {
    id: 'discovery',
    step: '01',
    title: 'Web Frontier & Unlocker',
    tagline: 'Host-fair crawler powered by Web Unlocker',
    badge: '99.9% UNBLOCKED',
    badgeType: 'emerald',
    description:
      'The frontier crawler traverses official long-tail university portals, scholarship registers, and research institutes with per-host rate limiting, ETags, and automated proxy unblocking.',
    input: 'Long-tail seeds & link graph',
    output: 'Raw unblocked HTML & canonical URLs',
    codeSnippet: `bdata request get "https://cprgindia.org/fellowship" --unblocker`,
    details: [
      'Bypasses Cloudflare & Akamai anti-bot barriers',
      'Host-fairness crawler respecting target site budgets',
      'Preserves provenance brief of target domain',
    ],
  },
  {
    id: 'dual-sensors',
    step: '02',
    title: 'Dual Independent Sensors',
    tagline: 'Scraper Studio + Markdown Witness',
    badge: 'ISOLATED SENSORS',
    badgeType: 'emerald',
    description:
      'Two completely isolated requests read the same page: Sensor 1 runs the Scraper Studio LLM collector for structured JSON; Sensor 2 renders an independent semantic Markdown witness snapshot.',
    input: 'Unblocked page payload',
    output: 'Structured JSON + Markdown Witness',
    codeSnippet: `// Sensor 1: bdata scraper run c_fellowship\n// Sensor 2: unlocker.fetchMarkdown(url)`,
    details: [
      'Sensor 1 (Scraper Studio): Fast structured field parser',
      'Sensor 2 (Web Unlocker Witness): Pure semantic ground truth',
      'Independent network paths with zero shared state',
    ],
  },
  {
    id: 'consensus',
    step: '03',
    title: 'Trust Engine Consensus',
    tagline: '6-way semantic classification engine',
    badge: '6-WAY CONSENSUS',
    badgeType: 'emerald',
    description:
      'Reconciles both sensor readings across protected fields. Resolves relative links, parses semantic date timestamps, and evaluates whether discrepancies are true site changes or extractor drift.',
    input: 'Dual sensor outputs',
    output: 'Classified Verdict (Healthy | Drift | Source Change)',
    codeSnippet: `const verdict = reconcile(collectorReading, witnessSnapshot);`,
    details: [
      'Mathematical date arithmetic (handles 18 Sep vs 2026-09-18)',
      'Relative link resolver with mailto/anchor filtering',
      'Strict quarantine of drifted or corrupted fields',
    ],
  },
  {
    id: 'proof-sealing',
    step: '04',
    title: 'Cryptographic Proof Gate',
    tagline: 'SHA-256 sealed audit certificates',
    badge: 'SHA-256 SEALED',
    badgeType: 'emerald',
    description:
      'Every verified fact and quarantined incident is hashed and cryptographically sealed with an immutable SHA-256 certificate chain, verifiable by anyone at /verify.',
    input: 'Verified record + raw sensor payload',
    output: 'Cryptographic Certificate Chain',
    codeSnippet: `sha256(collectorHash + witnessHash + timestamp + verdict)`,
    details: [
      'Zero-knowledge public evidence verification',
      'Permanent tamper-proof incident log',
      'Eliminates AI hallucinations and synthetic data',
    ],
  },
  {
    id: 'self-healing',
    step: '05',
    title: 'Closed-Loop Self-Healing',
    tagline: 'Auto-repair loop via Scraper Studio API',
    badge: 'AUTO-REPAIR LOOP',
    badgeType: 'emerald',
    description:
      'When extractor drift is isolated, Doorway dispatches an automated prompt to Scraper Studio API (bdata scraper heal). The candidate repair is tested in a sandbox before production promotion.',
    input: 'Drift incident brief',
    output: 'Healed Collector promoted to production',
    codeSnippet: `bdata scraper heal c_fellowship "deadline shifted to table"`,
    details: [
      'Automated drift diagnosis and prompt synthesis',
      'Quarantine sandbox validation against live witness',
      'Zero downstream downtime during site HTML redesigns',
    ],
  },
  {
    id: 'mcp-agents',
    step: '06',
    title: 'Downstream AI & MCP Server',
    tagline: 'Model Context Protocol for AI coding agents',
    badge: 'MCP PROTOCOL',
    badgeType: 'emerald',
    description:
      'Verified opportunities and application roadmaps are served directly to autonomous AI coding agents, Claude Desktop, and Cursor via Doorway native Model Context Protocol (MCP) server.',
    input: 'Verified Opportunity Store',
    output: 'Student Readiness Plans & Application Roadmaps',
    codeSnippet: `mcp.call("search_verified_opportunities", { domain: "AI" })`,
    details: [
      'Native MCP server at backend/src/mcp/server.ts',
      'Calculates student readiness score & missing documents',
      'Powers autonomous applications with 100% verified data',
    ],
  },
];

export function ArchitectureFlowVisualizer() {
  const [activeNodeId, setActiveNodeId] = useState<string>('dual-sensors');
  const activeNode = FLOW_NODES.find((n) => n.id === activeNodeId) ?? FLOW_NODES[1]!;

  return (
    <section className="bg-[#0c0c0a] text-white border-t border-b border-neutral-800 relative overflow-hidden py-20 select-none">
      {/* Background Subtle Tech Grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(16, 185, 129, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(16, 185, 129, 0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="mx-auto max-w-[1400px] px-6 lg:px-12 relative z-10">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-12 border-b border-neutral-800">
          <div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-400 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              03 / ARCHITECTURE &amp; WORKING FLOW
            </div>
            <h2 className="mt-3 font-mondwest text-[clamp(42px,5vw,72px)] leading-[0.9] tracking-tight text-white">
              The Dual-Sensor Trust Pipeline.
            </h2>
            <p className="mt-3 font-mono text-[13px] text-neutral-400 max-w-[650px] leading-relaxed">
              How Bright Data Scraper Studio, Web Unlocker, and Doorway's Consensus Engine turn volatile web portals into verified, self-healing ground truth.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/proof"
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-[11px] uppercase tracking-wider px-5 py-3 rounded-md transition-all shadow-md hover:shadow-emerald-500/20 whitespace-nowrap"
            >
              RUN LIVE FAULT TEST ↗
            </Link>
          </div>
        </div>

        {/* Interactive Flow Pipeline Nodes (Desktop Grid & Mobile List) */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {FLOW_NODES.map((node) => {
            const isActive = node.id === activeNodeId;
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => setActiveNodeId(node.id)}
                className={`text-left p-4 rounded-xl border transition-all relative group flex flex-col justify-between min-h-[140px] ${
                  isActive
                    ? 'bg-neutral-900 border-emerald-500 shadow-lg shadow-emerald-950/50 scale-[1.02]'
                    : 'bg-neutral-950/80 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-emerald-400">
                      STAGE {node.step}
                    </span>
                    {isActive ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-neutral-700 group-hover:bg-neutral-500 transition-colors" />
                    )}
                  </div>
                  <h4 className="mt-2 font-mondwest text-xl text-white group-hover:text-emerald-300 transition-colors leading-tight">
                    {node.title}
                  </h4>
                </div>

                <div className="mt-3">
                  <span className="inline-block font-mono text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/40">
                    {node.badge}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detailed Inspector Display for Selected Active Node */}
        <div className="mt-8 border border-neutral-800 rounded-2xl bg-neutral-950 p-6 sm:p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8 shadow-2xl">
          {/* Left Column: Description & Mechanics */}
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] font-bold text-emerald-400 bg-emerald-950/90 border border-emerald-800/50 px-2.5 py-1 rounded">
                  STAGE {activeNode.step} SPECIFICATION
                </span>
                <span className="font-mono text-[11px] text-neutral-400">
                  {activeNode.tagline}
                </span>
              </div>
              <h3 className="mt-3 font-mondwest text-3xl sm:text-4xl text-white">
                {activeNode.title}
              </h3>
              <p className="mt-3 font-mono text-[13px] text-neutral-300 leading-relaxed">
                {activeNode.description}
              </p>
            </div>

            {/* Input / Output Pipeline IO */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="bg-neutral-900/90 border border-neutral-800 p-4 rounded-xl">
                <div className="font-mono text-[10px] uppercase font-bold text-neutral-400">
                  INPUT DATA
                </div>
                <div className="font-mono text-[12px] text-emerald-300 mt-1 font-semibold">
                  {activeNode.input}
                </div>
              </div>
              <div className="bg-neutral-900/90 border border-neutral-800 p-4 rounded-xl">
                <div className="font-mono text-[10px] uppercase font-bold text-neutral-400">
                  GUARANTEED OUTPUT
                </div>
                <div className="font-mono text-[12px] text-white mt-1 font-semibold">
                  {activeNode.output}
                </div>
              </div>
            </div>

            {/* Bullet Highlights */}
            <div className="space-y-2 pt-2 border-t border-neutral-800/80">
              <div className="font-mono text-[10.5px] uppercase font-bold tracking-wider text-neutral-400">
                Key Architectural Invariants:
              </div>
              <ul className="space-y-1.5">
                {activeNode.details.map((detail, idx) => (
                  <li
                    key={idx}
                    className="font-mono text-[12px] text-neutral-300 flex items-start gap-2.5"
                  >
                    <span className="text-emerald-400 font-bold mt-0.5">✦</span>
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right Column: Code Snippet & Live Verification Action */}
          <div className="flex flex-col justify-between bg-black border border-neutral-800 rounded-xl p-5 sm:p-6 font-mono">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span>terminal / telemetry</span>
                </div>
                <span className="text-[10px] text-emerald-400 uppercase">
                  Doorway v1.0
                </span>
              </div>

              <div className="mt-4 p-3.5 bg-neutral-950 rounded-lg border border-neutral-800/80 text-[11.5px] text-emerald-300 overflow-x-auto">
                <pre className="leading-relaxed whitespace-pre-wrap">{activeNode.codeSnippet}</pre>
              </div>

              <p className="mt-4 text-[11px] text-neutral-400 leading-relaxed">
                Doorway enforces zero hallucinations by requiring corroboration from independent sensors before any scholarship or grant is published to students.
              </p>
            </div>

            <div className="pt-6 border-t border-neutral-800/80 flex items-center justify-between gap-3">
              <Link
                href="/engine"
                className="w-full text-center bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700 py-3 rounded-lg text-[11px] uppercase tracking-wider font-bold transition-colors"
              >
                Inspect Telemetry Console →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
