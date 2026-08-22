'use client';

import { useCallback, useEffect, useState } from 'react';
import { getMissionAction } from '@/app/actions';
import type { Mission } from '@/lib/types';

/**
 * The step after "this is true".
 *
 * A verified record tells a student a deadline is real. It does not tell them
 * they are missing a reference letter, that the portal will be busy on the
 * closing day, or that the requirement they are looking at is one the two
 * sensors are currently arguing about.
 *
 * Everything shown here is computed on the server. The percentage looks simple
 * enough to work out in the browser, and the moment it is worked out here the
 * rule exists twice and the two copies drift, which is the failure this
 * project spends its whole time catching in other people's scrapers.
 */

const STORAGE_KEY = 'doorway.documents.held';

/** Documents a student is likely to already have, so the list starts useful. */
function readHeld(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    // Private windows, cleared site data, and browsers set to block storage all
    // land here. An empty list is a correct answer, so nothing is worth saying.
    return [];
  }
}

function writeHeld(held: readonly string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(held));
  } catch {
    /* the plan still works, it just will not be remembered */
  }
}

const STATE_LABEL: Record<Mission['state'], string> = {
  discovered: 'Not yet corroborated',
  verified: 'Facts confirmed',
  eligible: 'Eligible, documents outstanding',
  application_ready: 'Ready to submit',
  blocked: 'Blocked',
  submitted: 'Submitted',
};

const STATE_TONE: Record<Mission['state'], string> = {
  discovered: 'text-gray-500',
  verified: 'text-gray-700',
  eligible: 'text-emerald-700',
  application_ready: 'text-emerald-700',
  blocked: 'text-red-600',
  submitted: 'text-gray-500',
};

function formatDate(at: number | null): string {
  if (at === null) return 'not published';
  return new Date(at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function ApplicationMission({ opportunityId }: { opportunityId: string }) {
  const [held, setHeld] = useState<string[]>([]);
  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => setHeld(readHeld()), []);

  const load = useCallback(
    (documents: readonly string[]) => {
      setBusy(true);
      void getMissionAction(opportunityId, documents).then((result) => {
        setBusy(false);
        if (result.ok) {
          setMission(result.mission);
          setError(null);
        } else {
          setError(result.error);
        }
      });
    },
    [opportunityId],
  );

  useEffect(() => load(held), [load, held]);

  const toggle = (name: string): void => {
    const next = held.includes(name) ? held.filter((d) => d !== name) : [...held, name];
    setHeld(next);
    writeHeld(next);
  };

  if (error !== null) {
    return (
      <div className="border-l-2 border-amber-500 bg-amber-50/60 px-4 py-3 font-mono text-[12px] leading-relaxed text-gray-700">
        The plan could not be built. This is an unanswered question rather than an empty one.
        <div className="mt-1 text-[11px] text-gray-500">{error}</div>
      </div>
    );
  }

  if (mission === null) {
    return (
      <div className="px-4 py-3 font-mono text-[12px] text-gray-500">Building the plan...</div>
    );
  }

  const { readiness } = mission;

  return (
    <div className="border-t border-black">
      {/* Readiness, and what the system calls this state */}
      <div className="flex items-baseline justify-between gap-4 px-4 pt-4">
        <div>
          <div className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-400">
            Application readiness
          </div>
          <div className="mt-1 font-mondwest text-[38px] leading-none tabular-nums">
            {readiness.percent}%
          </div>
        </div>
        <div className="text-right">
          <div
            className={`font-neuebit text-[10px] uppercase tracking-[0.14em] font-bold ${STATE_TONE[mission.state]}`}
          >
            {STATE_LABEL[mission.state]}
          </div>
          <div className="mt-1 max-w-[26ch] font-mono text-[10.5px] leading-4 text-gray-500">
            {mission.stateReason}
          </div>
        </div>
      </div>

      <div className="mx-4 mt-3 h-1 bg-gray-200">
        <div
          className={`h-1 transition-all duration-500 ${mission.state === 'blocked' ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${String(readiness.percent)}%` }}
        />
      </div>

      {/* Dates. The safety date is this system's opinion and is labelled as one. */}
      <div className="mt-4 grid grid-cols-2 gap-px border-y border-gray-200 bg-gray-200">
        <div className="bg-white px-4 py-3">
          <div className="font-neuebit text-[9.5px] uppercase tracking-[0.12em] text-gray-400">
            Verified deadline
          </div>
          <div className="mt-1 font-mono text-[12px] text-gray-900">
            {mission.deadline.raw ?? 'not published'}
          </div>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="font-neuebit text-[9.5px] uppercase tracking-[0.12em] text-gray-400">
            Be finished by
          </div>
          <div className="mt-1 font-mono text-[12px] text-gray-900">
            {formatDate(mission.deadline.safety)}
          </div>
        </div>
      </div>

      {/* Documents. Tick what you hold. */}
      {mission.documents.length === 0 ? (
        <p className="px-4 py-4 font-mono text-[11.5px] leading-relaxed text-gray-500">
          This source publishes no document list, so there is nothing to gather in advance. Open the
          official page before you start, in case it asks for something it never printed.
        </p>
      ) : (
        <ul className="px-4 py-3">
          {mission.documents.map((document) => (
            <li key={document.name}>
              <button
                type="button"
                onClick={() => toggle(document.name)}
                disabled={document.status === 'disputed' || busy}
                className="flex w-full items-center gap-3 py-1.5 text-left font-mono text-[12px] disabled:cursor-not-allowed"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] ${
                    document.status === 'held'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : document.status === 'disputed'
                        ? 'border-amber-500 text-amber-600'
                        : 'border-gray-400 text-transparent'
                  }`}
                >
                  {document.status === 'disputed' ? '?' : 'x'}
                </span>
                <span
                  className={
                    document.status === 'held' ? 'text-gray-400 line-through' : 'text-gray-800'
                  }
                >
                  {document.name}
                </span>
                {document.status === 'disputed' ? (
                  <span className="ml-auto font-neuebit text-[9px] uppercase tracking-[0.1em] text-amber-600">
                    disputed
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        * The sentence this whole product exists to be able to print.
        *
        * A requirement the two sensors disagree about is shown and held, never
        * dropped. A checklist that quietly loses an item because an extractor
        * drifted would send a student to submit an incomplete application, and
        * every piece of JSON involved would have been valid.
        */}
      {mission.disputed.length > 0 ? (
        <div className="border-t border-amber-200 bg-amber-50/60 px-4 py-3 font-mono text-[11px] leading-relaxed text-gray-700">
          The two sensors disagree about <strong>{mission.disputed.join(', ')}</strong>. These items
          are held at the last reading both confirmed rather than removed, so this plan cannot
          quietly lose something the page still asks for.
        </div>
      ) : null}

      {mission.blockers.length > 0 ? (
        <div className="border-t border-red-200 bg-red-50/60 px-4 py-3 font-mono text-[11px] leading-relaxed text-red-800">
          {mission.blockers.map((blocker) => (
            <div key={blocker}>{blocker}</div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 border-t border-gray-200 px-4 py-3 font-mono text-[10px] text-gray-400">
        <span>
          {readiness.held} of {readiness.total} documents in hand
        </span>
        <span>confirmed by {mission.confirmedBy.replace(/_/g, ' ')}</span>
      </div>
    </div>
  );
}
