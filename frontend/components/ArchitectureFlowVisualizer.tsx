import Link from 'next/link';

/**
 * How a fact actually gets from a page to a student.
 *
 * The version this replaces was drawn from how the system ought to work rather
 * than from how it does, and several of its claims were ones the rest of the
 * site spends its time refusing to make. It called the pipeline "unforgeable"
 * on a site whose own verifier page says the certificate is not a signature
 * and that a forger could mint one. It showed the two sensors running in
 * parallel when the collector runs first and the witness is often not woken at
 * all. It advertised "99.9% Live" for a number nobody measured.
 *
 * A diagram of a system built to catch confident overstatement cannot be the
 * one place that overstates. So this shows the real order, including the
 * branch where the second sensor is skipped, and every label here is
 * something the code does.
 *
 * Static on purpose. The animated version implied it was watching something,
 * and the place to watch this happen is /proof, where it is real.
 */

interface Step {
  n: string;
  title: string;
  detail: string;
  /** What comes out, in the vocabulary the logs use. */
  out?: string;
}

const PIPELINE: Step[] = [
  {
    n: '01',
    title: 'An official page',
    detail:
      'A long-tail funding page nobody has a prebuilt scraper for. cprgindia.org, latrobe.edu.au, a Devpost listing.',
    out: 'a URL',
  },
  {
    n: '02',
    title: 'Scraper Studio collector runs',
    detail:
      'A c_* collector built from a natural-language brief, triggered through /dca/trigger. This is the first sensor and it runs first.',
    out: 'typed JSON',
  },
  {
    n: '03',
    title: 'Learned contracts check the row',
    detail:
      'Required fields, ranges, comparisons, and profiles learned from previous runs. A young collector has no baseline yet and says so.',
    out: 'pass, warn or fail',
  },
];

const SECOND: Step[] = [
  {
    n: '04',
    title: 'Web Unlocker reads the same page',
    detail:
      'Markdown rendered server-side by Bright Data, so this sensor shares no extraction code with the collector. Woken only when the contracts leave a question open.',
    out: 'markdown',
  },
  {
    n: '05',
    title: 'Field-by-field reconciliation',
    detail:
      'Each watched field compared as the kind of thing it is. Two spellings of one date are one date. A link is resolved against the page before it is compared.',
    out: 'agree, disagree or incomparable',
  },
];

const VERDICTS: { name: string; means: string; then: string }[] = [
  { name: 'healthy', means: 'Both read the same values', then: 'publish' },
  { name: 'genuine_source_change', means: 'Both read the same new value', then: 'publish, repair nothing' },
  { name: 'extractor_drift', means: 'They disagree', then: 'withhold the field, repair' },
  { name: 'access_anomaly', means: 'They saw different pages', then: 'withhold, blame neither' },
  { name: 'inconclusive', means: 'Too little to compare', then: 'withhold' },
  { name: 'explicit_failure', means: 'The run itself failed', then: 'withhold' },
];

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-2" aria-hidden="true">
      <div className="h-5 w-px bg-emerald-500/40" />
      {label === undefined ? null : (
        <span className="my-1 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-0.5 font-mono text-[10px] text-emerald-300">
          {label}
        </span>
      )}
      <div className="h-5 w-px bg-emerald-500/40" />
      <span className="-mt-1 text-emerald-500/60">▼</span>
    </div>
  );
}

function Card({ step, tone = 'default' }: { step: Step; tone?: 'default' | 'muted' }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone === 'muted'
          ? 'border-white/10 bg-white/[0.02]'
          : 'border-emerald-500/25 bg-emerald-500/[0.04]'
      }`}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-400">
        {step.n}
      </div>
      <h4 className="mt-1 font-mono text-[14px] text-white">{step.title}</h4>
      <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-white/55">{step.detail}</p>
      {step.out === undefined ? null : (
        <div className="mt-3 border-t border-white/10 pt-2 font-mono text-[10.5px] text-emerald-300/80">
          out: {step.out}
        </div>
      )}
    </div>
  );
}

export function ArchitectureFlowVisualizer() {
  return (
    <section className="border-t border-white/10 bg-black py-20 text-white">
      <div className="mx-auto max-w-[860px] px-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-400">
          How a fact reaches a student
        </div>
        <h2 className="mt-3 font-mondwest text-[clamp(30px,4.5vw,48px)] leading-[1.02] tracking-tight">
          One page, two readings, six answers.
        </h2>
        <p className="mt-4 max-w-[60ch] font-mono text-[12.5px] leading-relaxed text-white/55">
          The order below is the order the code runs in, including the branch where the second
          sensor is never woken. Watch it happen on{' '}
          <Link href="/proof" className="text-emerald-400 underline underline-offset-4">
            the proof page
          </Link>
          .
        </p>

        <div className="mt-12">
          {PIPELINE.map((step, index) => (
            <div key={step.n}>
              <Card step={step} />
              {index < PIPELINE.length - 1 ? <Arrow /> : null}
            </div>
          ))}

          {/*
            * The branch the old diagram left out.
            *
            * When every contract passes there is nothing for a second reading
            * to resolve, so it is not taken, and the record says `contract_only`
            * rather than claiming corroboration it does not have.
            */}
          <Arrow label="all contracts pass" />
          <Card
            tone="muted"
            step={{
              n: '—',
              title: 'Second sensor not woken',
              detail:
                'Nothing is in question, so nothing is spent asking. The record is published marked contract_only, never as confirmed by two sensors.',
              out: 'published, contract_only',
            }}
          />

          <div className="my-8 border-t border-dashed border-white/15" />

          <Arrow label="anything unresolved" />
          {SECOND.map((step, index) => (
            <div key={step.n}>
              <Card step={step} />
              {index < SECOND.length - 1 ? <Arrow /> : null}
            </div>
          ))}

          <Arrow label="classify" />

          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-400">
              06 · one of six verdicts
            </div>
            <div className="mt-3 grid gap-px overflow-hidden rounded border border-white/10 bg-white/10">
              {VERDICTS.map((verdict) => (
                <div key={verdict.name} className="grid gap-1 bg-black p-3 sm:grid-cols-[1.1fr_1fr_0.9fr]">
                  <code className="font-mono text-[11.5px] text-emerald-300">{verdict.name}</code>
                  <span className="font-mono text-[11px] text-white/50">{verdict.means}</span>
                  <span className="font-mono text-[11px] text-white/70">→ {verdict.then}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-white/50">
              The second row is the one that matters. A source that genuinely changed must not be
              repaired, because repairing a collector that was right is how a working one gets
              broken.
            </p>
          </div>

          <Arrow label="published, or withheld and repaired" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Card
              step={{
                n: '07a',
                title: 'What a student is served',
                detail:
                  'The verified world, and an application plan built from it that changes when the source does and holds a disputed requirement rather than dropping it.',
                out: 'opportunity + plan',
              }}
            />
            <Card
              step={{
                n: '07b',
                title: 'What a repair goes through',
                detail:
                  'bdata scraper heal proposes a candidate. It is replayed against the page that failed and the pages that were working, and rejected unless it fixes the first without breaking the second.',
                out: 'promoted, or rejected',
              }}
            />
          </div>

          <Arrow />

          <div className="grid gap-4 sm:grid-cols-2">
            <Card
              step={{
                n: '08a',
                title: 'MCP, for an agent',
                detail:
                  'An agent asks for a value and gets it with its verification state, or a refusal naming the disputed field and telling it not to scrape around the refusal.',
                out: 'verified value, or refusal',
              }}
            />
            <Card
              step={{
                n: '08b',
                title: 'Evidence certificate',
                detail:
                  'A SHA-256 digest over the verdict, both readings and the line each was read from. Re-derivable in your own browser, so changing any value breaks it.',
                out: 'checkable document',
              }}
            />
          </div>

          {/*
            * The honest limit, stated here because it is stated on /verify.
            *
            * The diagram this replaces called the pipeline "unforgeable" while
            * the verifier page says the certificate is not a signature and a
            * forger could mint one. Two pages of the same site cannot disagree
            * about what the evidence proves.
            */}
          <p className="mt-8 border-l-2 border-white/20 pl-4 font-mono text-[11.5px] leading-relaxed text-white/50">
            The certificate proves a document has not been edited since it was issued. It is not a
            signature, so it does not prove Doorway issued it. That limit is stated here for the
            same reason it is stated on{' '}
            <Link href="/verify" className="text-emerald-400 underline underline-offset-4">
              the verifier
            </Link>
            : a diagram of a system built to catch confident overstatement cannot be the one place
            that overstates.
          </p>
        </div>
      </div>
    </section>
  );
}
