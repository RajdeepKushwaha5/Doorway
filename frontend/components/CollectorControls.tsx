'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acceptBaselineAction, runCollectorAction } from '@/app/actions';
import type { RunRecord } from '@/lib/types';

/** Run a collector once, now. */
export function RunNowButton({ collectorId, url }: { collectorId: string; url?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await runCollectorAction(collectorId, url);
            setMessage(
              result.ok
                ? { tone: 'ok', text: 'Observation complete.' }
                : { tone: 'error', text: result.error },
            );
            if (result.ok) router.refresh();
          });
        }}
        className="status-chip border border-surface-border bg-surface-raised px-3 py-1.5 text-muted hover:text-ivory disabled:opacity-50"
      >
        {pending ? 'Observing' : 'Run now'}
      </button>
      {message !== null ? (
        <p className={`text-sm ${message.tone === 'ok' ? 'text-verified' : 'text-blocked'}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Baseline acceptance.
 *
 * The operator picks specific runs. The backend deliberately refuses to learn
 * from "whatever passed the automated checks", because those checks are
 * derived from the baseline, so a slow corruption that never trips a hard
 * invariant would be absorbed into the profile and the detector would go quiet
 * on exactly the thing it exists to catch. A human looks at the sample output
 * and decides.
 */
/**
 * The few values a person needs to judge a run, in reading order.
 *
 * Deliberately not every field: the question at this checkbox is whether the
 * reading is correct, and a serialised row answers it worse than four labelled
 * values do.
 */
function summarise(row: unknown): { label: string; value: string }[] {
  if (row === null || typeof row !== 'object') return [];
  const record = row as Record<string, unknown>;
  const out: { label: string; value: string }[] = [];

  for (const [key, raw] of Object.entries(record)) {
    if (key === 'input' || raw === null || raw === undefined) continue;
    if (out.length >= 4) break;

    let value: string;
    if (typeof raw === 'object') {
      const money = raw as Record<string, unknown>;
      if (!('value' in money)) continue;
      const currency = typeof money['currency'] === 'string' ? ` ${money['currency']}` : '';
      value = `${String(money['value'])}${currency}`;
    } else {
      value = String(raw);
    }
    out.push({ label: key.replace(/_/g, ' '), value });
  }

  return out;
}

/** Which page this run read, since one collector watches several. */
function pageOf(run: RunRecord): string | null {
  const first = run.targetUrls[0];
  if (first === undefined) return null;
  try {
    return new URL(first).pathname;
  } catch {
    return first;
  }
}

export function BaselineReview({
  collectorId,
  runs,
  incidents = [],
}: {
  collectorId: string;
  runs: RunRecord[];
  /**
   * Used to exclude runs that were already judged wrong.
   *
   * A drifted run carries no *failing* check when the baseline is empty, so it
   * looked eligible and the interface offered a row reading `price 25` as
   * material for teaching the system what normal is. Accepting it would have
   * taught NOTICE that the deposit is the price, which is the precise failure
   * the manual-acceptance rule exists to prevent.
   */
  incidents?: { runId: string; classification: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const judgedWrong = new Set(
    incidents
      .filter((incident) => incident.classification !== 'healthy')
      .map((incident) => incident.runId),
  );

  const eligible = runs.filter(
    (run) => !run.checks.some((check) => check.status === 'fail') && !judgedWrong.has(run.id),
  );
  const excluded = runs.length - eligible.length;

  const toggle = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (eligible.length === 0) {
    return (
      <p className="text-sm text-muted">
        No run is eligible. A run with a hard invariant failure can never be baseline material, even
        if you ask for it.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Select the runs you have looked at and believe are correct. {eligible.length} eligible
        {excluded > 0
          ? `, ${String(excluded)} withheld from this list because a verdict already found them wrong`
          : ''}
        . This is what the system will treat as normal, so a wrong choice here teaches it the wrong
        thing.
      </p>

      <ul className="space-y-2">
        {eligible.slice(0, 12).map((run) => {
          const warnings = run.checks.filter((check) => check.status === 'warn').length;
          return (
            <li key={run.id} className="border border-surface-border bg-surface-raised p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(run.id)}
                  onChange={() => toggle(run.id)}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-3">
                    <time className="font-mono text-xs text-muted" dateTime={run.observedAt}>
                      {new Date(run.observedAt).toISOString().replace('T', ' ').slice(0, 19)}
                    </time>
                    <span className="text-xs text-muted">
                      {run.rows.length} row{run.rows.length === 1 ? '' : 's'}
                      {warnings > 0 ? `, ${String(warnings)} warning${warnings === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                  {/* A stringified row stretched the full width and read as
                      noise. The decision here is "is this reading correct",
                      which needs the values and the page they came from, not
                      the serialisation. */}
                  <span className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    {summarise(run.rows[0]).map((entry) => (
                      <span key={entry.label} className="font-mono text-xs">
                        <span className="text-muted">{entry.label} </span>
                        <span className="text-ivory">{entry.value}</span>
                      </span>
                    ))}
                  </span>
                  {pageOf(run) === null ? null : (
                    <span className="mt-1 block truncate font-mono text-[11px] text-muted">
                      {pageOf(run)}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        disabled={pending || selected.size === 0}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await acceptBaselineAction(collectorId, [...selected]);
            setMessage(
              result.ok
                ? { tone: 'ok', text: `Baseline learned from ${String(selected.size)} run(s).` }
                : { tone: 'error', text: result.error },
            );
            if (result.ok) {
              setSelected(new Set());
              router.refresh();
            }
          });
        }}
        className="inline-flex items-center justify-center rounded-md border-2 border-verified bg-verified/10 px-6 py-3 font-mono text-[12px] font-semibold uppercase tracking-pixel text-verified transition-all hover:bg-verified hover:text-white disabled:cursor-not-allowed disabled:border-surface-border disabled:bg-transparent disabled:text-muted disabled:opacity-100"
      >
        {pending
          ? 'Learning'
          : selected.size === 0
            ? 'Select runs to accept'
            : `Accept ${String(selected.size)} run${selected.size === 1 ? '' : 's'} as baseline`}
      </button>

      {message !== null ? (
        <p className={`text-sm ${message.tone === 'ok' ? 'text-verified' : 'text-blocked'}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
