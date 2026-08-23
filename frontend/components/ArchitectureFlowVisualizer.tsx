import Link from 'next/link';

/**
 * The whole pipeline, in one screen.
 *
 * Two rewrites got here. The first was drawn from how the system ought to work
 * and claimed things the rest of the site refuses to claim: it called the
 * pipeline "unforgeable" while the verifier page says the certificate is not a
 * signature, showed the sensors running in parallel when the collector runs
 * first, and advertised an uptime figure nobody measured. The second was
 * accurate and scrolled for three screens, which is not a diagram, it is a
 * document.
 *
 * A reader should see the shape of the thing at once: where it forks, what
 * moves along each arrow, and which branch ends in a published fact. Anything
 * that needs a paragraph belongs on the page that demonstrates it.
 */

/** Border and fill per state: live path, held path, everything else. */
const RING: Record<'plain' | 'live' | 'held', string> = {
  live: 'border-emerald-500/50 bg-emerald-500/[0.07]',
  held: 'border-amber-500/40 bg-amber-500/[0.05]',
  plain: 'border-white/15 bg-white/[0.03]',
};

/** One box. Two lines at most, because the shape is the point. */
function Box({
  label,
  title,
  note,
  tone = 'plain',
}: Readonly<{
  label?: string;
  title: string;
  note?: string;
  tone?: 'plain' | 'live' | 'held';
}>) {
  const ring = RING[tone];
  return (
    <div className={`rounded border px-3 py-2 ${ring}`}>
      {label === undefined ? null : (
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">{label}</div>
      )}
      <div className="font-mono text-[12px] leading-tight text-white">{title}</div>
      {note === undefined ? null : (
        <div className="mt-0.5 font-mono text-[10px] leading-tight text-white/45">{note}</div>
      )}
    </div>
  );
}

/** A labelled arrow. The label is what travels, not what happens. */
function Flow({ children, vertical = false }: Readonly<{ children?: string; vertical?: boolean }>) {
  if (vertical) {
    return (
      <div className="flex flex-col items-center py-1" aria-hidden="true">
        <div className="h-3 w-px bg-emerald-500/40" />
        {children === undefined ? null : (
          <span className="my-0.5 font-mono text-[9px] text-emerald-300/80">{children}</span>
        )}
        <span className="text-[10px] leading-none text-emerald-500/60">▼</span>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 flex-col items-center px-1" aria-hidden="true">
      {children === undefined ? null : (
        <span className="mb-0.5 font-mono text-[9px] text-emerald-300/80">{children}</span>
      )}
      <span className="text-[11px] leading-none text-emerald-500/70">▶</span>
    </div>
  );
}

const VERDICTS: [string, string][] = [
  ['healthy', 'publish'],
  ['genuine_source_change', 'publish, repair nothing'],
  ['extractor_drift', 'withhold, repair'],
  ['access_anomaly', 'withhold'],
  ['inconclusive', 'withhold'],
  ['explicit_failure', 'withhold'],
];

export function ArchitectureFlowVisualizer() {
  return (
    <section className="border-t border-white/10 bg-black py-14 text-white">
      <div className="mx-auto max-w-[1080px] px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400">
              How a fact reaches a student
            </div>
            <h2 className="mt-1 font-mondwest text-[clamp(26px,3.6vw,40px)] leading-none tracking-tight">
              One page, two readings, six answers.
            </h2>
          </div>
          <Link
            href="/proof"
            className="font-mono text-[11px] text-emerald-400 underline underline-offset-4"
          >
            watch it happen ↗
          </Link>
        </div>

        <div className="mt-7 rounded-lg border border-white/10 p-4 sm:p-5">
          {/* Row 1: the first sensor, left to right. */}
          <div className="flex flex-wrap items-center gap-y-2">
            <Box label="source" title="Official page" note="long tail, no prebuilt scraper" />
            <Flow>URL</Flow>
            <Box label="sensor 1" title="Scraper Studio c_*" note="built from a brief" tone="live" />
            <Flow>typed JSON</Flow>
            <Box label="check" title="Learned contracts" note="required, ranges, profiles" />
          </div>

          {/* The fork. Drawn, because it is the reason not every record says
              two sensors, and leaving it out made the honest label look broken. */}
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <Flow vertical>all pass</Flow>
              <Box
                title="Second sensor not woken"
                note="published as contract_only, never as two sensors"
              />
            </div>

            <div>
              <Flow vertical>anything unresolved</Flow>
              <div className="flex flex-wrap items-center gap-y-2">
                <Box label="sensor 2" title="Web Unlocker" note="markdown, no shared code" tone="live" />
                <Flow>markdown</Flow>
                <Box title="Reconcile" note="field by field" />
              </div>
            </div>
          </div>

          <Flow vertical>agree · disagree · incomparable</Flow>

          {/* The six verdicts, as chips rather than a table. */}
          <div className="rounded border border-emerald-500/30 bg-emerald-500/[0.05] p-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-400">
              one of six verdicts
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VERDICTS.map(([name, then]) => (
                <span
                  key={name}
                  className="rounded border border-white/10 bg-black px-2 py-1 font-mono text-[10px] text-white/70"
                >
                  <span className="text-emerald-300">{name}</span>
                  <span className="text-white/30"> → </span>
                  {then}
                </span>
              ))}
            </div>
          </div>

          {/* Row 3: the two endings. */}
          <div className="mt-1 grid gap-4 md:grid-cols-2">
            <div>
              <Flow vertical>published</Flow>
              <div className="flex flex-wrap items-center gap-y-2">
                <Box title="Verified world" note="+ application plan" tone="live" />
                <Flow />
                <Box title="MCP + certificate" note="agents get evidence or a refusal" />
              </div>
            </div>
            <div>
              <Flow vertical>withheld</Flow>
              <div className="flex flex-wrap items-center gap-y-2">
                <Box title="bdata scraper heal" note="candidate proposed" tone="held" />
                <Flow />
                <Box title="Gate replays it" note="fixes the failure, breaks nothing" tone="held" />
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-white/40">
          A source that genuinely changed is published and repaired nothing: repairing a collector
          that was right is how a working one gets broken. The certificate proves a document has not
          been edited, not who issued it, which is the limit{' '}
          <Link href="/verify" className="text-emerald-400 underline underline-offset-4">
            the verifier
          </Link>{' '}
          states too.
        </p>
      </div>
    </section>
  );
}
