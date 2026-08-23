import { describe, expect, it, vi, afterEach } from 'vitest';
import { isRead, wakePolicy, wakeFetch, wakeFailureNote } from './wake';

/**
 * The path that decides whether a first-time visitor sees the site.
 *
 * Both hosts sleep after fifteen minutes idle, so the person arriving cold is
 * the person whose request does the waking. Every rule here exists because
 * getting it wrong shows somebody an error page for a service that was about
 * to answer.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what may be retried', () => {
  it('treats a missing method as a read, because fetch does', () => {
    expect(isRead(undefined)).toBe(true);
    expect(wakePolicy(undefined).attempts).toBeGreaterThan(1);
  });

  it('never retries anything that writes', () => {
    // A repeated POST can start a second live search or flip the fixture
    // twice. Both cost money or confuse a demonstration.
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(isRead(method)).toBe(false);
      expect(wakePolicy(method).attempts).toBe(1);
    }
  });

  it('gives a write longer than a read, since patience is its only defence', () => {
    // The bug this pins: writes originally got one twenty-second attempt,
    // which gives up while a free-plan host is still starting, so pressing the
    // fault switch on a sleeping fixture failed for no visible reason.
    const read = wakePolicy('GET');
    const write = wakePolicy('POST');
    expect(write.timeoutMs).toBeGreaterThan(read.timeoutMs);
    expect(write.timeoutMs).toBeGreaterThanOrEqual(40_000);
  });

  it('allows a read enough total time to outlast a cold start', () => {
    const { attempts, timeoutMs } = wakePolicy('GET');
    expect(attempts * timeoutMs).toBeGreaterThanOrEqual(60_000);
  });
});

describe('wakeFetch', () => {
  it('returns the answer once the host wakes', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error('timed out'));
      return Promise.resolve(new Response('ok'));
    });

    const response = await wakeFetch('https://example.test/a');
    expect(response.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('sends a write exactly once, even when it fails', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      return Promise.reject(new Error('timed out'));
    });

    await expect(wakeFetch('https://example.test/a', { method: 'POST' })).rejects.toThrow(
      'timed out',
    );
    expect(calls).toBe(1);
  });

  it('reports the last failure rather than a generic one', async () => {
    // The caller renders this next to a button, so it has to say what happened.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    await expect(wakeFetch('https://example.test/a')).rejects.toThrow('ECONNREFUSED');
  });

  it('does not retry a response, only a failure to get one', async () => {
    // A 500 is an answer. Asking again wastes a visitor's time and, on a
    // write, could act twice.
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      return Promise.resolve(new Response('nope', { status: 500 }));
    });

    const response = await wakeFetch('https://example.test/a');
    expect(response.status).toBe(500);
    expect(calls).toBe(1);
  });
});

describe('wakeFailureNote', () => {
  it('says what was tried, in the words of what actually happened', () => {
    expect(wakeFailureNote('GET')).toMatch(/attempts/);
    expect(wakeFailureNote('POST')).not.toMatch(/attempts/);
  });
});
