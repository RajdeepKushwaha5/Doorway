/**
 * Whether this collector repairs itself, and what has to be true first.
 *
 * The single setting that decides whether NOTICE is a dashboard or an
 * automation. An operator should never have to guess which one they are
 * looking at, and if it is automating, they should be able to see the
 * conditions rather than trust them.
 */
export function AutomationPolicy({
  policy,
}: {
  policy: 'never' | 'on_gate_pass';
}) {
  const automated = policy === 'on_gate_pass';

  return (
    <section className="evidence-section">
      <div className="evidence-section__heading">
        <p>{automated ? '↻' : '✋'}</p>
        <div>
          <p className="eyebrow">Automation</p>
          <h2>{automated ? 'Repairs itself' : 'Asks before changing production'}</h2>
        </div>
      </div>

      <p className="max-w-2xl text-[13px] leading-6 text-muted">
        {automated
          ? 'A repair that clears every check below is promoted with no human involved, and production is re-verified afterwards.'
          : 'A repair is prepared, replayed and gated automatically, then waits for a person to promote it. This is the default: a collector earns automation by being understood, not by being registered.'}
      </p>

      <ol className="mt-6 space-y-3">
        {[
          [
            'Gate passes on every case',
            'The candidate has to fix the page that failed and break none of the pages that were working.',
          ],
          [
            'Weakest reading clears 0.7 confidence',
            'The gate checks against values the witness read, so it is only as trustworthy as that reading. A bare number with nothing naming it scores 0.35 and is never enough.',
          ],
          [
            'Production is re-verified after promoting',
            'Held to the full contract, not to whether rows came back. Done often does not mean successful.',
          ],
        ].map(([title, copy], index) => (
          <li key={title} className="flex gap-4 border border-surface-border bg-surface p-4">
            <span className="font-display text-2xl text-muted">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span>
              <span className="block text-[13px]">{title}</span>
              <span className="mt-1 block text-[12px] leading-6 text-muted">{copy}</span>
            </span>
          </li>
        ))}
      </ol>

      {automated ? null : (
        <p className="mt-6 text-[12px] text-muted">
          Set <code className="font-mono text-ivory">autoPromote</code> to{' '}
          <code className="font-mono text-ivory">on_gate_pass</code> when registering to close the
          loop.
        </p>
      )}
    </section>
  );
}
