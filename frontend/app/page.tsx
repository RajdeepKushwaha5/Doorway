import Link from 'next/link';
import { Globe } from '@/components/Globe';
import { RegisterCollector } from '@/components/RegisterCollector';
import { OperationsPanel } from '@/components/OperationsPanel';
import { api } from '@/lib/api';
import type { CollectorSummary, Incident } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The landing page.
 *
 * Ordered so a reader meets the problem before the product. The first thing
 * after the headline is a wrong number beside a right one, because none of
 * this is easy to care about until you have seen how ordinary a silent
 * corruption looks.
 */

const STEPS = [
  {
    n: '01',
    title: 'Observe',
    copy: 'A Scraper Studio collector returns structured rows. Contracts check them for missing, impossible or unusual values.',
  },
  {
    n: '02',
    title: 'Witness',
    copy: 'Web Unlocker reads the same page as plain markdown. No selectors, so it cannot drift the way an extractor does.',
  },
  {
    n: '03',
    title: 'Decide',
    copy: 'Sensors disagree and the extractor broke. They agree on a new value and the world changed, so the collector is left alone.',
  },
  {
    n: '04',
    title: 'Prove',
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
    a: 'Only a candidate that fixes the incident and preserves every pinned regression case can be promoted, and never twice. On a real collector this month, Bright Data reported a repair as succeeded while production still returned the wrong value. That is why promotion is verified afterwards rather than trusted.',
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

  return (
    <>
      {/* Hero ----------------------------------------------------------- */}
      <section className="border-b border-surface-border">
        <div className="mx-auto grid max-w-[1400px] items-center gap-16 px-6 py-24 lg:grid-cols-[1.05fr_0.95fr] lg:px-10 lg:py-28">
          <div>
            <h1 className="display-heading">
              Trust the data,
              <br />
              not the green check.
            </h1>

            <p className="mt-8 max-w-[52ch] text-[15px] leading-7 text-muted">
              A scraper can break without breaking. NOTICE catches the run that returns
              <span className="text-ivory"> valid JSON and the wrong fact</span>, works out whether
              the website changed or the extractor drifted, and proves any repair before it reaches
              production.
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="#control-room" className="accent-button">
                Open the control room <span aria-hidden>→</span>
              </Link>
              <Link href="#problem" className="secondary-button">
                See the problem
              </Link>
            </div>

            <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 text-[11px] uppercase tracking-eyebrow text-muted">
              <span className="inline-flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${offline ? 'bg-suspect' : 'bg-verified'}`}
                  aria-hidden
                />
                {offline ? 'Backend offline' : `${String(collectors.length)} sources monitored`}
              </span>
              <span>2 independent sensors</span>
              <span>205 tests</span>
              <span>Read only until proven</span>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end" data-reveal="scale">
            <Globe />
          </div>
        </div>

        <FleetMarquee collectors={collectors} offline={offline} />
      </section>

      {/* The problem ---------------------------------------------------- */}
      <section id="problem" className="border-b border-surface-border">
        <div className="mx-auto max-w-[1400px] px-6 py-24 lg:px-10">
          <p className="eyebrow">✦ The failure nobody sees</p>
          <h2 className="section-heading mt-6 max-w-[18ch]">
            The request succeeded. The fact did not.
          </h2>
          <p className="mt-6 max-w-[62ch] text-[15px] leading-7 text-muted">
            A redesign moves a price selector onto a refundable deposit. Status 200, schema valid,
            no exception and nothing in a log. Every dashboard, model and agent downstream now
            believes the wrong number.
          </p>

          <div className="mt-14 grid gap-5 lg:grid-cols-2">
            <article className="panel overflow-hidden" data-reveal="left">
              <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
                <span className="eyebrow text-blocked">Unguarded pipeline</span>
                <span className="status-chip border-blocked/30 text-blocked">shipped</span>
              </div>
              <div className="p-8">
                <p className="eyebrow">Collector output</p>
                <pre className="mt-5 text-[13px] leading-7 text-muted">
                  {'{\n  "status": "success",\n  "price": '}
                  <span className="text-blocked">25.00</span>
                  {',\n  "currency": "USD"\n}'}
                </pre>
                <p className="mt-8 text-[13px] text-blocked">
                  The selector captured the refundable deposit.
                </p>
              </div>
            </article>

            <article className="panel overflow-hidden" data-reveal="right" data-delay="1">
              <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
                <span className="eyebrow text-verified">NOTICE</span>
                <span className="status-chip border-verified/30 text-verified">withheld</span>
              </div>
              <div className="p-8">
                <p className="eyebrow">Independent witness</p>
                <p className="signal-card__value text-verified">$249</p>
                <p className="mt-3 text-[13px] text-muted">
                  Read from the line <span className="text-ivory">Price: $249</span>, with no
                  selectors involved.
                </p>
                <p className="mt-8 text-[13px] text-verified">
                  The corrupt row is quarantined before it reaches anyone.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* The rule ------------------------------------------------------- */}
      <section id="system" className="border-b border-surface-border bg-surface-raised">
        <div className="mx-auto max-w-[1400px] px-6 py-24 lg:px-10">
          <p className="eyebrow">✦ How it works</p>
          <h2 className="section-heading mt-6 max-w-[20ch]">
            Two sensors. One rule. Nothing published on a guess.
          </h2>

          <div className="mt-14 grid gap-px overflow-hidden rounded-card border border-surface-border bg-surface-border md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <div
                key={step.n}
                className="bg-surface-raised p-7"
                data-reveal
                data-delay={String(Math.min(index, 3))}
              >
                <p className="font-display text-3xl text-muted">{step.n}</p>
                <p className="mt-4 text-[13px] uppercase tracking-eyebrow">{step.title}</p>
                <p className="mt-3 text-[13px] leading-6 text-muted">{step.copy}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div className="panel p-7" data-reveal="left">
              <p className="eyebrow text-blocked">They disagree</p>
              <p className="mt-4 font-display text-3xl">The scraper broke.</p>
              <p className="mt-3 text-[13px] leading-6 text-muted">
                Repair it, with the page that actually failed sent as evidence.
              </p>
            </div>
            <div className="panel p-7" data-reveal="right">
              <p className="eyebrow text-verified">They agree, and the value moved</p>
              <p className="mt-4 font-display text-3xl">The world changed.</p>
              <p className="mt-3 text-[13px] leading-6 text-muted">
                Leave the collector alone. A monitor fires the identical alert for both of these.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Deploy gate ---------------------------------------------------- */}
      <section id="gate" className="border-b border-surface-border bg-ink py-24">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10">
          <p className="eyebrow text-white/50">✦ Reliability</p>
          <h2 className="section-heading mt-6 max-w-[22ch] text-white">
            Stop a deploy that depends on data nobody checked.
          </h2>
          <p className="mt-6 max-w-[62ch] text-[15px] leading-7 text-white/60">
            Your pipeline already refuses to ship on a failing test. It will happily ship a price a
            broken scraper invented last Tuesday, because nothing in it distinguishes data from
            correct data.
          </p>

          <div className="mt-12 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-card border border-white/10 bg-white/[0.03] p-7">
              <p className="eyebrow text-white/45">.github/workflows/deploy.yml</p>
              <pre className="mt-5 overflow-x-auto text-[13px] leading-7 text-white/80">
                {`- uses: prabhatkumar67/notice/actions/verify@main
  with:
    api-base: https://notice-api-0vfo.onrender.com
    collector: c_msvk2zahnc2mizts6`}
              </pre>
              <div className="mt-6 rounded-card border border-white/10 bg-black/40 p-5 text-[13px] leading-7">
                <p className="text-blocked">
                  ::error::DriftMart headphones: unavailable (extractor_drift)
                </p>
                <p className="mt-1 text-white/50">1 of 2 sources are not verified.</p>
                <p className="mt-3 text-white/35">Process exited with code 1</p>
              </div>
            </div>

            <div className="grid gap-px overflow-hidden rounded-card border border-white/10 bg-white/10">
              {[
                ['01 Monitor', 'Every source is observed on a schedule, inside the account free tier.'],
                ['02 Detect', 'A break is caught by two sensors disagreeing, not by an exception.'],
                ['03 Repair', 'Self-Healing is driven with the failing page as evidence.'],
                ['04 Verify', 'The candidate is replayed before promotion, and again afterwards.'],
              ].map(([title, copy]) => (
                <div key={title} className="bg-ink p-6">
                  <p className="text-[12px] uppercase tracking-eyebrow text-verified">{title}</p>
                  <p className="mt-2 text-[13px] leading-6 text-white/55">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Agents --------------------------------------------------------- */}
      <section id="agents" className="border-b border-surface-border">
        <div className="mx-auto grid max-w-[1400px] gap-14 px-6 py-24 lg:grid-cols-2 lg:px-10">
          <div>
            <p className="eyebrow">✦ For agents</p>
            <h2 className="section-heading mt-6 max-w-[18ch]">An answer, or an honest refusal.</h2>
            <p className="mt-6 max-w-[54ch] text-[15px] leading-7 text-muted">
              NOTICE speaks MCP. An agent asking for web data gets a value two sensors currently
              agree on, or a refusal naming the incident. No tool returns a bare number, and a
              quarantined value never enters the context window at all.
            </p>
            <pre className="mt-8 rounded-card border border-surface-border bg-surface-raised p-5 text-[13px] leading-7 text-muted">
              claude mcp add notice -- npm run mcp
            </pre>
          </div>

          <div className="panel p-7" data-reveal="right">
            <p className="eyebrow">What the agent receives</p>
            <pre className="mt-5 overflow-x-auto text-[13px] leading-7">
              <span className="text-blocked">REFUSED.</span>
              <span className="text-muted">
                {` NOTICE will not vouch for this right now.

reason    extractor_drift
fields    price
incident  f421aee0

Do not substitute a guess or scrape
this page directly to work around this.`}
              </span>
            </pre>
          </div>
        </div>
      </section>

      {/* Control room --------------------------------------------------- */}
      <section id="control-room" className="border-b border-surface-border bg-surface-raised">
        <div className="mx-auto max-w-[1400px] px-6 py-24 lg:px-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="eyebrow">✦ Live</p>
              <h2 className="section-heading mt-6">Every claim comes with a receipt.</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {offline || collectors.length === 0 ? null : <RegisterCollector />}
              <Link href="/verified" className="secondary-button">
                Verified feed <span aria-hidden>→</span>
              </Link>
            </div>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <Metric
              label="Sources monitored"
              value={offline ? '—' : String(collectors.length)}
              detail="Real Scraper Studio collectors"
            />
            <Metric
              label="Quarantined"
              value={offline ? '—' : String(open.length)}
              detail="Rows held back from the feed"
            />
            <Metric label="Verdicts" value="6" detail="Including inconclusive" />
          </div>

          {offline || collectors.length === 0 ? null : (
            <div className="mt-5" data-reveal>
              <OperationsPanel />
            </div>
          )}

          <div className="panel mt-5 overflow-hidden" data-reveal>
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <p className="text-[13px] uppercase tracking-eyebrow">Collector fleet</p>
              <span
                className={`status-chip ${
                  offline ? 'border-suspect/30 text-suspect' : 'border-verified/30 text-verified'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${offline ? 'bg-suspect' : 'bg-verified'}`}
                  aria-hidden
                />
                {offline ? 'Backend offline' : 'Live'}
              </span>
            </div>

            <div className="divide-y divide-surface-border">
              {offline ? (
                <Empty
                  title="Control room is waiting"
                  copy="Start the NOTICE backend to connect the fleet. Everything above stays readable while it is offline."
                />
              ) : collectors.length === 0 ? (
                <div className="p-8">
                  <Empty
                    title="No collectors yet"
                    copy="Register a Scraper Studio collector to begin learning its verified baseline."
                  />
                  <div className="mt-6 flex justify-center">
                    <RegisterCollector />
                  </div>
                </div>
              ) : (
                collectors.slice(0, 6).map((collector) => (
                  <Link
                    key={collector.id}
                    href={`/collectors/${collector.id}`}
                    className="flex items-center justify-between gap-4 px-6 py-5 transition-colors hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px]">{collector.name}</p>
                      <p className="mt-1 truncate text-[12px] text-muted">
                        {collector.brightDataCollectorId} · {collector.targetDomain}
                      </p>
                    </div>
                    <span
                      className={`status-chip shrink-0 ${
                        collector.openIncidents === 0
                          ? 'border-verified/30 text-verified'
                          : 'border-blocked/30 text-blocked'
                      }`}
                    >
                      {collector.openIncidents === 0
                        ? 'verified'
                        : `${String(collector.openIncidents)} open`}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ ------------------------------------------------------------ */}
      <section id="faq" className="border-b border-surface-border">
        <div className="mx-auto max-w-[1400px] px-6 py-24 lg:px-10">
          <p className="eyebrow">✦ Answers</p>
          <h2 className="section-heading mt-6">FAQ</h2>

          <div className="mt-12 flex flex-col gap-4">
            {FAQS.map((faq, index) => (
              <details key={faq.q} className="panel px-6 py-5" data-reveal>
                <summary className="flex cursor-pointer list-none items-start gap-5">
                  <span className="font-display text-2xl text-muted">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1 font-display text-xl leading-snug">{faq.q}</span>
                  <span className="eyebrow shrink-0 rounded-full border border-surface-border px-2.5 py-1">
                    {faq.tag}
                  </span>
                </summary>
                <p className="mt-4 max-w-[80ch] pl-12 text-[13px] leading-7 text-muted">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Close ---------------------------------------------------------- */}
      <section className="border-b border-surface-border">
        <div className="mx-auto max-w-[1400px] px-6 py-28 text-center lg:px-10">
          <h2 className="font-display text-5xl leading-[1.05] sm:text-6xl">
            Both times the number changed.
            <br />
            Only one was a broken scraper.
          </h2>
          <p className="mx-auto mt-6 max-w-[52ch] text-[15px] leading-7 text-muted">
            Telling those two apart is the whole project. Everything else is evidence.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href="#control-room" className="accent-button">
              Open the control room <span aria-hidden>→</span>
            </Link>
            <a href="https://github.com/prabhatkumar67/notice" className="secondary-button">
              Read the source
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * The fleet, sliding.
 *
 * Children are duplicated once so the loop lands on an identical frame and
 * never visibly jumps. Falls back to the Bright Data surfaces in use when
 * nothing is registered, which keeps the band meaningful on a cold deployment
 * rather than empty.
 */
function FleetMarquee({
  collectors,
  offline,
}: {
  collectors: CollectorSummary[];
  offline: boolean;
}) {
  const items =
    !offline && collectors.length > 0
      ? collectors.map((collector) => ({
          label: collector.targetDomain,
          detail: collector.brightDataCollectorId,
          ok: collector.openIncidents === 0,
        }))
      : [
          { label: 'Scraper Studio', detail: 'collectors', ok: true },
          { label: 'Web Unlocker', detail: 'markdown witness', ok: true },
          { label: 'Web Unlocker', detail: 'screenshot evidence', ok: true },
          { label: 'Self-Healing', detail: 'refactor_template', ok: true },
          { label: 'Geo targeting', detail: 'comparable sensors', ok: true },
          { label: 'MCP', detail: 'verified data for agents', ok: true },
        ];

  const doubled = [...items, ...items];

  return (
    <div className="border-t border-surface-border py-5">
      <div className="marquee">
        <div className="marquee__track">
          {doubled.map((item, index) => (
            <div
              key={`${item.label}-${String(index)}`}
              className="flex shrink-0 items-center gap-3 rounded-card border border-surface-border bg-surface-raised px-5 py-3"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${item.ok ? 'bg-verified' : 'bg-blocked'}`}
                aria-hidden
              />
              <span className="text-[13px]">{item.label}</span>
              <span className="text-[12px] text-muted">{item.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="panel p-7">
      <p className="eyebrow">{label}</p>
      <p className="mt-4 font-display text-5xl">{value}</p>
      <p className="mt-2 text-[12px] text-muted">{detail}</p>
    </div>
  );
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-[13px]">{title}</p>
      <p className="mx-auto mt-2 max-w-[46ch] text-[12px] leading-6 text-muted">{copy}</p>
    </div>
  );
}
