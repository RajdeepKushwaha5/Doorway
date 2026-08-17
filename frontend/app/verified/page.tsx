import Link from 'next/link';
import { ArrowLeft, ArrowRight, Eye, ShieldCheck, WarningOctagon } from '@phosphor-icons/react/dist/ssr';
import { api } from '@/lib/api';
import type { DealComparison } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function VerifiedConsumerPage() {
  let comparison: DealComparison | null = null;
  try {
    comparison = await api.bestDeal();
  } catch {
    comparison = null;
  }

  const activeComparison: DealComparison = comparison ?? {
    diverged: true,
    explanation: [
      'DriftMart collector output drifted from $249.00 to $25.00 deposit due to a DOM redesign.',
      'NOTICE dual-sensor rejected the candidate and served the verified safe recommendation.',
    ],
    unguarded: {
      pick: {
        collectorId: 'c_driftmart_headphones',
        collectorName: 'DriftMart headphones',
        title: 'Nova Headphones',
        price: 25,
        currency: 'USD',
        url: 'https://driftmart-3ut8.onrender.com/product/headphones',
      },
      considered: [
        {
          collectorId: 'c_driftmart_headphones',
          collectorName: 'DriftMart headphones',
          title: 'Nova Headphones',
          price: 25,
          currency: 'USD',
          url: 'https://driftmart-3ut8.onrender.com/product/headphones',
        },
        {
          collectorId: 'c_books_toscrape',
          collectorName: 'Books to Scrape',
          title: 'A Light in the Attic',
          price: 51.77,
          currency: 'GBP',
          url: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
        },
      ],
    },
    verified: {
      pick: {
        collectorId: 'c_books_toscrape',
        collectorName: 'Books to Scrape',
        title: 'A Light in the Attic',
        price: 51.77,
        currency: 'GBP',
        url: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
        health: 'healthy',
        stale: false,
      },
      considered: [
        {
          collectorId: 'c_driftmart_headphones',
          collectorName: 'DriftMart headphones',
          title: 'Nova Headphones',
          price: null,
          currency: 'USD',
          url: 'https://driftmart-3ut8.onrender.com/product/headphones',
          health: 'quarantined',
          stale: true,
        },
        {
          collectorId: 'c_books_toscrape',
          collectorName: 'Books to Scrape',
          title: 'A Light in the Attic',
          price: 51.77,
          currency: 'GBP',
          url: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
          health: 'healthy',
          stale: false,
        },
      ],
    },
  };

  const { unguarded, verified, diverged, explanation } = activeComparison;
  return (
    <div className="bg-surface pt-10">
      <div className="section-index mx-auto max-w-7xl"><span>VERIFIED DECISIONS</span><span>[ 01 / 03 ]</span></div>
      <div className="mx-auto max-w-7xl px-6 pb-24 pt-10 lg:px-8">
        <Link href="/#control-room" className="footer-link inline-flex items-center gap-2 text-sm"><ArrowLeft size={16} /> Control room</Link>

        <header data-reveal className="verified-hero mt-8">
          <div>
            <p className="eyebrow"><span className="signal-square" /> Downstream consequence</p>
            <h1 className="mt-4 max-w-3xl font-mondwest font-normal not-italic text-4xl sm:text-5xl lg:text-6xl leading-[1.0] text-gray-900 tracking-tight">The cheapest answer can be the most expensive mistake.</h1>
          </div>
          <div className="verified-hero__aside">
            <p>Both pipelines see the same collectors. Only one requires evidence before it recommends a deal.</p>
            <div><span>QUESTION</span><strong>Which product is actually the best deal?</strong></div>
          </div>
        </header>

        <section data-reveal data-delay="1" className={`decision-banner ${diverged ? 'is-diverged' : ''}`}>
          <div className="decision-banner__icon">
            {diverged ? <WarningOctagon size={26} weight="fill" /> : <ShieldCheck size={26} weight="fill" />}
          </div>
          <div>
            <p>{diverged ? 'THE ANSWERS DISAGREE' : 'THE ANSWERS AGREE'}</p>
            <div>
              {diverged ? explanation.map((line) => <p key={line}>{line}</p>) : <p>Every collector is verified, so guarded and unguarded pipelines reach the same conclusion. NOTICE makes the normal case provable too.</p>}
            </div>
          </div>
          <span>{diverged ? 'ACTION REQUIRED' : 'EVIDENCE ALIGNED'}</span>
        </section>

        <div data-reveal="scale" data-delay="2" className="mt-8 grid lg:grid-cols-2">
          <DealPanel index="01" heading="Unguarded pipeline" caption="Takes the latest row at face value." tone="risk" pick={unguarded.pick} />
          <DealPanel index="02" heading="NOTICE verified feed" caption="Serves only values backed by current evidence." tone="safe" pick={verified.pick} />
        </div>

        <div className="verified-flow" data-reveal>
          <div><Eye size={22} /><span>Same collector rows</span></div><ArrowRight size={20} />
          <div><ShieldCheck size={22} /><span>Independent evidence</span></div><ArrowRight size={20} />
          <div><span className="signal-square" /><span>Defensible decision</span></div>
        </div>

        <section data-reveal data-delay="3" className="mt-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="eyebrow">Decision ledger</p><h2 className="mt-3 text-3xl font-medium tracking-tight text-ivory">Everything each pipeline considered</h2></div>
          <p className="max-w-md text-sm leading-6 text-muted">Withheld is an honest answer. It is safer than turning a broken scrape into a confident recommendation.</p>
        </div>
        <div className="mt-8 overflow-x-auto border border-surface-border bg-surface-raised">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Candidates seen by each pipeline</caption>
            <thead className="border-b border-surface-border bg-surface-soft font-mono text-xs uppercase tracking-[0.16em] text-muted">
              <tr><th scope="col" className="px-6 py-4 font-medium">Item</th><th scope="col" className="px-6 py-4 font-medium">Unguarded</th><th scope="col" className="px-6 py-4 font-medium">Verified</th><th scope="col" className="px-6 py-4 font-medium">Health</th></tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {unguarded.considered.map((raw) => {
                const safe = verified.considered.find((candidate) => candidate.url === raw.url);
                const differs = safe?.price !== raw.price;
                return (
                  <tr key={raw.url} className="transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-surface-soft">
                    <td className="px-6 py-4"><span className="text-ivory">{raw.title ?? raw.collectorName}</span><span className="mt-1 block break-all font-mono text-xs text-muted">{raw.url}</span></td>
                    <td className={`px-6 py-4 font-mono text-xs ${differs ? 'text-blocked' : 'text-muted'}`}>{formatPrice(raw.price, raw.currency)}</td>
                    <td className="px-6 py-4 font-mono text-xs text-ivory">{safe?.price === undefined || safe.price === null ? 'withheld' : formatPrice(safe.price, safe.currency)}</td>
                    <td className="px-6 py-4"><span className="status-chip border-surface-border bg-surface-soft text-muted">{safe?.health ?? 'unavailable'}{safe?.stale === true ? ', stale' : ''}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </section>
      </div>
    </div>
  );
}

function DealPanel({ index, heading, caption, tone, pick }: { index: string; heading: string; caption: string; tone: 'risk' | 'safe'; pick: DealComparison['unguarded']['pick'] }) {
  const safe = tone === 'safe';
  return (
    <section className={`deal-panel ${safe ? 'is-safe' : 'is-risk'}`}>
      <div className="deal-panel__bar"><span>{index} / {safe ? 'VERIFIED' : 'RAW'}</span><span>{safe ? 'PROOF GATED' : 'NO GATE'}</span></div>
      <div className="flex items-center justify-between gap-4">
        <span className="deal-panel__icon">{safe ? <ShieldCheck size={24} weight="duotone" /> : <WarningOctagon size={24} weight="duotone" />}</span>
        <span className="font-mono text-xs">{safe ? 'TRUSTED' : 'SUSPECT'}</span>
      </div>
      <p className="eyebrow mt-8">{heading}</p><p className="mt-3 text-sm text-muted">{caption}</p>
      {pick === null ? <p className="mt-12 max-w-md text-xl leading-8 text-ivory">No recommendation. Nothing can be trusted enough to answer.</p> : (
        <div className="mt-12"><p className="font-mono text-5xl tracking-tight sm:text-6xl">{formatPrice(pick.price, pick.currency)}</p><p className="mt-4 text-base">{pick.title ?? pick.collectorName}</p>{pick.stale === true ? <p className="mt-4 text-sm">Last verified value, clearly marked stale.</p> : null}</div>
      )}
    </section>
  );
}

function formatPrice(price: number | null, currency: string | null | undefined) {
  if (price === null) return 'no price';
  if (currency === null || currency === undefined || currency.length !== 3) return String(price);
  try {
    // The locale controls digit grouping only. en-IN groups as 2,49,000, which
    // reads as a typo next to the dollar amounts the fixture serves. The
    // currency code still comes from the row, so any currency renders right.
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${String(price)} ${currency}`;
  }
}
