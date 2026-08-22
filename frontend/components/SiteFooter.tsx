import Link from 'next/link';
import { BrightDataBadge } from '@/components/BrightDataLogo';
import { NoticeLogo } from '@/components/NoticeLogo';
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
      {/* Callout Action Banner */}
      <div className="max-w-[1400px] mx-auto px-6 mb-16">
        <div className="bg-black text-white p-8 sm:p-10 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8 shadow-2xl border border-neutral-800">
          <div className="max-w-[700px]">
            <h3 className="font-mondwest text-[32px] sm:text-[40px] leading-tight text-white">
              Build a world from the live web.
            </h3>
            <p className="font-mono text-[12.5px] text-neutral-400 mt-2 leading-relaxed">
              Bright Data discovers official long-tail sources, Scraper Studio structures them, and Doorway binds every important field to cryptographic evidence.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <a
              href="https://github.com/RajdeepKushwaha5/Doorway"
              target="_blank"
              rel="noreferrer"
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-[11px] uppercase tracking-wider px-6 py-3.5 rounded-md transition-all shadow-md hover:shadow-emerald-500/20 whitespace-nowrap"
            >
              READ THE SOURCE ↗
            </a>
            <Link
              href="/#world"
              className="border border-neutral-700 hover:border-neutral-400 text-white font-mono text-[11px] uppercase tracking-wider px-6 py-3.5 rounded-md transition-colors whitespace-nowrap"
            >
              BUILD MY WORLD
            </Link>
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
                <Link href="/engine#system" className="hover:text-emerald-600 hover:translate-x-0.5 transition-all inline-block">
                  MCP Protocol Server
                </Link>
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

        {/* Giant Animated Brand Wordmark (Sarvam-Inspired Smooth Sans Cutout) */}
        <div className="doorway-footer-brand-container">
          <div className="doorway-footer-brand-mask select-none" aria-label="doorway">
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
