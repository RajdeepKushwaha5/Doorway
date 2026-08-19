import type { GateCaseResult, RunRecord } from '@/lib/types';

/**
 * What the repair actually changed.
 *
 * The gate matrix reports pass or fail per case, which is the decision but not
 * the evidence. Approving a repair means putting a rewritten collector into
 * production, and "the gate passed" is a thin basis for that. The question an
 * operator has in front of the approve button is narrower and more concrete:
 * this field was wrong, is it right now, and does it agree with the page.
 *
 * Three columns answer it. What the collector returned when the incident
 * opened, what the candidate returns on the same page, and what the pinned
 * expectation says it should be. A repair that fixes the number is visible in
 * one line, and so is a repair that changes a field nobody asked it to touch.
 */

/** Render any stored value plainly, unwrapping the normalized money shape. */
function shown(value: unknown): string {
  if (value === undefined) return 'not returned';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) {
      const currency = typeof record['currency'] === 'string' ? ` ${record['currency']}` : '';
      return `${String(record['value'])}${currency}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function readPath(row: unknown, path: string): unknown {
  let cursor: unknown = row;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Compare two rendered values, which is the only comparison worth showing. */
function changed(before: unknown, after: unknown): boolean {
  return shown(before) !== shown(after);
}

export function RepairDiff({
  results,
  run,
}: {
  results: GateCaseResult[];
  run: RunRecord | null;
}) {
  // The incident case is the one that matters. A repair that passes the
  // regression corpus and fails the page that triggered it is the exact
  // failure this project was built around.
  const incidentCase = results.find((result) => result.label === 'incident') ?? results[0];
  if (incidentCase === undefined || incidentCase.fields.length === 0) return null;

  const brokenRow = run?.rows[0] ?? null;

  return (
    <div className="mt-6">
      <p className="text-sm leading-6 text-muted">
        The same page, read three ways: by the collector at the moment it broke, by the proposed
        repair, and by the expectation pinned when the collector was known good.
      </p>

      <div className="mt-4 overflow-x-auto border border-surface-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">
            Field values before the repair, after the repair, and as pinned
          </caption>
          <thead className="bg-surface-raised text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Field
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                When it broke
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                After the repair
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Expected
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {incidentCase.fields.map((field) => {
              const before = brokenRow === null ? undefined : readPath(brokenRow, field.path);
              const moved = brokenRow !== null && changed(before, field.observed);
              return (
                <tr key={field.path}>
                  <td className="px-4 py-2 font-mono text-xs text-ivory">{field.path}</td>
                  <td
                    className={`px-4 py-2 font-mono text-xs ${
                      brokenRow === null ? 'text-muted' : 'text-blocked'
                    }`}
                  >
                    {brokenRow === null ? 'run not retained' : shown(before)}
                  </td>
                  <td
                    className={`px-4 py-2 font-mono text-xs ${
                      field.agreed ? 'text-verified' : 'text-blocked'
                    }`}
                  >
                    {shown(field.observed)}
                    {moved ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">
                        changed
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{shown(field.expected)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted">
        A field marked changed is one the repair moved. A repair that moves a field nobody reported
        broken is as much a reason to reject as one that fails to move the field that was.
      </p>
    </div>
  );
}
