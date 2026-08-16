import Link from 'next/link';
import {
  ArrowUpRight,
  CheckCircle,
  Eye,
  Pulse,
  ShieldCheck,
  TerminalWindow,
  WarningOctagon,
  Wrench,
} from '@phosphor-icons/react/dist/ssr';
import { StatusChip } from '@/components/StatusChip';
import { ProofLedger } from '@/components/ProofLedger';
import { WordReveal } from '@/components/WordReveal';
import { VerificationDiagram } from '@/components/VerificationDiagram';
import { api } from '@/lib/api';
import type { CollectorSummary, Incident } from '@/lib/types';

export const dynamic = 'force-dynamic';

const benefits = [
  {
    number: '01',
    icon: Eye,
    title: 'Catch believable wrong data',
    copy: 'NOTICE catches the result that looks valid, passes the schema, and quietly reports the wrong fact.',
  },
  {
    number: '02',
    icon: Pulse,
    title: 'Know when to leave it alone',
    copy: 'When the collector and witness agree on a new value, NOTICE records a real source change and does not heal.',
  },
  {
    number: '03',
    icon: ShieldCheck,
    title: 'Make every repair earn trust',
    copy: 'A proposed fix runs against the incident and regression pages before production can change.',
  },
];

const steps = [
  {
    icon: TerminalWindow,
    label: 'Observe',
    copy: 'Scraper Studio returns structured data. Contracts look for missing, unusual, or impossible values.',
  },
  {
    icon: Eye,
    label: 'Decide',
    copy: 'Bright Data Markdown reads the page without the collector selectors. Agreement means the world changed. Disagreement means drift.',
  },
  {
    icon: Wrench,
    label: 'Prove',
    copy: 'Self Healing proposes a repair. NOTICE replays it, blocks regressions, and verifies production again.',
  },
];

const faqs = [
  {
    question: 'Why is valid JSON not enough?',
    answer: 'A selector can move from a product price to a nearby deposit while the output shape stays perfectly valid. The pipeline sees success while the business receives the wrong fact.',
  },
  {
    question: 'How does NOTICE know the site changed?',
    answer: 'It compares the structured collector result with a separate Bright Data Markdown reading. If both report the same new value, extraction still works and the source itself changed.',
  },
  {
    question: 'Does NOTICE replace Bright Data Self Healing?',
    answer: 'No. Scraper Studio creates and repairs the collector. NOTICE decides when repair is justified and verifies the candidate before approval.',
  },
  {
    question: 'Can it approve every repair automatically?',
    answer: 'Only a candidate that fixes the incident and preserves every pinned regression case can reach approval. Missing evidence remains a blocked decision.',
  },
  {
    question: 'What reaches downstream applications?',
    answer: 'Only verified current data or the last known good value with an explicit stale warning. Suspect rows remain quarantined.',
  },
  {
    question: 'Is DriftMart a real shop?',
    answer: 'No. DriftMart is a clearly labelled fault injection fixture used to reproduce page changes safely. NOTICE also preserves evidence from real public targets.',
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
  const verified = Math.max(collectors.length - new Set(open.map((incident) => incident.collectorId)).size, 0);
  const verifiedRate = collectors.length === 0 ? 0 : Math.round((verified / collectors.length) * 100);

  return (
    <div className="overflow-hidden">
      <section className="border-b border-surface-border bg-surface pt-20">
        <div className="section-index mx-auto max-w-7xl"><span>INTRODUCTION</span><span>[ 00 / 05 ]</span></div>
        <div className="mx-auto grid min-h-[760px] max-w-7xl items-center gap-16 px-6 py-20 lg:grid-cols-[0.88fr_1.12fr] lg:px-8">
          <div>
            <p className="eyebrow hero-kicker mb-6"><span className="signal-square" /> The verification layer for live web data</p>
            <h1 className="display-heading">
              <span className="hero-line"><span>Trust the data.</span></span>
              <span className="hero-line text-ember"><span>Not the</span></span>
              <span className="hero-line text-ember"><span>green check.</span></span>
            </h1>
            <p className="hero-copy mt-8 max-w-[620px] text-lg text-muted">
              NOTICE catches Scraper Studio collectors that return believable but wrong data, decides whether the site changed or the extractor broke, and proves every repair before production.
            </p>
            <div className="hero-action mt-10 flex flex-wrap gap-3">
              <a href="#control-room" className="primary-button">
                Open live control room <ArrowUpRight size={18} weight="bold" />
              </a>
              <a href="#proof" className="secondary-button">See the proof</a>
            </div>
            <div className="hero-proof mt-16 grid grid-cols-3 border border-x-0 border-b-0 border-surface-border pt-6">
              <Proof label="Bright Data" value="2 live signals" />
              {/* Keep in step with `npm test`. A number on the landing page
                  that no longer matches the suite is the one claim a reader
                  can check in ten seconds. */}
              <Proof label="Safety suite" value="127 tests passing" />
              <Proof label="Default policy" value="Read only until proven" />
            </div>
          </div>
          <div className="hero-visual" data-reveal="scale"><VerificationDiagram /></div>
        </div>
      </section>

      <section id="story" data-chapter="story" className="border-b border-surface-border bg-surface-raised px-6 py-24 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div data-reveal="left">
              <p className="eyebrow">The failure nobody sees</p>
              <h2 className="mt-6 max-w-xl text-4xl font-medium tracking-tight md:text-5xl">
                The request succeeded. The fact did not.
              </h2>
            </div>
            <p data-reveal="right" className="max-w-2xl text-lg text-muted">
              A layout change can make a price selector capture a deposit, an old list price, or zero in the wrong currency. The JSON still looks clean. No exception fires. The bad decision happens later.
            </p>
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-2">
            <article data-reveal="left" data-delay="1" className="panel overflow-hidden border-blocked/30">
              <div className="flex items-center justify-between border border-x-0 border-t-0 border-surface-border px-6 py-4">
                <span className="eyebrow text-blocked">Unguarded pipeline</span>
                <WarningOctagon size={20} className="text-blocked" />
              </div>
              <div className="p-8">
                <p className="text-sm text-muted">Structured output</p>
                <div className="mt-6 font-mono text-sm text-ivory/75">
                  <p>{'{'}</p>
                  <p className="pl-6">&quot;status&quot;: &quot;success&quot;,</p>
                  <p className="pl-6 text-blocked">&quot;price&quot;: 25.00,</p>
                  <p className="pl-6">&quot;currency&quot;: &quot;USD&quot;</p>
                  <p>{'}'}</p>
                </div>
                <p className="mt-8 text-sm text-blocked">The selector captured the refundable deposit.</p>
              </div>
            </article>

            <article data-reveal="right" data-delay="2" className="panel overflow-hidden border-verified/30">
              <div className="flex items-center justify-between border border-x-0 border-t-0 border-surface-border px-6 py-4">
                <span className="eyebrow text-verified">NOTICE verified</span>
                <ShieldCheck size={20} className="text-verified" />
              </div>
              <div className="p-8">
                <p className="text-sm text-muted">Independent witness</p>
                <div className="mt-6 font-mono text-sm text-ivory/75">
                  <p>Purchase price</p>
                  <p className="mt-2 text-3xl text-verified">$249</p>
                  <p className="mt-4 text-muted">labelled line, 93% confidence</p>
                </div>
                <p className="mt-8 text-sm text-verified">The corrupt row is quarantined before it reaches the buyer.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="principle" data-chapter="principle" className="bg-surface px-6 py-28 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p data-reveal className="eyebrow mb-10">One rule changes everything</p>
          <WordReveal text="When the signals agree, the world changed. When they disagree, the extractor broke." />
        </div>
      </section>

      <section className="border border-x-0 border-surface-border bg-surface-raised px-6 py-24 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="max-w-[680px]">
            <p className="eyebrow">Why teams need NOTICE</p>
            <h2 className="mt-6 text-4xl font-medium tracking-tight md:text-5xl">
              Reliability means knowing what not to repair.
            </h2>
          </div>
          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {benefits.map((benefit) => {
              const Icon = benefit.icon;
              return (
              <article key={benefit.number} data-reveal="scale" data-delay={String(Number(benefit.number))} className="panel panel-hover p-8">
                  <div className="flex items-center justify-between">
                    <Icon size={28} weight="light" />
                    <span className="font-mono text-xs text-muted">{benefit.number}</span>
                  </div>
                  <h3 className="mt-12 text-2xl font-medium">{benefit.title}</h3>
                  <p className="mt-4 text-sm text-muted">{benefit.copy}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="system" data-chapter="system" className="border-b border-surface-border bg-surface-raised px-6 py-24 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr]">
            <div data-reveal="left">
              <p className="eyebrow">The system</p>
              <h2 className="mt-6 text-4xl font-medium tracking-tight md:text-5xl">Two signals. One defensible decision.</h2>
              <p className="mt-6 text-base text-muted">Scraper Studio does the extraction. Bright Data Markdown supplies evidence. NOTICE decides what the evidence means.</p>
            </div>
            <ol className="space-y-4">
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.label} data-reveal="right" data-delay={String(index + 1)} className="panel panel-hover grid gap-6 p-6 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                    <span className="grid h-12 w-12 place-items-center bg-coralSoft text-ember">
                      <Icon size={24} weight="bold" />
                    </span>
                    <div>
                      <h3 className="text-xl font-medium">{step.label}</h3>
                      <p className="mt-2 text-sm text-muted">{step.copy}</p>
                    </div>
                    <span className="font-mono text-xs text-muted">0{String(index + 1)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      <section id="proof" data-chapter="proof" className="border border-x-0 border-surface-border bg-surface-raised px-6 py-24 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="grid gap-8 lg:grid-cols-[1fr_0.72fr] lg:items-end">
            <div>
              <p className="eyebrow">Verification benchmark <span className="text-ivory">[04/05]</span></p>
              <h2 className="mt-6 max-w-3xl text-4xl font-medium tracking-tight md:text-6xl">
                The same scrape. A more defensible decision.
              </h2>
            </div>
            <p className="max-w-xl text-base leading-7 text-muted">
              Four cases from the failure model behind NOTICE. Choose one to see how two Bright Data signals become a verdict a downstream system can trust.
            </p>
          </div>
          <div data-reveal="scale" data-delay="1" className="mt-12"><ProofLedger /></div>
        </div>
      </section>

      <section id="control-room" data-chapter="control-room" className="bg-surface px-6 py-24 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-[680px]">
              <p className="eyebrow">Live control room</p>
              <h2 className="mt-6 text-4xl font-medium tracking-tight md:text-5xl">Every claim comes with a receipt.</h2>
            </div>
            <Link href="/verified" className="secondary-button">
              See verified deals <ArrowUpRight size={18} />
            </Link>
          </div>

          <div data-reveal="scale" data-delay="1" className="mt-12 grid gap-4 sm:grid-cols-3">
            <Metric label="Verified fleet" value={offline ? 'Offline' : `${String(verifiedRate)}%`} detail={`${String(verified)} of ${String(collectors.length)} collectors`} />
            <Metric label="Quarantined incidents" value={offline ? ', ' : String(open.length)} detail="Bad rows held back" />
            <Metric label="Decision engine" value="6 states" detail="Including inconclusive" />
          </div>

          <div data-reveal data-delay="2" className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <section className="panel p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Collector fleet</h3>
                <span className={`status-chip ${offline ? 'border-suspect/40 text-suspect' : 'border-verified/40 text-verified'}`}>
                  <span className={`h-2 w-2 rounded-full ${offline ? 'bg-suspect' : 'bg-verified'}`} aria-hidden />
                  {offline ? 'Backend offline' : 'Live'}
                </span>
              </div>
              <div className="mt-6 space-y-3">
                {offline ? (
                  <EmptyState title="Control room is waiting" copy="Start the NOTICE backend to connect the live collector fleet. The product story remains available while data is offline." />
                ) : collectors.length === 0 ? (
                  <EmptyState title="No collectors yet" copy="Register a Scraper Studio collector to begin learning its verified baseline." />
                ) : (
                  collectors.slice(0, 5).map((collector) => (
                    <Link
                      key={collector.id}
                      href={`/collectors/${collector.id}`}
                      className="block border border-surface-border bg-surface-soft p-4 transition-colors duration-500 hover:border-muted"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{collector.name}</p>
                          <p className="mt-1 font-mono text-xs text-muted">{collector.targetDomain}</p>
                          {/* Surfaced here because a collector with no accepted
                              baseline has its statistical checks disabled, and
                              that is the single most useful thing to know at a
                              glance about a collector's health. */}
                          <p className="mt-1 text-xs text-muted">
                            {collector.baselineRuns === 0
                              ? 'No baseline accepted yet'
                              : `Baseline: ${String(collector.baselineRuns)} run${collector.baselineRuns === 1 ? '' : 's'}`}
                          </p>
                        </div>
                        <span className={`status-chip ${collector.openIncidents === 0 ? 'border-verified/40 text-verified' : 'border-blocked/40 text-blocked'}`}>
                          {collector.openIncidents === 0 ? 'Verified' : `${String(collector.openIncidents)} open`}
                        </span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </section>

            <section className="panel p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Recent evidence</h3>
                <span className="font-mono text-xs text-muted">Newest first</span>
              </div>
              <div className="mt-6 space-y-3">
                {incidents.length === 0 ? (
                  <EmptyState title="No incidents recorded" copy="When a contract trips, NOTICE will place the witness, decision, repair prompt, and gate result here." />
                ) : (
                  incidents.slice(0, 5).map((incident) => (
                    <Link key={incident.id} href={`/incidents/${incident.id}`} className="panel-hover block border border-surface-border bg-surface-soft p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <StatusChip classification={incident.classification} />
                        <time className="font-mono text-xs text-muted" dateTime={incident.createdAt}>
                          {new Date(incident.createdAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
                        </time>
                      </div>
                      <p className="mt-3 truncate text-sm text-muted">{incident.witness?.url ?? 'No target URL recorded'}</p>
                    </Link>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </section>

      <section className="border border-x-0 border-surface-border bg-ember px-6 py-24 text-surface-raised lg:px-8">
        <div data-reveal className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-[680px]">
            <p className="eyebrow !text-surface-raised/70">The consequence</p>
            <h2 className="mt-6 text-4xl font-medium tracking-tight md:text-6xl">A cheap deposit should never become the best deal.</h2>
            <p className="mt-6 text-lg text-surface-raised/80">See the same recommendation answered from raw collector rows and from the NOTICE verified feed.</p>
          </div>
          <Link href="/verified" className="secondary-button !border-surface-raised !bg-surface-raised !text-ivory">
            Compare the decisions <ArrowUpRight size={18} />
          </Link>
        </div>
      </section>

      <section className="bg-surface px-6 py-24 lg:px-8">
        <div data-reveal className="mx-auto max-w-5xl">
          <div className="max-w-[680px]">
            <p className="eyebrow">Questions worth asking</p>
            <h2 className="mt-6 text-4xl font-medium tracking-tight md:text-5xl">Trust should survive scrutiny.</h2>
          </div>
          <div className="mt-12 divide-y divide-surface-border border border-x-0 border-surface-border">
            {faqs.map((faq) => (
              <details key={faq.question} className="group py-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-medium">
                  {faq.question}
                  <span className="text-muted transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-4 max-w-3xl text-sm text-muted">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-surface-border bg-surface-raised px-6 py-24 lg:px-8">
        <div data-reveal="scale" className="mx-auto flex max-w-5xl flex-col items-center text-center">
          <CheckCircle size={32} weight="fill" className="text-verified" />
          <h2 className="mt-8 max-w-[680px] text-4xl font-medium tracking-tight md:text-6xl">Do not automate trust. Prove it.</h2>
          <p className="mt-6 max-w-xl text-base text-muted">Read only by default. No repair ships without incident evidence and regression proof.</p>
          <a href="#control-room" className="primary-button mt-8">Open live control room <ArrowUpRight size={18} /></a>
        </div>
      </section>
    </div>
  );
}

function Proof({ label, value }: { label: string; value: string }) {
  return <div className="pr-4"><p className="font-mono text-xs font-semibold text-ivory">{value}</p><p className="mt-1 text-xs text-muted">{label}</p></div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="panel p-6"><p className="eyebrow">{label}</p><p className="mt-8 font-mono text-3xl">{value}</p><p className="mt-2 text-xs text-muted">{detail}</p></article>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="border border-surface-border bg-surface-soft p-6"><p className="text-sm font-medium">{title}</p><p className="mt-2 text-xs text-muted">{copy}</p></div>;
}
