'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startObservationAction } from '@/app/actions';
import { apiBase } from '@/lib/env';

/**
 * Watch an observation reason, rather than waiting for its verdict.
 *
 * A real Scraper Studio run takes about thirty seconds, and until this existed
 * every one of them looked the same from outside: a disabled button, then an
 * answer. That hid the only genuinely interesting thing here. The verdict is
 * the least surprising part; how it was reached is the product.
 *
 * The stream is read over `EventSource`, which cannot send headers — so
 * starting the run (the part that spends Bright Data credits) goes through an
 * authenticated server action, and only the read-only log is fetched directly.
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

/** Colour carries the verdict here, exactly as it does everywhere else. */
function toneFor(event: StreamEvent): string {
  if (event.step === 'error') return 'text-blocked';
  if (event.step === 'verdict') {
    const verdict = String(event.detail?.['verdict'] ?? '');
    if (verdict === 'healthy') return 'text-verified';
    if (verdict === 'genuine_source_change') return 'text-verified';
    if (verdict === 'access_anomaly') return 'text-suspect';
    return 'text-blocked';
  }
  if (event.step === 'witness-identity') {
    if (event.detail?.['compared'] !== true) return 'text-muted';
    return event.detail['samePage'] === true ? 'text-verified' : 'text-blocked';
  }
  if (event.step === 'compare') {
    return String(event.detail?.['agreement'] ?? '') === 'disagree' ? 'text-blocked' : 'text-muted';
  }
  if (event.step === 'witness-read' || event.step === 'witness-fetch') return 'text-parse-accent';
  return 'text-muted';
}

export function DecisionStream({
  collectorId,
  url,
  label = 'Run the collector',
}: {
  collectorId: string;
  url?: string;
  label?: string;
}) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);

  // Close the socket if the component goes away mid-run, or the browser keeps
  // reconnecting to a stream nobody is reading.
  useEffect(() => {
    return () => sourceRef.current?.close();
  }, []);

  // A running clock, because the wait is real and hiding it would look broken.
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
    sourceRef.current?.close();
    setEvents([]);
    setElapsed(0);
    setPhase({ kind: 'starting' });

    void startObservationAction(collectorId, url).then((result) => {
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
      // Only treat it as fatal once the stream is actually closed.
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) {
          setPhase((current) =>
            current.kind === 'watching' ? { kind: 'done' } : current,
          );
        }
      };
    });
  }, [collectorId, url]);

  const busy = phase.kind === 'starting' || phase.kind === 'watching';
  const verdict = events.find((event) => event.step === 'verdict');

  return (
    <div className="font-mono">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-ivory px-6 py-3.5 text-[13px] font-semibold uppercase tracking-pixel text-surface-raised shadow-md transition-all hover:bg-ivory/85 disabled:opacity-40"
      >
        {busy ? `Observing… ${String(elapsed)}s` : `${label} ▸`}
      </button>

      {events.length > 0 || busy ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-surface-border bg-[#0C0C0A]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-[10px] uppercase tracking-pixel text-white/50">
              live decision stream
            </span>
            <span className="text-[10px] tracking-pixel text-white/40">
              {phase.kind === 'done' ? 'complete' : `${String(elapsed)}s`}
            </span>
          </div>

          <div ref={logRef} className="max-h-[280px] overflow-y-auto p-3 text-[11.5px] leading-6">
            {events.map((event, index) => (
              <div key={`${event.at}-${String(index)}`} className="flex gap-3">
                <span className="shrink-0 text-white/30">{event.at.slice(11, 19)}</span>
                <span className={`${toneFor(event)} whitespace-pre-wrap break-words`}>
                  {event.line}
                </span>
              </div>
            ))}

            {busy ? (
              <div className="flex gap-3 text-white/40">
                <span className="shrink-0">{'--:--:--'}</span>
                <span className="animate-pulse">
                  {events.length === 0 ? 'starting a real Scraper Studio run…' : '…'}
                </span>
              </div>
            ) : null}
          </div>

          {verdict !== undefined ? (
            <div className="border-t border-white/10 px-3 py-2 text-[11px] text-white/70">
              {String(verdict.detail?.['action'] ?? '')}
            </div>
          ) : null}
        </div>
      ) : null}

      {phase.kind === 'failed' ? (
        <p className="mt-3 rounded border border-blocked/30 bg-red-50 p-2.5 text-[12px] leading-normal text-blocked">
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
