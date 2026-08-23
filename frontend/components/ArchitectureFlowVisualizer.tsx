import Link from 'next/link';

/**
 * The whole pipeline, in one screen, including the seam.
 *
 * Three rewrites got here. The first was drawn from how the system ought to
 * work and claimed things the rest of the site refuses to claim. The second was
 * accurate and scrolled for three screens, which is not a diagram, it is a
 * document. The third fitted on one screen and was wrong in a way that is worse
 * than either: every arrow was positioned rather than attached, so boxes
 * stretched to fill their grid column and the labels drifted away from the
 * things they described. A reader could not tell what fed what.
 *
 * The rule here is that a connector is a sibling of the two things it joins,
 * never a floating element that happens to sit between them. Nothing is
 * centred by hope.
 *
 * It also now draws the part that was missing entirely. NOTICE was shown
 * deciding a verdict and Doorway was shown publishing a world, with no line
 * between them, which read as two projects in one repository. The line is
 * `opportunitiesFromSnapshots(snapshots, collectors, incidents)`: the verdict
 * and the open incidents are what put the badge on a card.
 */

/** Border and fill per state: live path, held path, everything else. */
const RING: Record<'plain' | 'live' | 'held', string> = {
  live: 'border-emerald-500/50 bg-emerald-500/[0.07]',
  held: 'border-amber-500/40 bg-amber-500/[0.05]',
  plain: 'border-white/15 bg-white/[0.03]',
};

/**
 * One box. Sized to its content, never to its container.
 *
 * `w-fit` is the whole fix for the version where a single box spanned half the
 * diagram: as a block child of a grid column it grew to the column width and
 * read as a band rather than a step.
 */
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
  return (
    <div className={`w-fit max-w-full rounded border px-3 py-2 ${RING[tone]}`}>
      {label === undefined ? null : (
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
          {label}
        </div>
      )}
      <div className="font-mono text-[12px] leading-tight text-white">{title}</div>
      {note === undefined ? null : (
        <div className="mt-0.5 font-mono text-[10px] leading-tight text-white/45">{note}</div>
      )}
    </div>
  );
}

/**
 * A connector between two boxes in a chain.
 *
 * It points down on a narrow screen and right on a wide one, because that is
 * where the next box actually is. A `Chain` stacks below `sm`, and a
 * right-pointing arrow above a box that has wrapped underneath it is not a
 * decoration that survived a breakpoint, it is an arrow telling the reader
 * something false. Both glyphs are rendered and one is hidden, so the
 * direction is decided by the same breakpoint that decides the layout rather
 * than by a second source of truth.
 */
function Across({
  children,
  tone = 'live',
}: Readonly<{ children?: string; tone?: 'live' | 'held' }>) {
  // Colour carries meaning in this palette: green is the published path, amber
  // is the held one. A green arrow inside the repair layer spends the only
  // vocabulary the diagram has.
  const text = tone === 'held' ? 'text-amber-300/80' : 'text-emerald-300/80';
  const head = tone === 'held' ? 'text-amber-500/70' : 'text-emerald-500/70';
  return (
    <div
      className="flex shrink-0 flex-col items-center justify-center py-0.5 sm:px-1.5 sm:py-0"
      aria-hidden="true"
    >
      {children === undefined ? null : (
        <span className={`whitespace-nowrap font-mono text-[9px] ${text} sm:mb-0.5`}>
          {children}
        </span>
      )}
      <span className={`text-[10px] leading-none ${head} sm:hidden`}>&#9660;</span>
      <span className={`hidden text-[11px] leading-none ${head} sm:inline`}>&#9654;</span>
    </div>
  );
}

/** A vertical connector, drawn between the two blocks it joins. */
function Down({
  children,
  tone = 'live',
}: Readonly<{ children?: string; tone?: 'live' | 'held' }>) {
  const line = tone === 'held' ? 'bg-amber-500/40' : 'bg-emerald-500/40';
  const text = tone === 'held' ? 'text-amber-300/80' : 'text-emerald-300/80';
  const head = tone === 'held' ? 'text-amber-500/60' : 'text-emerald-500/60';
  return (
    <div className="flex flex-col items-center py-1" aria-hidden="true">
      <div className={`h-3 w-px ${line}`} />
      {children === undefined ? null : (
        <span className={`my-0.5 whitespace-nowrap font-mono text-[9px] ${text}`}>{children}</span>
      )}
      <span className={`text-[10px] leading-none ${head}`}>&#9660;</span>
    </div>
  );
}

/**
 * Boxes joined in sequence: stacked on a phone, left to right from `sm` up.
 *
 * Wrapping was the bug. A wrapped chain puts a box on the next line while its
 * connector still points sideways at the gap the box used to be in, which is
 * how the diagram ended up with an arrow aimed at nothing.
 */
function Chain({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-col items-start sm:flex-row sm:flex-wrap sm:items-center sm:gap-y-2">
      {children}
    </div>
  );
}

/** A named band. Makes the two systems, and the seam between them, visible. */
function Layer({
  name,
  children,
  tone = 'plain',
}: Readonly<{
  name: string;
  children: React.ReactNode;
  tone?: 'plain' | 'live' | 'held';
}>) {
  const ring =
    tone === 'live'
      ? 'border-emerald-500/25'
      : tone === 'held'
        ? 'border-amber-500/25'
        : 'border-white/10';
  const label =
    tone === 'live' ? 'text-emerald-400' : tone === 'held' ? 'text-amber-400' : 'text-white/40';
  return (
    <div className={`rounded-lg border ${ring} p-3 sm:p-4`}>
      <div className={`mb-2.5 font-mono text-[9px] uppercase tracking-[0.16em] ${label}`}>
        {name}
      </div>
      {children}
    </div>
  );
}

/**
 * What a reader actually sees on a card, in the colours the palette reserves
 * for it: green is verified, amber is suspect, red is withheld.
 */
const BADGES: readonly (readonly [string, string, string])[] = [
  ['verified', 'two sensors agreed', 'border-emerald-500/40 text-emerald-300'],
  ['partially verified', 'contracts only', 'border-white/20 text-white/70'],
  ['quarantined', 'open incident', 'border-amber-500/40 text-amber-300'],
];

const VERDICTS: readonly (readonly [string, string])[] = [
  ['healthy', 'publish'],
  ['genuine_source_change', 'publish, repair nothing'],
  ['extractor_drift', 'withhold, repair'],
  ['access_anomaly', 'withhold'],
  ['inconclusive', 'withhold'],
  ['explicit_failure', 'withhold'],
];

export function ArchitectureFlowVisualizer() {
  return (
    <section id="architecture" className="border-t border-white/10 bg-black py-14 text-white">
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
            watch it happen &#8599;
          </Link>
        </div>

        <div className="mt-7 space-y-1">
          {/* ---- Acquisition ---------------------------------------------- */}
          <Layer name="Bright Data reads the page">
            <Chain>
              <Box label="source" title="Official page" note="long tail, no prebuilt scraper" />
              <Across>URL</Across>
              <Box
                label="sensor 1"
                title="Scraper Studio c_*"
                note="built from a brief"
                tone="live"
              />
              <Across>typed JSON</Across>
              <Box label="check" title="Learned contracts" note="required, ranges, profiles" />
            </Chain>
          </Layer>

          <Down>every row, before anything is published</Down>

          {/* ---- The trust engine ------------------------------------------ */}
          <Layer name="NOTICE decides whether it can be defended" tone="live">
            {/*
             * The fork, drawn as two owned columns rather than two arrows that
             * happen to sit near each other. Each branch label sits inside the
             * column it belongs to, so nothing depends on where it lands.
             */}
            <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
              <div className="rounded border border-white/10 p-2.5">
                <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
                  branch: all contracts pass
                </div>
                <Box
                  title="Second sensor not woken"
                  note="published as contract_only, never as two sensors"
                />
              </div>

              <div className="rounded border border-emerald-500/20 p-2.5">
                <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-400/70">
                  branch: anything unresolved
                </div>
                <Chain>
                  <Box
                    label="sensor 2"
                    title="Web Unlocker"
                    note="markdown, no shared code"
                    tone="live"
                  />
                  <Across>markdown</Across>
                  <Box title="Reconcile" note="agree, disagree, incomparable" />
                </Chain>
              </div>
            </div>

            <Down>both branches land here</Down>

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
                    <span className="text-white/30"> &#8594; </span>
                    {then}
                  </span>
                ))}
              </div>
            </div>
          </Layer>

          {/*
           * The seam. This is the line that was missing, and it is the reason
           * the two halves are one product rather than two.
           *
           * The arrow lives in the same grid cell as the layer it introduces.
           * Splitting them into a row of arrows above a row of layers lines up
           * on a wide screen and comes apart on a phone, where both grids
           * collapse and the second arrow ends up pointing at the first layer.
           */}
          <div className="grid items-start gap-x-6 md:grid-cols-2">
            {/* ---- The product ------------------------------------------- */}
            <div>
              <Down>verdict + open incidents</Down>
              <Layer name="Doorway shows a student">
                <div className="mb-2 rounded border border-white/10 bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-white/50">
                  opportunitiesFromSnapshots(
                  <span className="text-emerald-300">snapshots, collectors, incidents</span>)
                </div>
                <Box title="Badge on every card" note="the reader sees one of these" tone="live" />
                {/*
                 * The actual badge vocabulary, in the actual colours. A note
                 * listing all three would have been one long line, and `w-fit`
                 * would then size the box to the whole column, which is the
                 * stretching this rewrite exists to stop.
                 */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BADGES.map(([name, why, colour]) => (
                    <span
                      key={name}
                      className={`rounded border px-2 py-1 font-mono text-[10px] ${colour}`}
                    >
                      {name}
                      <span className="text-white/30"> &#183; </span>
                      <span className="text-white/50">{why}</span>
                    </span>
                  ))}
                </div>
                <Down>the same verdict, in a sentence</Down>
                {/*
                 * Stacked at every width, not chained. This column is half of
                 * 1080px, which is not enough for two boxes side by side, so a
                 * chain here wrapped even on a desktop and left its connector
                 * pointing at the space the second box had just left.
                 */}
                <Box
                  title="Application plan"
                  note="will not claim readiness while a field is disputed"
                />
                <Down>the same evidence</Down>
                <Box title="MCP + certificate" note="agents get evidence or a refusal" />
              </Layer>
            </div>

            {/* ---- The repair loop --------------------------------------- */}
            <div>
              <Down tone="held">withheld</Down>
              <Layer name="And what happens to the rest" tone="held">
                <Chain>
                  <Box title="bdata scraper heal" note="candidate proposed" tone="held" />
                  <Across tone="held">candidate</Across>
                  <Box
                    title="Gate replays it"
                    note="fixes the failure, breaks nothing"
                    tone="held"
                  />
                </Chain>
                <Down tone="held">only if both hold</Down>
                <Box
                  title="Back to production"
                  note="and the card returns to verified"
                  tone="held"
                />
              </Layer>
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
