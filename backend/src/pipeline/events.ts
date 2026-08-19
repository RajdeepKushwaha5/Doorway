import { randomUUID } from 'node:crypto';

/**
 * The reasoning, published as it happens.
 *
 * An observation takes about thirty seconds, almost all of it waiting on a real
 * Scraper Studio run, and until now every one of those seconds looked identical
 * from outside: a disabled button, then a verdict. That hides the only
 * interesting thing this project does. The verdict is the least surprising part
 * of it; how the verdict was reached is the product.
 *
 * These events are not new telemetry. The pipeline already computes every one
 * of them and already records most as state transitions on the incident. This
 * only gives them somewhere to go while the run is still in flight.
 *
 * Every event carries a preformatted `line` so a consumer can render a console
 * without understanding the union, and structured fields beside it so a richer
 * consumer does not have to parse prose.
 */

export type ObserveStep =
  | 'triggering'
  | 'rows'
  | 'contracts'
  | 'witness-skip'
  | 'witness-wake'
  | 'witness-fetch'
  | 'witness-read'
  | 'compare'
  | 'verdict'
  | 'error';

export interface ObserveEvent {
  at: string;
  step: ObserveStep;
  /** One line, already formatted for a terminal-style view. */
  line: string;
  /** Machine-readable payload. Shape varies by step; consumers may ignore it. */
  detail?: Record<string, unknown>;
}

export type ObserveEmitter = (event: Omit<ObserveEvent, 'at'>) => void;

/** A single observation's stream, from trigger to verdict. */
interface Observation {
  id: string;
  collectorId: string;
  url: string;
  startedAt: number;
  events: ObserveEvent[];
  done: boolean;
  subscribers: Set<(event: ObserveEvent | null) => void>;
}

/**
 * Keeps recent observations in memory so a late subscriber sees the whole story.
 *
 * A browser cannot open its stream until the request that started the run has
 * returned, so it is always a little late. Without replay it would miss the
 * trigger and the first contract results, which is most of what makes the log
 * worth watching. Every subscriber therefore receives the buffer first and the
 * live tail after.
 *
 * Bounded on purpose. This is a demonstration surface, not an audit log: the
 * durable record of any observation is the run and the incident in the store,
 * and holding streams forever would be a slow leak in a long-lived process.
 */
export class ObservationBroker {
  readonly #observations = new Map<string, Observation>();
  readonly #limit: number;
  readonly #now: () => number;

  constructor(limit = 20, now: () => number = () => Date.now()) {
    this.#limit = limit;
    this.#now = now;
  }

  start(collectorId: string, url: string): string {
    const id = randomUUID();
    this.#observations.set(id, {
      id,
      collectorId,
      url,
      startedAt: this.#now(),
      events: [],
      done: false,
      subscribers: new Set(),
    });
    this.#evict();
    return id;
  }

  /** An emitter bound to one observation, safe to pass into the pipeline. */
  emitterFor(id: string): ObserveEmitter {
    return (event) => {
      const observation = this.#observations.get(id);
      if (observation === undefined || observation.done) return;

      const full: ObserveEvent = { ...event, at: new Date(this.#now()).toISOString() };
      observation.events.push(full);
      for (const notify of observation.subscribers) notify(full);
    };
  }

  /** No more events will follow. Subscribers are told, then released. */
  finish(id: string): void {
    const observation = this.#observations.get(id);
    if (observation === undefined || observation.done) return;
    observation.done = true;
    for (const notify of observation.subscribers) notify(null);
    observation.subscribers.clear();
  }

  has(id: string): boolean {
    return this.#observations.has(id);
  }

  /**
   * Replay what has happened, then follow along.
   *
   * Returns an unsubscribe function. When the observation has already finished,
   * the buffer is delivered and the stream closed immediately, so a client that
   * arrives late still gets the full log rather than an empty one.
   */
  subscribe(id: string, notify: (event: ObserveEvent | null) => void): () => void {
    const observation = this.#observations.get(id);
    if (observation === undefined) {
      notify(null);
      return () => undefined;
    }

    for (const event of observation.events) notify(event);
    if (observation.done) {
      notify(null);
      return () => undefined;
    }

    observation.subscribers.add(notify);
    return () => observation.subscribers.delete(notify);
  }

  /** Oldest first, and never one still being watched. */
  #evict(): void {
    while (this.#observations.size > this.#limit) {
      const oldest = [...this.#observations.values()]
        .filter((candidate) => candidate.subscribers.size === 0)
        .sort((a, b) => a.startedAt - b.startedAt)[0];
      if (oldest === undefined) return;
      this.#observations.delete(oldest.id);
    }
  }
}

/** Shorten a value for a console line without hiding that it was shortened. */
export function brief(value: unknown, max = 48): string {
  if (value === null || value === undefined) return 'nothing';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) {
      const currency = typeof record['currency'] === 'string' ? ` ${record['currency']}` : '';
      return `${String(record['value'])}${currency}`;
    }
  }
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
