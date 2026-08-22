import Link from 'next/link';
import { BrightDataBadge } from '@/components/BrightDataLogo';
import { NoticeLogo } from '@/components/NoticeLogo';
import { api } from '@/lib/api';

export async function SiteFooter() {
  // A badge that says LIVE has to be reading something. This one said "3
  // COLLECTORS LIVE" against a fleet of two, which is the sort of number that
  // is wrong the moment a collector is added or removed. Ask, and when the API
  // cannot be reached say that instead of asserting a count.
  let collectorCount: number | null = null;
  try {
    collectorCount = (await api.listCollectors()).length;
  } catch {
    collectorCount = null;
  }

  return (
    <footer className="border-t border-gray-200 bg-white pt-16 pb-12 font-mono text-[12px]">
      {/* Horizontal Black Callout Banner (Matching Parse.bot) */}
      <div className="max-w-[1400px] mx-auto px-6 mb-16">
        <div className="bg-black text-white p-6 sm:p-8 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-2xl">
          {/* There is no signup, no account, and no API key issued by this
              project. It is a self-hosted MIT repository that authenticates to
              Bright Data with your own key. A banner offering a free API key
              and no credit card describes a product that does not exist. */}
          <div>
            <h3 className="font-mondwest font-normal not-italic text-[28px] sm:text-[34px] leading-tight text-white">
              Build a world from the live web.
            </h3>
            <p className="font-mono text-[12px] text-gray-400 mt-1">
              {/* "Only BRIGHTDATA_API_KEY is required" was true of reading and
                  false of everything else: mutations need NOTICE_ADMIN_TOKEN,
                  and a deployed witness needs an Unlocker zone or it silently
                  falls back to a CLI no server has. */}
              Bright Data finds the sources, Scraper Studio structures them, and Doorway keeps
              every important field tied to evidence.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <a
              href="https://github.com/RajdeepKushwaha5/Doorway"
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-[11px] uppercase tracking-wider px-5 py-3 rounded-md transition-colors whitespace-nowrap"
            >
              READ THE SOURCE →
            </a>
            <Link
              href="/#world"
              className="border border-gray-700 hover:border-gray-500 text-white font-mono text-[11px] uppercase tracking-wider px-5 py-3 rounded-md transition-colors whitespace-nowrap"
            >
              BUILD MY WORLD
            </Link>
          </div>
        </div>
      </div>

      {/* Main CTA Section */}
      <div className="max-w-[1400px] mx-auto px-6 text-center pb-16 border-b border-gray-200">
        <h2 className="font-mondwest font-normal not-italic text-[52px] sm:text-[76px] leading-[0.95] tracking-tight text-gray-900 max-w-[900px] mx-auto">
          A life-changing door should not stay hidden.
        </h2>
        {/* Not 24/7. The scheduler defaults to a six-hour interval and pauses
            against a monthly page-load ceiling, because both sensors draw from
            the same free-tier allowance. Advertising continuous watching would
            promise a bill nobody agreed to. */}
        <p className="font-mono text-[13px] text-gray-500 max-w-[540px] mx-auto mt-4 leading-relaxed">
          Doorway turns fragmented opportunity pages into one living world, then keeps that world
          accurate as sources and layouts change.
        </p>

        <div className="mt-7">
          <Link
            href="/#world"
            className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] px-8 py-3.5 bg-black text-white rounded-md hover:bg-neutral-800 transition-colors"
          >
            OPEN THE OPPORTUNITY WORLD →
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
                Doorway
              </span>
            </Link>
            <p className="text-gray-500 text-[12px] leading-relaxed max-w-[280px]">
              A verified opportunity world built from official sources with Bright Data Scraper
              Studio, Web Unlocker and the Doorway Trust Engine.
            </p>

            <div className="pt-1">
              <BrightDataBadge text="Built with Bright Data" />
            </div>

            <div className="pt-2">
              <div className="inline-flex items-center gap-2 border border-gray-200 rounded-full px-3 py-1 bg-gray-50 text-[11px] text-gray-600">
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
                <span>
                  {collectorCount === null
                    ? 'API UNREACHABLE'
                    : `${String(collectorCount)} COLLECTOR${collectorCount === 1 ? '' : 'S'} MONITORED`}
                </span>
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
              <li><Link href="/#world" className="hover:text-black">Opportunity World</Link></li>
              <li><Link href="/proof" className="hover:text-black">Check It Yourself</Link></li>
              <li><Link href="/engine" className="hover:text-black">Trust Engine</Link></li>
              <li><Link href="/verify" className="hover:text-black">Verify Evidence</Link></li>
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
              <li><Link href="/engine" className="hover:text-black">Collector Operations</Link></li>
              <li><Link href="/engine#system" className="hover:text-black">Model Context Protocol (MCP)</Link></li>
              <li>
                <a href="https://github.com/RajdeepKushwaha5/Doorway" target="_blank" rel="noreferrer" className="hover:text-black flex items-center gap-1">
                  GitHub Repository ↗
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Copyright Bar */}
        <div className="mt-12 pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-gray-400 text-[11px]">
          <span>© 2026 DOORWAY. Find the opportunities the web hides.</span>
          <span>Into the Scrape-Verse Hackathon</span>
        </div>
      </div>
    </footer>
  );
}
