import Link from 'next/link';
import { BrightDataBadge } from '@/components/BrightDataLogo';
import { NoticeLogo } from '@/components/NoticeLogo';

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 bg-white pt-16 pb-12 font-mono text-[12px]">
      {/* Horizontal Black Callout Banner (Matching Parse.bot) */}
      <div className="max-w-[1400px] mx-auto px-6 mb-16">
        <div className="bg-black text-white p-6 sm:p-8 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-2xl">
          <div>
            <h3 className="font-mondwest font-normal not-italic text-[28px] sm:text-[34px] leading-tight text-white">
              Protect your pipeline in two minutes.
            </h3>
            <p className="font-mono text-[12px] text-gray-400 mt-1">
              Sign up for NOTICE: 2 free Bright Data sensors, no credit card required.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <Link
              href="/#control-room"
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-[11px] uppercase tracking-wider px-5 py-3 rounded-md transition-colors whitespace-nowrap"
            >
              GET FREE API KEY →
            </Link>
            <Link
              href="/verified"
              className="border border-gray-700 hover:border-gray-500 text-white font-mono text-[11px] uppercase tracking-wider px-5 py-3 rounded-md transition-colors whitespace-nowrap"
            >
              BROWSE VERIFIED FEED
            </Link>
          </div>
        </div>
      </div>

      {/* Main CTA Section */}
      <div className="max-w-[1400px] mx-auto px-6 text-center pb-16 border-b border-gray-200">
        <h2 className="font-mondwest font-normal not-italic text-[52px] sm:text-[76px] leading-[0.95] tracking-tight text-gray-900 max-w-[900px] mx-auto">
          The web is live data truth.
        </h2>
        <p className="font-mono text-[13px] text-gray-500 max-w-[540px] mx-auto mt-4 leading-relaxed">
          Trust the data, not just the HTTP status code. 2 independent sensors watching your scraper pipeline 24/7.
        </p>

        <div className="mt-7">
          <Link
            href="/#control-room"
            className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] px-8 py-3.5 bg-black text-white rounded-md hover:bg-neutral-800 transition-colors"
          >
            START BUILDING →
          </Link>
        </div>
      </div>

      {/* Main Footer Links Grid (Streamlined & Clean) */}
      <div className="max-w-[1400px] mx-auto px-6 pt-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr] gap-10">
          {/* Column 1: Brand Info */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center gap-2 select-none group">
              <NoticeLogo className="w-6 h-6 text-black transition-transform group-hover:scale-105" />
              <span className="font-mondwest font-normal not-italic text-[26px] text-gray-900 leading-none">
                Notice
              </span>
            </Link>
            <p className="text-gray-500 text-[12px] leading-relaxed max-w-[280px]">
              Dual-sensor drift detection for Bright Data Scraper Studio &amp; Web Unlocker. Zero silent corruption.
            </p>

            <div className="pt-1">
              <BrightDataBadge text="Built with Bright Data" />
            </div>

            <div className="pt-2">
              <div className="inline-flex items-center gap-2 border border-gray-200 rounded-full px-3 py-1 bg-gray-50 text-[11px] text-gray-600">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                <span>3 COLLECTORS LIVE</span>
              </div>
            </div>
          </div>

          {/* Column 2: Product */}
          <div>
            <div className="font-neuebit text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-4 font-bold">
              PRODUCT
            </div>
            <ul className="space-y-2.5 text-gray-600 text-[12px]">
              <li><Link href="/" className="hover:text-black">Discover</Link></li>
              <li><Link href="/verified" className="hover:text-black">Verified Feed</Link></li>
              <li><Link href="/#control-room" className="hover:text-black">Control Room</Link></li>
              <li><Link href="/#problem" className="hover:text-black">Dual Sensor Verification</Link></li>
            </ul>
          </div>

          {/* Column 3: Bright Data Platform */}
          <div>
            <div className="font-neuebit text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-4 font-bold">
              BRIGHT DATA
            </div>
            <ul className="space-y-2.5 text-gray-600 text-[12px]">
              <li>
                <a href="https://brightdata.com/" target="_blank" rel="noreferrer" className="hover:text-black flex items-center gap-1">
                  Bright Data Platform ↗
                </a>
              </li>
              <li>
                <a href="https://brightdata.com/products/web-scraper/studio" target="_blank" rel="noreferrer" className="hover:text-black flex items-center gap-1">
                  Scraper Studio ↗
                </a>
              </li>
              <li>
                <a href="https://brightdata.com/products/web-unlocker" target="_blank" rel="noreferrer" className="hover:text-black flex items-center gap-1">
                  Web Unlocker ↗
                </a>
              </li>
              <li>
                <a href="https://github.com/brightdata/cli" target="_blank" rel="noreferrer" className="hover:text-black flex items-center gap-1">
                  Bright Data CLI ↗
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: Developers */}
          <div>
            <div className="font-neuebit text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-4 font-bold">
              DEVELOPERS
            </div>
            <ul className="space-y-2.5 text-gray-600 text-[12px]">
              <li><Link href="/#system" className="hover:text-black">Architecture &amp; Self-Healing</Link></li>
              <li><Link href="/#faq" className="hover:text-black">FAQ</Link></li>
              <li><Link href="/#system" className="hover:text-black">Model Context Protocol (MCP)</Link></li>
              <li>
                <a href="https://github.com/prabhatkumar67/notice" target="_blank" rel="noreferrer" className="hover:text-black flex items-center gap-1">
                  GitHub Repository ↗
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Copyright Bar */}
        <div className="mt-12 pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-gray-400 text-[11px]">
          <span>© 2026 NOTICE. Trust the data, not the green check.</span>
          <span>Into the Scrape-Verse Hackathon</span>
        </div>
      </div>
    </footer>
  );
}
