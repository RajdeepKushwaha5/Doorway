'use client';

import { useState, useTransition } from 'react';
import { updateCollectorAction } from '@/app/actions';
import type { WitnessFieldSpec } from '@/lib/types';

/**
 * Fix the setting most likely to be wrong, and worst to get wrong.
 *
 * A witness spec finds a field by the words next to it. Get those words wrong
 * and nothing errors: the witness reads a different line, disagrees with the
 * collector, and reports drift on a page where nothing was wrong. That is a
 * confident wrong verdict, which is worse than a crash, and it was previously
 * only fixable by resetting the store.
 *
 * `PUT /api/collectors/:id` was written to solve exactly that and then had no
 * interface at all. This is that interface, deliberately narrow: the labels
 * the witness matches on, and the labels it must skip. Everything else about a
 * collector is either safe to leave alone or dangerous to edit in a hurry.
 */
export function WitnessSpecEditor({
  collectorId,
  specs,
}: {
  collectorId: string;
  specs: WitnessFieldSpec[];
}) {
  const [draft, setDraft] = useState(specs);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function edit(index: number, key: 'labels' | 'excludeLabels', raw: string): void {
    setDraft((current) =>
      current.map((spec, position) =>
        position === index
          ? {
              ...spec,
              // Split on commas and drop the empties, so a trailing comma while
              // typing does not become a label that matches every line.
              [key]: raw
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== ''),
            }
          : spec,
      ),
    );
    setMessage(null);
  }

  function save(): void {
    // The route rejects a spec with no labels, because a witness with nothing
    // to match on cannot read anything. Caught here so the reason arrives
    // before the request rather than as a 400 afterwards.
    const empty = draft.find((spec) => spec.labels.length === 0);
    if (empty !== undefined) {
      setMessage({ ok: false, text: `"${empty.path}" needs at least one label to match on.` });
      return;
    }

    startTransition(() => {
      void updateCollectorAction(collectorId, { witnessSpecs: draft }).then((result) => {
        setMessage(
          result.ok
            ? { ok: true, text: 'Saved. The next observation reads the page with these labels.' }
            : { ok: false, text: result.error },
        );
      });
    });
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(specs);

  if (specs.length === 0) {
    return (
      <p className="text-sm text-muted">
        This collector has no witness specs, so there is nothing for the second sensor to read.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">
        The witness finds each field by the words printed next to it. A label that matches the
        wrong line produces a confident wrong verdict rather than an error, so this is the setting
        worth being able to correct without resetting anything.
      </p>

      {draft.map((spec, index) => (
        <div key={spec.path} className="border border-surface-border bg-surface-soft p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-sm text-ivory">{spec.path}</span>
            <span className="text-xs text-muted">{spec.kind}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">{spec.meaning}</p>

          <label className="mt-3 block">
            <span className="text-xs uppercase tracking-wide text-muted">Match on</span>
            <input
              type="text"
              value={spec.labels.join(', ')}
              onChange={(event) => {
                edit(index, 'labels', event.target.value);
              }}
              disabled={pending}
              className="mt-1 w-full border border-surface-border bg-surface-raised px-3 py-2 font-mono text-sm text-ivory disabled:opacity-40"
            />
          </label>

          <label className="mt-2 block">
            <span className="text-xs uppercase tracking-wide text-muted">
              Skip lines containing
            </span>
            <input
              type="text"
              value={spec.excludeLabels.join(', ')}
              onChange={(event) => {
                edit(index, 'excludeLabels', event.target.value);
              }}
              disabled={pending}
              className="mt-1 w-full border border-surface-border bg-surface-raised px-3 py-2 font-mono text-sm text-ivory disabled:opacity-40"
            />
          </label>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={pending || !changed}
          className="secondary-button disabled:opacity-40"
        >
          {pending ? 'Saving...' : 'Save labels'}
        </button>
        {changed && !pending ? (
          <button
            type="button"
            onClick={() => {
              setDraft(specs);
              setMessage(null);
            }}
            className="text-sm text-muted underline underline-offset-4 hover:text-ivory"
          >
            Discard changes
          </button>
        ) : null}
      </div>

      {message !== null ? (
        <p
          className={`border p-3 text-sm leading-6 ${
            message.ok
              ? 'border-verified/30 bg-verified/10 text-verified'
              : 'border-blocked/30 bg-blocked/10 text-blocked'
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
