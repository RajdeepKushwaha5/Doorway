'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getDiscoveryAction,
  startDiscoveryAction,
  type DiscoveryDraft,
} from '@/app/actions';
import { apiBase } from '@/lib/env';
import type { DoorwayProfile } from '@/lib/types';

/**
 * Search the live web for what this student actually asked for.
 *
 * The world above is built from sources Doorway watches continuously, which is
 * the strong claim: two sensors, a learned history, and a record of every time
 * the page moved. It is also, necessarily, a short list. A student whose
 * interest is not on it gets an empty world and no way forward.
 *
 * This is the other half. It goes and looks, now, through Bright Data, and
 * shows what it finds within a minute or so.
 *
 * The honesty problem is the whole design. What comes back has been read once,
 * by one sensor, with no history to check it against. That is strictly weaker
 * than anything in the verified feed and it must never be presented as though
 * it were the same thing. So results arrive in their own section, labelled as
 * found-not-verified, with every field the page failed to state named rather
 * than filled in with a guess.
 */

interface StreamLine {
  step: string;
  line: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running'; id: string }
  | { kind: 'done'; id: string }
  | { kind: 'failed'; message: string };

export function LiveDiscovery({ profile }: { profile: DoorwayProfile }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [drafts, setDrafts] = useState<DiscoveryDraft[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Close the stream if the component goes away mid-search. Without this a
  // navigation leaves the connection open and the browser keeps reconnecting.
  useEffect(
    () => () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const element = logRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const run = (): void => {
    setLines([]);
    setDrafts([]);
    setPhase({ kind: 'starting' });

    void (async () => {
      const started = await startDiscoveryAction(profile);
      if (!started.ok) {
        setPhase({ kind: 'failed', message: started.error });
        return;
      }

      const { discoveryId, remaining: left } = started.data;
      setRemaining(left);
      setPhase({ kind: 'running', id: discoveryId });

      const source = new EventSource(
        `${apiBase()}/api/observations/${encodeURIComponent(discoveryId)}/events`,
      );
      sourceRef.current = source;

      source.onmessage = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as StreamLine;
          setLines((previous) => [...previous, parsed]);
        } catch {
          // A malformed frame is not worth ending the search over.
        }
      };

      /*
       * The stream closing is the signal that the search finished.
       *
       * `EventSource` reports a normal server-side close as an error, so this
       * handler covers both "done" and "the connection dropped". Asking the
       * server which it was is more reliable than guessing from the event, and
       * it is where the results live anyway.
       */
      source.onerror = () => {
        source.close();
        sourceRef.current = null;

        void (async () => {
          const collected = await getDiscoveryAction(discoveryId);
          if (collected.ok) {
            setDrafts(collected.data.drafts);
            setPhase({ kind: 'done', id: discoveryId });
          } else {
            setPhase({ kind: 'failed', message: collected.error });
          }
        })();
      };
    })();
  };

  const busy = phase.kind === 'starting' || phase.kind === 'running';
  const considered = lines.filter((line) => line.step === 'reading').length;
  const rejected = lines.filter((line) => line.step === 'skipped').length;

  return (
    <section className="border border-black bg-white">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black px-6 py-4">
        <div>
          <h2 className="font-mondwest text-2xl leading-tight">Not seeing yours? Go and look.</h2>
          <p className="mt-1 max-w-[620px] font-mono text-[12px] leading-relaxed text-gray-600">
            Searches the live web through Bright Data for what you asked for, opens each promising
            page, and reads it. Takes about a minute.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="shrink-0 border border-black bg-black px-6 py-3 font-neuebit text-[12px] uppercase tracking-[0.14em] text-white transition-colors hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Searching the web...' : 'Search the live web'}
        </button>
      </div>

      {phase.kind === 'failed' ? (
        <p className="border-b border-gray-200 bg-amber-50 px-6 py-4 font-mono text-[12.5px] leading-relaxed text-amber-900">
          {phase.message}
        </p>
      ) : null}

      {lines.length > 0 ? (
        <div className="border-b border-gray-200">
          <div
            ref={logRef}
            className="max-h-[220px] overflow-y-auto bg-[#0c0c0a] px-6 py-4 font-mono text-[11.5px] leading-relaxed text-[#d7d3c8]"
          >
            {lines.map((line, index) => (
              <div
                key={index}
                className={
                  line.step === 'read'
                    ? 'text-emerald-400'
                    : line.step === 'skipped'
                      ? 'text-gray-500'
                      : line.step === 'error'
                        ? 'text-red-400'
                        : ''
                }
              >
                {line.line}
              </div>
            ))}
          </div>
          {busy ? null : (
            <p className="px-6 py-3 font-mono text-[11.5px] text-gray-500">
              Opened {considered} pages. {rejected} were listings, landing pages or articles about
              opportunities rather than opportunities, and were dropped rather than served with a
              caveat.
            </p>
          )}
        </div>
      ) : null}

      {drafts.length > 0 ? (
        <>
          <div className="border-b border-gray-200 bg-amber-50 px-6 py-4">
            <div className="font-neuebit text-[11px] uppercase tracking-[0.15em] text-amber-900">
              Found just now, and not yet verified
            </div>
            <p className="mt-2 max-w-[760px] font-mono text-[12px] leading-relaxed text-amber-900">
              One sensor read each of these pages once, a moment ago. There is no history to check
              them against and no second reading to agree with. That is a weaker claim than
              anything in the verified feed, so they are kept apart from it. Open the source before
              you plan around any date here.
            </p>
          </div>
          <ul className="divide-y divide-gray-200">
            {drafts.map((draft) => (
              <li key={draft.sourceUrl} className="px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <a
                      href={draft.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[13.5px] font-semibold underline decoration-gray-300 underline-offset-4 hover:decoration-black"
                    >
                      {draft.title}
                    </a>
                    <div className="mt-1 font-mono text-[11.5px] text-gray-500">
                      {draft.host} · {draft.type.replace('-', ' ')}
                      {draft.official ? ' · publishes funding directly' : ''}
                    </div>

                    <dl className="mt-3 grid gap-x-6 gap-y-1 font-mono text-[12px] sm:grid-cols-[auto_1fr]">
                      <dt className="text-gray-500">Closing date</dt>
                      <dd className={draft.deadlineRaw === null ? 'text-gray-400' : ''}>
                        {draft.deadlineRaw ?? 'not stated on the page'}
                      </dd>
                      <dt className="text-gray-500">Funding</dt>
                      <dd className={draft.fundingLevel === null ? 'text-gray-400' : ''}>
                        {draft.fundingLevel ?? 'not stated on the page'}
                      </dd>
                    </dl>

                    {draft.missing.length > 0 ? (
                      <p className="mt-3 font-mono text-[11.5px] leading-relaxed text-gray-500">
                        The page did not state: {draft.missing.join(', ').replace(/_/g, ' ')}. Left
                        blank rather than guessed.
                      </p>
                    ) : null}
                  </div>

                  <a
                    href={draft.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 border border-gray-300 px-4 py-2 font-neuebit text-[10.5px] uppercase tracking-[0.12em] text-gray-600 transition-colors hover:border-black hover:text-black"
                  >
                    Open source
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {phase.kind === 'done' && drafts.length === 0 ? (
        <p className="px-6 py-5 font-mono text-[12.5px] leading-relaxed text-gray-600">
          Nothing came back that was a single opportunity with a stated deadline or a stated amount.
          Search results for funding terms are dominated by roundups and landing pages, and those
          are dropped here rather than served as though they were the thing itself. Widening your
          interests, or asking for a different type, usually finds more.
        </p>
      ) : null}

      {remaining !== null && !busy ? (
        <p className="border-t border-gray-200 px-6 py-3 font-mono text-[11px] text-gray-400">
          {remaining} live searches left this hour. Each one makes real requests against the live
          web, so it is capped rather than unlimited.
        </p>
      ) : null}
    </section>
  );
}
