import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

/**
 * The retry exists for a sleeping backend, and must never apply to a write.
 *
 * A repeated read costs nothing. A repeated `POST /api/doorway/world` runs the
 * live search again, which is real Bright Data requests against a real
 * balance. That distinction is the whole reason the retry is conditional, so
 * it is the thing worth pinning down.
 */

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

describe('api request retry', () => {
  beforeEach(() => {
    process.env['NOTICE_API_BASE'] = 'http://backend.test';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a read that failed while the backend was asleep', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(ok([{ id: 'c1' }]));
    vi.stubGlobal('fetch', fetchMock);

    const pending = api.listCollectors();
    await vi.runAllTimersAsync();

    expect(await pending).toEqual([{ id: 'c1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up on a read after the configured attempts, and says so', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('timed out'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = api.listCollectors().catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).message).toContain('attempts');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never retries a write, because a repeated search spends real money', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = api
      .doorwayWorld({
        country: 'India',
        educationLevel: 'Undergraduate',
        interests: [],
        skills: [],
        opportunityTypes: [],
        fundingRequirement: 'any',
        locations: [],
      })
      .catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    expect(await pending).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
