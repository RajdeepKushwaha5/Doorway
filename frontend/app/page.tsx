import Link from 'next/link';
import { Globe } from '@/components/Globe';
import { RegisterCollector } from '@/components/RegisterCollector';
import { OperationsPanel } from '@/components/OperationsPanel';
import { LiveConsole } from '@/components/LiveConsole';
import { ComparisonAnimation } from '@/components/ComparisonAnimation';
import { AutoTypeTerminal } from '@/components/AutoTypeTerminal';
import { SequentialGreenCards } from '@/components/SequentialGreenCards';
import { SearchAndCollectorCarousel } from '@/components/SearchAndCollectorCarousel';
import { BlindspotsMatrix } from '@/components/BlindspotsMatrix';
import { BrightDataBadge } from '@/components/BrightDataLogo';
import { api } from '@/lib/api';
import type { CollectorSummary, Incident } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STEPS = [
  {
    n: '01',
    title: 'Observe',
    sub: 'Scraper Studio',
    copy: 'A Scraper Studio collector returns structured rows. Contracts check them for missing, impossible or unusual values.',
  },
  {
    n: '02',
    title: 'Witness',
    sub: 'Web Unlocker',
    copy: 'Web Unlocker reads the same page as plain markdown. No selectors, so it cannot drift the way an extractor does.',
  },
  {
    n: '03',
    title: 'Decide',
    sub: 'Reconciliation',
    copy: 'Sensors disagree and the extractor broke. They agree on a new value and the world changed, so the collector is left alone.',
  },
  {
    n: '04',
    title: 'Prove',
    sub: 'Gated Replay',
    copy: 'Self-Healing proposes a repair. It is replayed against the page that failed and the pages that worked, before anything ships.',
  },
];

const FAQS = [
  {
    q: 'Why is valid JSON not enough?',
    tag: 'detection',
    a: 'A layout change can move a price selector onto a refundable deposit. The output stays schema-valid, the request still succeeds, and nothing raises an error. The wrong fact is the only symptom.',
  },
  {
    q: 'How do you know the site changed rather than the scraper breaking?',
    tag: 'the rule',
    a: 'Two Bright Data sensors read the same page. The collector uses selectors; Web Unlocker returns markdown with none. If both report the same new value, extraction still works and the source moved. If they disagree, the extractor drifted.',
  },
  {
    q: 'Does this replace Bright Data Self-Healing?',
    tag: 'scope',
    a: 'No. Scraper Studio builds and repairs the collector. Their own product manager has said repair is triggered by you and there is no automated detection yet. NOTICE is the part that notices, and the part that checks the repair actually worked.',
  },
  {
    q: 'What reaches my application?',
    tag: 'output',
    a: 'A value two sensors agree on now, the last verified value clearly marked stale, or nothing at all with a reason. A quarantined field is withheld rather than flagged, so nothing downstream can act on it by accident.',
  },
  {
    q: 'Can it approve its own repairs?',
    tag: 'safety',
    a: 'Only a candidate that fixes the incident and preserves every pinned regression case can be promoted, and never twice. On a real collector this month an approval returned HTTP 200 and reported success while production still served the old template, because the approve call needs auto_save and it defaults to false. Our mistake, caught by re-checking production instead of trusting the flag. That is why promotion is verified afterwards.',
  },
];

export default async function HomePage() {
  let collectors: CollectorSummary[] = [];
  let incidents: Incident[] = [];
  let offline = false;

  try {
    [collectors, incidents] = await Promise.all([api.listCollectors(), api.listIncidents()]);
  } catch {
    offline = true;
  }

  const open = incidents.filter((incident) => incident.resolvedAt === null && incident.quarantined);

  const fixtureCollector = collectors.find((collector) =>
    collector.targetDomain.includes('driftmart'),
  );

  // Counted, never floored. An earlier version used Math.max(length, 3), which
  // reported three live collectors against a fleet of two — a rounded-up number
  // on a page whose whole argument is that a plausible number can be wrong.
  //
  // Pages matter more than collectors here: one collector can watch many URLs,
  // and the cost, the budget guard and the reason any of this is needed all
  // scale with pages rather than with collectors.
  const pagesWatched = collectors.reduce(
    (total, collector) => total + collector.watchUrls.length,
    0,
  );

  return (
    <div className="min-h-screen bg-white text-gray-900 font-mono">
      <main className="max-w-[1400px] mx-auto px-6">
        {/* Exact Parse.bot Hero Section --------------------------------- */}
        <section className="pt-10 pb-7">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-center">
            <div className="min-w-0">
              <h1 className="font-mondwest font-normal leading-[0.92] tracking-tight text-neutral-900 text-[48px] sm:text-[68px] lg:text-[88px] max-w-[1100px]">
                Trust the data, not the green check
              </h1>

              <p className="mt-5 font-mono text-[14.5px] sm:text-[16px] leading-relaxed text-gray-600 max-w-[660px]">
                {offline ? (
                  <span className="tabular-nums text-gray-900 font-semibold">Scraper Studio collectors</span>
                ) : (
                  <span className="tabular-nums text-gray-900 font-semibold">
                    {collectors.length} live collector{collectors.length === 1 ? '' : 's'},{' '}
                    {pagesWatched} page{pagesWatched === 1 ? '' : 's'}
                  </span>
                )}{' '}
                held against{' '}
                <span className="text-gray-900 font-semibold">2 independent sensors</span>, catching silent scraper drift before it reaches your application.
              </p>

              <div className="mt-7 flex items-center gap-3 flex-wrap">
                <Link
                  href="#control-room"
                  className="font-neuebit text-[14px] font-semibold uppercase tracking-[0.1em] px-6 py-3 bg-black text-white rounded-md hover:bg-gray-800 transition-colors inline-flex items-center gap-1.5"
                >
                  OPEN THE CONTROL ROOM →
                </Link>
                <Link
                  href="/verified"
                  className="font-neuebit text-[14px] uppercase tracking-[0.1em] px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:border-gray-400 hover:bg-gray-50 transition-colors"
                >
                  BROWSE THE FEED
                </Link>
              </div>

              <div className="mt-6">
                <BrightDataBadge text="Built for Into the Scrape-Verse with Bright Data" />
              </div>
            </div>

            {/* Globe Visual Canvas */}
            <div className="hidden lg:flex items-center justify-center flex-shrink-0 -my-6">
              <div className="relative select-none" style={{ width: '480px' }}>
                <Globe markers={globeMarkers(collectors)} />
                <div className="mt-1 flex items-center justify-center gap-2 font-mono text-[10.5px] text-gray-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-parse-accent opacity-60 animate-ping" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-parse-accent" />
                  </span>
                  <span>DRAG GLOBE TO ROTATE</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Search Engine & Infinite Marquee Slider ------------------------- */}
        <section className="mb-14">
          <SearchAndCollectorCarousel />
        </section>

        {/* Comparison Section (Automated Playing Animation) --------------- */}
        <section id="problem" className="mt-14 pt-12 border-t border-gray-200 scroll-mt-16">
          <div className="max-w-[760px] mb-8">
            <div className="font-neuebit text-[12px] uppercase tracking-[0.2em] text-gray-400 mb-2">✦ PROBLEM &amp; SOLUTION</div>
            <h2 className="font-mondwest text-[36px] sm:text-[48px] leading-[1.0] tracking-tight mb-3">
              The silent failure of web scraping.
            </h2>
            <p className="text-[14px] text-gray-600 leading-relaxed font-mono">
              Status codes, schemas and null checks all answer the same question: did the request
              work. Every one of them <span className="text-gray-900 font-semibold">passes a price that is wrong by a factor of ten</span>, because none of
              them ever learns what the value was supposed to be. NOTICE holds a selector-bound
              collector against an independent selector-free markdown witness, and{' '}
              <span className="text-gray-900 font-semibold font-mono">withholds the field rather than guessing</span>.
            </p>
          </div>

          <ComparisonAnimation />
        </section>

        {/* Section: "✦ Build anything / How it works" (Matching Parse.bot 3-step grid) */}
        <section id="system" className="mt-14 pt-12 border-t border-gray-200 scroll-mt-16">
          <div className="mb-9 max-w-[660px]">
            <div className="font-neuebit text-[12px] uppercase tracking-[0.2em] text-gray-400 mb-3">
              ✦ How it works
            </div>
            <h2 className="font-mondwest text-[clamp(30px,4.4vw,48px)] leading-[1.0] tracking-tight mb-3">
              Two sensors. One rule.<br className="hidden sm:block"/> Nothing published on a guess.
            </h2>
            <p className="text-[14px] text-gray-600 leading-relaxed max-w-[560px]">
              Scraper Studio repairs extraction against the plain-language field description. NOTICE holds that collector against an independent Web Unlocker witness.
            </p>
          </div>

          <div className="grid lg:grid-cols-[1.05fr_1fr] gap-7 lg:gap-10 items-stretch">
            <AutoTypeTerminal />

            <div className="flex flex-col gap-5 min-w-0">
              <div className="border border-gray-200 rounded-2xl bg-white p-5 sm:p-6">
                <div className="flex items-baseline gap-2.5 mb-3.5">
                  <span className="font-neuebit text-[11px] uppercase tracking-[0.14em] px-1.5 py-0.5 border border-parse-accent text-parse-accent">ACT</span>
                  <span className="text-[11.5px] text-gray-500 leading-snug">Evidence-backed healing loop</span>
                </div>
                <div className="space-y-2.5 font-mono text-[12px]">
                  <div className="text-gray-800 font-semibold">1. Detect extractor drift</div>
                  <div className="text-gray-800 font-semibold">2. Trigger refactor_template API</div>
                  <div className="text-gray-800 font-semibold">3. Gate candidate against regression corpus</div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-2xl bg-white p-5 sm:p-6">
                <div className="flex items-baseline gap-2.5 mb-3.5">
                  <span className="font-neuebit text-[11px] uppercase tracking-[0.14em] px-1.5 py-0.5 border border-gray-300 text-gray-500">READ</span>
                  <span className="text-[11.5px] text-gray-500 leading-snug">Verified feeds for production</span>
                </div>
                <div className="space-y-2.5 font-mono text-[12px]">
                  {/* Both are real surfaces. The REST route is the one the
                      backend actually registers, not the dashboard page that
                      happens to live at /verified. */}
                  <div className="text-gray-800 font-semibold">GET /api/feed/:id : Value, health, staleness</div>
                  <div className="text-gray-800 font-semibold">MCP get_verified_web_data : Answer or refusal</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section: "✦ Reliability / Sequential Green Steps" ------------ */}
        {/* Anchored because the nav links here. The redesign dropped the
            standalone deploy-gate and agents sections, so this one carries the
            automation story and the gate that guards it. */}
        <section id="automation" className="mt-14 scroll-mt-16">
          <SequentialGreenCards />
        </section>

        {/* Gap Matrix Section (High-End Card Comparison) ---------------- */}
        <section id="gap" className="mt-14 pt-12 border-t border-gray-200 scroll-mt-16">
          <div className="mb-8 max-w-[760px]">
            <div className="font-neuebit text-[12px] uppercase tracking-[0.2em] text-gray-400 mb-2">✦ WHY NOTHING CAUGHT IT</div>
            <h2 className="font-mondwest font-normal not-italic text-[36px] sm:text-[48px] leading-[1.0] tracking-tight mb-3">
              Every console in the account was green.
            </h2>
            <p className="font-mono text-[13.5px] text-gray-600 leading-relaxed">
              Standard scrapers only observe transport mechanics like HTTP status and bytes transferred. NOTICE holds extractor output against an independent markdown witness to eliminate semantic blindspots.
            </p>
          </div>

          <BlindspotsMatrix />
        </section>

        {/* Fault Console (Live Interactive Component) ------------------- */}
        <section id="control-room" className="mt-14 pt-12 border-t border-gray-200 scroll-mt-16">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-neuebit text-[12px] uppercase tracking-[0.2em] text-gray-400 mb-2">✦ LIVE CONTROL ROOM</div>
              <h2 className="font-mondwest text-[36px] sm:text-[48px] leading-[1.0] tracking-tight">Break it yourself &amp; watch NOTICE catch it.</h2>
            </div>
            <RegisterCollector />
          </div>

          <LiveConsole
            collectorId={fixtureCollector?.brightDataCollectorId ?? 'c_msvllpds1n1dcoz8qx'}
            fixtureUrl={fixtureCollector?.targetDomain ? `https://${fixtureCollector.targetDomain}` : 'https://driftmart-3ut8.onrender.com'}
          />

          <div className="mt-6">
            <OperationsPanel />
          </div>
        </section>

        {/* FAQ Section ---------------------------------------------------- */}
        <section id="faq" className="mt-14 pt-12 border-t border-gray-200 mb-16 scroll-mt-16">
          <div className="font-neuebit text-[12px] uppercase tracking-[0.2em] text-gray-400 mb-2">✦ ANSWERS</div>
          <h2 className="font-mondwest text-[36px] sm:text-[48px] leading-[1.0] tracking-tight mb-8">FAQ</h2>

          <div className="space-y-3 font-mono">
            {FAQS.map((faq, index) => (
              <details key={faq.q} className="border border-gray-200 rounded-lg p-4 bg-white group">
                <summary className="flex cursor-pointer items-center justify-between text-[15px] font-semibold text-gray-900">
                  <span className="flex items-center gap-3">
                    <span className="font-mondwest text-xl text-parse-accent">{String(index + 1).padStart(2, '0')}</span>
                    {faq.q}
                  </span>
                  <span className="font-neuebit text-[11px] uppercase tracking-[0.1em] px-2 py-0.5 bg-gray-100 rounded text-gray-500">{faq.tag}</span>
                </summary>
                <p className="mt-3 text-[13px] text-gray-600 leading-relaxed pl-8 border-t border-gray-100 pt-3">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function globeMarkers(
  collectors: CollectorSummary[],
): { lat: number; lon: number; label: string; ok: boolean }[] {
  const sources =
    collectors.length > 0
      ? collectors.map((collector) => ({
          label: collector.targetDomain,
          ok: collector.openIncidents === 0,
        }))
      : [
          { label: 'books.toscrape.com', ok: true },
          { label: 'driftmart', ok: true },
          { label: 'scraper studio', ok: true },
        ];

  return sources.slice(0, 4).map((source, index) => ({
    lat: 34 - index * 27,
    lon: index * 95,
    label: source.ok ? `${source.label} verified` : `${source.label} withheld`,
    ok: source.ok,
  }));
}
