import type { GateCaseResult } from '@/lib/types';

/**
 * The approval gate matrix.
 *
 * This is the screen the whole project builds toward, so it is deliberately
 * blunt. The row that matters is the incident: a candidate whose preview was
 * green and which still fails here is the reason NOTICE does not auto-approve,
 * and a reader should be able to see that in about two seconds.
 */
export function GateMatrix({
  results,
  approved,
  reasons,
}: {
  results: GateCaseResult[];
  approved: boolean;
  reasons: string[];
}) {
  if (results.length === 0) {
    return (
      <p className="text-sm text-muted">
        No candidate has been replayed yet. The gate runs after Self-Healing proposes a repair.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className={`border p-4 ${
          approved
            ? 'border-verified/40 bg-verified/10'
            : 'border-blocked/40 bg-blocked/10'
        }`}
      >
        <p className="font-mono text-sm font-semibold uppercase tracking-wide">
          {approved ? 'Safe to approve' : 'Blocked. Production unchanged.'}
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      <div className="overflow-x-auto border border-surface-border">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="sr-only">
            Candidate replay results against the incident page and the regression corpus
          </caption>
          <thead className="bg-surface-raised text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Result
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Case
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Detail
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {results.map((result) => (
              <tr key={result.url} className={result.label === 'incident' ? 'bg-surface-raised/60' : ''}>
                <td className="px-4 py-2">
                  <span
                    className={`status-chip ${
                      result.passed
                        ? 'bg-verified/15 text-verified'
                        : 'bg-blocked/15 text-blocked'
                    }`}
                  >
                    {result.passed ? 'Pass' : 'Fail'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className="text-ivory">{result.label}</span>
                  <span className="block break-all font-mono text-xs text-muted">{result.url}</span>
                </td>
                <td className="px-4 py-2 text-muted">
                  {result.executionError !== null ? (
                    <span className="text-blocked">{result.executionError}</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {result.fields
                        .filter((field) => !field.agreed)
                        .map((field) => (
                          <li key={field.path} className="font-mono text-xs">
                            {field.path}: {field.note}
                          </li>
                        ))}
                      {result.fields.every((field) => field.agreed) ? (
                        <li className="text-xs text-muted">all pinned fields matched</li>
                      ) : null}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
