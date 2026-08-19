import { describe, expect, it, vi } from 'vitest';
import { ObservationBroker, brief } from './events.js';

/**
 * The stream exists so a person can watch a thirty-second run think. Two
 * properties make that work and neither is obvious:
 *
 * a subscriber always arrives late, because the browser cannot open the stream
 * until the request that started the run has returned, so the buffer has to be
 * replayed or the first and most interesting lines are lost;
 *
 * and nothing here may ever affect a verdict, so a consumer that throws is the
 * consumer's problem alone.
 */

describe('the observation broker', () => {
  it('replays everything that already happened to a late subscriber', () => {
    const broker = new ObservationBroker();
    const id = broker.start('col-1', 'https://example.test/p');
    const emit = broker.emitterFor(id);

    emit({ step: 'triggering', line: 'triggering c_abc' });
    emit({ step: 'rows', line: 'row returned price: 25' });

    const seen: string[] = [];
    broker.subscribe(id, (event) => {
      if (event !== null) seen.push(event.line);
    });

    expect(seen).toEqual(['triggering c_abc', 'row returned price: 25']);
  });

  it('streams events that arrive after a subscriber attaches', () => {
    const broker = new ObservationBroker();
    const id = broker.start('col-1', 'https://example.test/p');

    const seen: string[] = [];
    broker.subscribe(id, (event) => {
      if (event !== null) seen.push(event.line);
    });

    broker.emitterFor(id)({ step: 'verdict', line: 'verdict extractor_drift' });
    expect(seen).toEqual(['verdict extractor_drift']);
  });

  it('signals the end with a null, once', () => {
    const broker = new ObservationBroker();
    const id = broker.start('col-1', 'https://example.test/p');

    let ended = 0;
    broker.subscribe(id, (event) => {
      if (event === null) ended += 1;
    });

    broker.finish(id);
    broker.finish(id);
    expect(ended).toBe(1);
  });

  /** A viewer who arrives after the run finished still deserves the log. */
  it('gives a finished observation its full buffer, then closes', () => {
    const broker = new ObservationBroker();
    const id = broker.start('col-1', 'https://example.test/p');
    broker.emitterFor(id)({ step: 'rows', line: 'row returned' });
    broker.finish(id);

    const seen: (string | null)[] = [];
    broker.subscribe(id, (event) => seen.push(event === null ? null : event.line));

    expect(seen).toEqual(['row returned', null]);
  });

  it('closes immediately for an observation it has never heard of', () => {
    const broker = new ObservationBroker();
    const seen: unknown[] = [];
    broker.subscribe('nope', (event) => seen.push(event));
    expect(seen).toEqual([null]);
  });

  it('accepts no further events once finished', () => {
    const broker = new ObservationBroker();
    const id = broker.start('col-1', 'https://example.test/p');
    broker.finish(id);
    broker.emitterFor(id)({ step: 'rows', line: 'too late' });

    const seen: string[] = [];
    broker.subscribe(id, (event) => {
      if (event !== null) seen.push(event.line);
    });
    expect(seen).toEqual([]);
  });

  /**
   * A long-lived process must not accumulate streams. The store holds the
   * durable record; this is a viewing surface with a short memory.
   */
  it('evicts the oldest observations nobody is watching', () => {
    let clock = 0;
    const broker = new ObservationBroker(3, () => (clock += 1000));
    const ids = [1, 2, 3, 4, 5].map(() => broker.start('col-1', 'https://example.test/p'));

    expect(broker.has(ids[0] as string)).toBe(false);
    expect(broker.has(ids[1] as string)).toBe(false);
    expect(broker.has(ids[4] as string)).toBe(true);
  });

  it('keeps an observation somebody is still watching', () => {
    let clock = 0;
    const broker = new ObservationBroker(2, () => (clock += 1000));
    const watched = broker.start('col-1', 'https://example.test/p');
    broker.subscribe(watched, () => undefined);

    broker.start('col-1', 'https://example.test/p');
    broker.start('col-1', 'https://example.test/p');
    broker.start('col-1', 'https://example.test/p');

    expect(broker.has(watched)).toBe(true);
  });
});

describe('brief', () => {
  it('unwraps a money object to something a console line can hold', () => {
    expect(brief({ value: 249, currency: 'USD' })).toBe('249 USD');
  });

  it('says nothing rather than null, because a log is read by a person', () => {
    expect(brief(null)).toBe('nothing');
    expect(brief(undefined)).toBe('nothing');
  });

  it('marks a truncation instead of silently cutting', () => {
    const out = brief('x'.repeat(80), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('an emitter that throws', () => {
  it('is the consumer\'s problem, never the pipeline\'s', () => {
    const broker = new ObservationBroker();
    const id = broker.start('col-1', 'https://example.test/p');
    broker.subscribe(id, () => {
      throw new Error('a subscriber blew up');
    });

    // The broker itself does not guard; observeOnce wraps every emit. What is
    // asserted here is that one bad subscriber cannot be silently swallowed
    // into corrupting the buffer for everyone else.
    expect(() => broker.emitterFor(id)({ step: 'rows', line: 'row' })).toThrow();
    const seen: string[] = [];
    broker.subscribe(id, (event) => {
      if (event !== null) seen.push(event.line);
    });
    expect(seen).toEqual(['row']);
  });
});

describe('observeOnce, when a consumer throws', () => {
  it('does not let a broken log change the outcome', async () => {
    const { observeOnce } = await import('./observe.js');
    const thrower = vi.fn(() => {
      throw new Error('nope');
    });

    // Only the emitter is exercised: the call fails later for want of a real
    // client, and what matters is that it fails there rather than at the log.
    await expect(
      observeOnce(
        { id: 'c', brightDataCollectorId: 'c_x', watchUrls: ['https://e.test'] } as never,
        'https://e.test',
        { client: {} as never, store: {} as never, onEvent: thrower },
      ),
    ).rejects.not.toThrow(/nope/);

    expect(thrower).toHaveBeenCalled();
  });
});
