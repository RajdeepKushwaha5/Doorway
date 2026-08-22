'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { manufactureCollectorAction } from '@/app/actions';
import { apiBase } from '@/lib/env';

/**
 * Give it a page. It builds a sensor for it.
 *
 * The rest of this site shows what six collectors found. This shows one being
 * made, which is the part a reader has otherwise to take on trust. A `c_*` id
 * on a fleet listing says a scraper exists; watching the brief get written from
 * the page, and the page's competing dates get named, says how it came to.
 *
 * The wait is real and is not hidden. Generation took 97 seconds against a
 * simple page and Bright Data allows up to twenty five minutes for a complex
 * one, so this reports each named step as it arrives rather than spinning. A
 * viewer who sees `output_schema_generator` follow `user_intent_analyzer`
 * knows something is happening to their page; a spinner for two minutes reads
 * as a hang.
 */

interface StreamEvent {
  at: string;
  step: string;
  line: string;
  detail?: Record<string, unknown>;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'watching'; id: string }
  | { kind: 'done' }
  | { kind: 'failed'; message: string };

/** Colour carries the same meaning it does everywhere else on this site. */
function toneFor(step: string): string {
  if (step === 'error') return 'text-red-400';
  if (step === 'done' || step === 'registered' || step === 'generated') return 'text-emerald-400';
  if (step === 'brief') return 'text-amber-300';
  if (step === 'composing') return 'text-gray-300';
  return 'text-gray-400';
}

export function SensorFoundry({ disabledReason }: { disabledReason?: string }) {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const sourceRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => sourceRef.current?.close(), []);

  // The wait is the point. Hiding it would make a two minute job look broken.
  useEffect(() => {
    if (phase.kind !== 'watching' && phase.kind !== 'starting') return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [phase.kind]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [events.length]);

  const start = useCallback(() => {
    const target = url.trim();
    if (target === '') return;

    sourceRef.current?.close();
    setEvents([]);
    setElapsed(0);
    setPhase({ kind: 'starting' });

    void manufactureCollectorAction(target).then((result) => {
      if (!result.ok) {
        setPhase({ kind: 'failed', message: result.error });
        return;
      }

      const id = result.data.observationId;
      setPhase({ kind: 'watching', id });

      const source = new EventSource(`${apiBase()}/api/observations/${id}/events`);
      sourceRef.current = source;

      source.onmessage = (message) => {
        try {
          setEvents((current) => [...current, JSON.parse(message.data) as StreamEvent]);
        } catch {
          /* a malformed frame is not worth failing the view over */
        }
      };

      source.addEventListener('done', () => {
        source.close();
        setPhase({ kind: 'done' });
      });

      // Fires on a dropped connection too, and EventSource retries by itself.
      // Only fatal once the stream is actually closed.
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) {
          setPhase((current) => (current.kind === 'watching' ? { kind: 'done' } : current));
        }
      };
    });
  }, [url]);

  const busy = phase.kind === 'starting' || phase.kind === 'watching';
  const blocked = disabledReason !== undefined;
  const collectorId = events
    .map((event) => event.detail?.['brightDataCollectorId'])
    .find((value): value is string => typeof value === 'string');

  return (
    <div className="border border-black bg-white">
      <div className="flex items-center justify-between border-b border-black px-4 py-3">
        <span className="font-neuebit text-[10.5px] uppercase tracking-[0.14em]">
          Build a sensor for any page
        </span>
        {busy ? (
          <span className="font-mono text-[10.5px] tabular-nums text-gray-500">{elapsed}s</span>
        ) : null}
      </div>

      <div className="p-4">
        <p className="font-mono text-[12px] leading-relaxed text-gray-600">
          Paste a public funding page. Doorway reads it through Bright Data, decides what is worth
          extracting and what would be a trap, writes the brief, and has Scraper Studio build a
          scraper from it. Roughly two minutes for a simple page.
        </p>

        {blocked ? (
          <p className="mt-4 border border-gray-200 bg-gray-50 p-4 font-mono text-[12px] leading-relaxed text-gray-600">
            {disabledReason}
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !busy) start();
              }}
              placeholder="https://example.org/fellowship"
              spellCheck={false}
              className="min-w-0 flex-1 border border-gray-300 px-3 py-2 font-mono text-[12.5px] focus:border-black focus:outline-none"
            />
            <button
              type="button"
              onClick={start}
              disabled={busy || url.trim() === ''}
              className="border border-black bg-black px-4 py-2 font-neuebit text-[11px] uppercase tracking-[0.12em] text-white transition-opacity disabled:opacity-40"
            >
              {busy ? 'Building' : 'Build a sensor'}
            </button>
          </div>
        )}

        {phase.kind === 'failed' ? (
          <p className="mt-4 border-l-2 border-red-500 bg-red-50/60 px-4 py-3 font-mono text-[12px] leading-relaxed text-red-800">
            {phase.message}
          </p>
        ) : null}

        {events.length > 0 ? (
          <>
            <div
              ref={logRef}
              className="mt-4 max-h-[340px] overflow-y-auto border border-gray-800 bg-gray-950 p-4 font-mono text-[11.5px] leading-relaxed"
            >
              {events.map((event, index) => (
                <div key={`${event.at}-${String(index)}`} className={toneFor(event.step)}>
                  <span className="mr-3 text-gray-600">{event.step.padEnd(11, ' ')}</span>
                  {event.line}
                </div>
              ))}
              {busy ? <span className="inline-block h-3 w-2 animate-pulse bg-emerald-400" /> : null}
            </div>

            {collectorId === undefined ? null : (
              <p className="mt-3 font-mono text-[11.5px] leading-relaxed text-gray-600">
                This scraper now exists on the Bright Data account as{' '}
                <code className="text-black">{collectorId}</code>. It can be opened in Scraper
                Studio, and it is a production endpoint from the moment it is created.
              </p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
