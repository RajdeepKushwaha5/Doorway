import { asText } from '@/lib/text';
import type { Incident } from '@/lib/types';

/**
 * The incident timeline.
 *
 * Chronological and receipt-first. Every claim NOTICE makes is shown next to
 * the thing that justified it: the witness line it read, the hash of the body
 * it read it from, and the transition that followed. A reviewer should be able
 * to disagree with the verdict using only what is on this page.
 */
export function EvidenceTimeline({ incident }: { incident: Incident }) {
  return (
    <ol className="space-y-4">
      {incident.history.map((step, index) => {
        const key = step.at + '-' + String(index);
        const isLast = index === incident.history.length - 1;
        return (
          <li key={key} className="relative pl-6">
            <span aria-hidden className="absolute left-0 top-2 h-2 w-2 bg-ember" />
            {isLast ? null : (
              <span aria-hidden className="absolute left-1 top-4 h-full w-px bg-surface-border" />
            )}
            <div className="flex flex-wrap items-baseline gap-x-3">
              <time className="font-mono text-xs text-muted" dateTime={step.at}>
                {new Date(step.at).toISOString().slice(11, 19)}
              </time>
              <span className="font-mono text-xs text-muted">
                {step.from} to {step.to}
              </span>
              <span className="border border-surface-border bg-surface-raised px-1.5 py-0.5 text-xs uppercase tracking-wide text-muted">
                {step.actor}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">{step.reason}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** Side-by-side collector and witness values, with the source line shown. */
/**
 * Print a witness reading the way a person reads it.
 *
 * Money arrives normalized as `{ value, currency }`, and `JSON.stringify` put
 * `{"value":249,"currency":null}` on the most-read screen in the project. The
 * null currency reads as a defect when it only means the page never said which
 * currency it was, which is a deliberate refusal to guess a symbol shared by
 * more than twenty of them.
 */
function readable(value: unknown): string {
  if (value === null) return 'nothing';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) {
      const currency = typeof record['currency'] === 'string' ? ` ${record['currency']}` : '';
      return `${String(record['value'])}${currency}`;
    }
    return JSON.stringify(value);
  }
  return asText(value);
}

export function WitnessComparison({ incident }: { incident: Incident }) {
  const witness = incident.witness;

  if (witness === null) {
    return <p className="text-sm text-muted">No witness observation was taken for this incident.</p>;
  }

  const fetchedAt = new Date(witness.fetchedAt).toISOString().replace('T', ' ').slice(0, 19);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="font-mono">sha256 {witness.contentHash.slice(0, 16)}</span>
        <time dateTime={witness.fetchedAt}>fetched {fetchedAt} UTC</time>
      </div>

      <div className="overflow-x-auto border border-surface-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Collector output compared against the witness</caption>
          <thead className="bg-surface-raised text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Field
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Witness read
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                From this line
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {witness.values.map((value) => (
              <tr key={value.path}>
                <td className="px-4 py-2 font-mono text-xs">{value.path}</td>
                <td className="px-4 py-2 font-mono text-xs text-ivory">
                  {readable(value.value)}
                </td>
                <td className="px-4 py-2">
                  <span className="block text-xs text-muted">{value.evidence.line}</span>
                  <span className="text-xs uppercase tracking-wide text-muted">
                    line {value.evidence.lineNumber}, {value.evidence.strategy},{' '}
                    {Math.round(value.confidence * 100)}% confidence
                  </span>
                  {/* Whether this reading is strong enough for a repair to
                      promote itself. A field below the bar does not block
                      detection; it means a person decides. */}
                  <span
                    className={`mt-1 block text-xs ${
                      value.confidence >= 0.7 ? 'text-verified' : 'text-suspect'
                    }`}
                  >
                    {value.confidence >= 0.7
                      ? 'meets the 0.70 evidence bar for automatic promotion'
                      : 'too weak to auto-promote; a human decides'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {witness.notFound.length > 0 ? (
        <p className="text-xs text-muted">
          The witness could not locate: {witness.notFound.join(', ')}. These fields are treated as
          incomparable rather than as disagreement.
        </p>
      ) : null}
    </div>
  );
}
