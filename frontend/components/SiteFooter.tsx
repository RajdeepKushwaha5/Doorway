import Link from 'next/link';
import { BrightDataBadge } from '@/components/BrightDataLogo';
import { NoticeLogo } from '@/components/NoticeLogo';
import { FooterGlyphGrid } from '@/components/FooterGlyphGrid';
import { api } from '@/lib/api';

export async function SiteFooter() {
  let collectorCount: number | null = null;
  try {
    collectorCount = (await api.listCollectors()).length;
  } catch {
    collectorCount = null;
  }

  return (
    <footer className="border-t border-gray-200 bg-white pt-16 pb-12 font-mono text-[12px]">
      {/* GitHub Universe Wonderland-Inspired Interactive Feature Showcase */}
      <div className="max-w-[1400px] mx-auto px-6 mb-16">
        <div className="border border-gray-200 rounded-2xl bg-white p-6 sm:p-8 lg:p-10 shadow-sm grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 lg:gap-12 items-center">
          {/* Left: Interactive Graphical Bento Grid */}
          <div className="grid grid-cols-3 grid-rows-2 gap-3 h-[240px] sm:h-[280px]">
            {/* Tile 1: Large Node Tile (Row span 2) */}
            <div className="bento-tile bento-tile-green row-span-2 flex flex-col justify-between p-5 text-left relative overflow-hidden group">
              <div className="flex items-center justify-between w-full">
                <span className="font-mono text-[10px] uppercase font-bold tracking-widest text-emerald-200">
                  SENSOR / 01
                </span>
                <span className="h-2 w-2 rounded-full bg-emerald-300 animate-ping" />
              </div>
              <div className="my-auto text-center transform group-hover:scale-110 transition-transform duration-300">
                <div className="font-mondwest text-4xl sm:text-5xl text-white leading-none tracking-tight">
                  100%
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-200 mt-1">
                  Evidence Gated
                </div>
              </div>
              <div className="font-mono text-[9px] text-emerald-200/80 uppercase">
                Dual-Sensor Consensus
              </div>
            </div>

            {/* Tile 2: Code Bracket Tile */}
            <div className="bento-tile bento-tile-surface p-4 flex items-center justify-center group cursor-pointer">
              <span className="font-mono text-3xl sm:text-4xl text-gray-800 group-hover:text-emerald-600 group-hover:scale-125 transition-all duration-200">
                &#123; &#125;
              </span>
            </div>

            {/* Tile 3: Pixel Cross Grid */}
            <div className="bento-tile bento-tile-black p-4 flex flex-col items-center justify-center group cursor-pointer relative">
              <div className="text-emerald-400 font-mono text-xl group-hover:rotate-90 group-hover:scale-125 transition-all duration-300">
                ✦
              </div>
              <span className="font-mono text-[9px] text-gray-400 mt-1 uppercase tracking-widest group-hover:text-white">
                PROVED
              </span>
            </div>

            {/* Tile 4: Dot-Matrix Tile */}
            <div className="bento-tile bento-tile-black p-4 flex items-center justify-center group cursor-pointer">
              <div className="grid grid-cols-3 gap-1.5 transform group-hover:scale-110 transition-transform">
                <span className="h-1.5 w-1.5 rounded-full bg-gray-600 group-hover:bg-emerald-400 transition-colors" />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-600 group-hover:bg-emerald-400 transition-colors" />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="h-1.5 w-1.5 rounded-full bg-white group-hover:bg-emerald-300 transition-colors" />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-600 group-hover:bg-emerald-400 transition-colors" />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-600 group-hover:bg-emerald-400 transition-colors" />
              </div>
            </div>

            {/* Tile 5: Terminal Cursor Tile */}
            <div className="bento-tile bento-tile-surface p-4 flex items-center justify-center group cursor-pointer">
              <span className="font-mono text-lg font-bold text-gray-900 group-hover:text-emerald-600 transition-colors flex items-center gap-1">
                <span>&gt;_</span>
                <span className="animate-pulse text-emerald-500">■</span>
              </span>
            </div>
          </div>

          {/* Right: Content & Actions */}
          <div className="space-y-4">
            <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              experience-the-trust-engine/
            </div>
            <h3 className="font-mondwest text-[32px] sm:text-[42px] leading-[0.95] text-gray-900">
              Build a world from the live web.
            </h3>
            <p className="font-mono text-[12.5px] text-gray-500 leading-relaxed max-w-[500px]">
              Bright Data discovers official long-tail sources, Scraper Studio structures them, and Doorway binds every important field to cryptographic evidence.
            </p>
            <div className="flex items-center gap-3 pt-2 flex-wrap">
              <Link
                href="/#world"
                className="bg-emerald-500 hover:bg-emerald-600 text-black font-mono font-bold text-[11.5px] uppercase tracking-wider px-6 py-3.5 rounded-md transition-all shadow-sm hover:shadow-emerald-500/20 whitespace-nowrap"
              >
                BUILD MY WORLD ↗
              </Link>
              <a
                href="https://github.com/RajdeepKushwaha5/Doorway"
                target="_blank"
                rel="noreferrer"
                className="border border-gray-300 hover:border-black text-gray-900 font-mono text-[11.5px] uppercase tracking-wider px-6 py-3.5 rounded-md transition-colors whitespace-nowrap"
              >
                READ THE SOURCE ↗
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Main Footer Content */}
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10 pb-12 border-b border-gray-200">
          {/* Column 1: Brand & Status */}
          <div className="space-y-4 pr-4">
            <Link href="/" className="flex items-center gap-2.5 select-none group">
              <NoticeLogo className="w-6 h-6 text-black transition-transform group-hover:scale-105" />
              <span className="font-mondwest font-normal text-[28px] text-gray-900 leading-none">
                Doorway
              </span>
            </Link>
            <p className="text-gray-500 text-[12px] leading-relaxed max-w-[320px]">
              A verified opportunity intelligence platform built on official sources with Bright Data Scraper Studio, Web Unlocker, and the Doorway Trust Engine.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <BrightDataBadge text="Built with Bright Data" />
              <div className="inline-flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50 text-[11px] text-gray-700">
                <span className="relative flex h-1.5 w-1.5">
                  {collectorCount === null ? (
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neutral-400" />
                  ) : (
                    <>
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </>
                  )}
                </span>
                <span className="font-semibold">
                  {collectorCount === null
                    ? 'API UNREACHABLE'
                    : `${String(collectorCount)} COLLECTOR${collectorCount === 1 ? '' : 'S'} ACTIVE`}
                </span>
              </div>
            </div>
          </div>

          {/* Column 2: Product */}
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-gray-900 font-bold mb-4 flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-emerald-500" />
              PRODUCT
            </div>
            <ul className="space-y-2.5 text-gray-600 text-[12px]">
              <li>
                <Link href="/" className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-block">
                  Discover
                </Link>
              </li>
              <li>
                <Link href="/#world" className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-block">
                  Opportunity World
                </Link>
              </li>
              <li>
                <Link href="/proof" className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-block">
                  Check It Yourself
                </Link>
              </li>
              <li>
                <Link href="/engine" className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-block">
                  Trust Engine
                </Link>
              </li>
              <li>
                <Link href="/verify" className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-block">
                  Verify Evidence
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Bright Data */}
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-gray-900 font-bold mb-4 flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-emerald-500" />
              BRIGHT DATA
            </div>
            <ul className="space-y-2.5 text-gray-600 text-[12px]">
              <li>
                <a
                  href="https://brightdata.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-flex items-center gap-1"
                >
                  Platform Overview ↗
                </a>
              </li>
              <li>
                <a
                  href="https://brightdata.com/products/web-scraper/studio"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-flex items-center gap-1"
                >
                  Scraper Studio ↗
                </a>
              </li>
              <li>
                <a
                  href="https://brightdata.com/products/web-unlocker"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-flex items-center gap-1"
                >
                  Web Unlocker ↗
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/brightdata/cli"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-flex items-center gap-1"
                >
                  Bright Data CLI ↗
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: Developers */}
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-gray-900 font-bold mb-4 flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-emerald-500" />
              DEVELOPERS
            </div>
            <ul className="space-y-2.5 text-gray-600 text-[12px]">
              <li>
                <Link href="/#system" className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-block">
                  Self-Healing Architecture
                </Link>
              </li>
              <li>
                <Link href="/engine" className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-block">
                  Collector Operations
                </Link>
              </li>
              <li>
                {/*
                  * Pointed at the thing it names.
                  *
                  * This linked to /engine#system, and the engine page carries
                  * no ids at all, so it landed on an unrelated dashboard and
                  * scrolled nowhere. The label expanded to "Model Context
                  * Protocol Protocol Server" as well.
                  */}
                <a
                  href="https://github.com/RajdeepKushwaha5/Doorway#use-it-from-an-ai-agent"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-block"
                >
                  MCP Server ↗
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/RajdeepKushwaha5/Doorway"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-flex items-center gap-1"
                >
                  GitHub Repository ↗
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Giant Animated Brand Wordmark with Full Permanent Glyph Mosaic Grid */}
        <div className="doorway-footer-brand-container relative my-10 rounded-2xl overflow-hidden border border-gray-200/90 min-h-[160px] sm:min-h-[240px] flex items-center justify-center">
          <FooterGlyphGrid />
          <div className="doorway-footer-brand-mask select-none relative z-10 py-4" aria-label="doorway">
            doorway
          </div>
        </div>

        {/* Bottom Copyright Bar */}
        <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-gray-400 text-[11px]">
          <span>© 2026 DOORWAY · Find the opportunities the web hides.</span>
          <span>Into the Scrape-Verse Hackathon · Powered by Bright Data</span>
        </div>
      </div>
    </footer>
  );
}
