import { afterEach, describe, expect, it, vi } from 'vitest';
import { brightDataRequest } from './http.js';
import { BrightDataBalanceError, BrightDataRequestError } from './errors.js';

/**
 * An empty account must never be reported as a bad request.
 *
 * The generic 4xx class says the request itself is wrong, which near a
 * deadline sends somebody reading a payload that was correct while the actual
 * cause is a balance of zero. Every shape Bright Data uses to say this is
 * pinned here, because getting it wrong costs hours at the worst moment.
 */

afterEach(() => void vi.restoreAllMocks());

const respondWith = (status: number, body: string): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(body, { status, headers: { 'content-type': 'application/json' } }),
    ),
  );
};

const call = () =>
  brightDataRequest('key', 'https://api.brightdata.test', {
    method: 'POST',
    path: '/request',
    body: { zone: 'z', url: 'https://example.test' },
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
  });

describe('an account that cannot pay', () => {
  it('is named as such on a 402', async () => {
    respondWith(402, '{"error":"payment required"}');
    await expect(call()).rejects.toBeInstanceOf(BrightDataBalanceError);
  });

  for (const body of [
    '{"error":"insufficient balance"}',
    '{"message":"Insufficient funds to run this request"}',
    '{"error":"no available funds on the account"}',
    '{"error":"not enough balance"}',
    '{"error":"account is suspended due to billing issue"}',
  ]) {
    it(`is named as such when the body says so: ${body.slice(0, 34)}`, async () => {
      respondWith(400, body);
      await expect(call()).rejects.toBeInstanceOf(BrightDataBalanceError);
    });
  }

  it('does not swallow a genuinely malformed request', async () => {
    respondWith(400, '{"error":"zone is required"}');
    const error = await call().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(BrightDataRequestError);
    expect(error).not.toBeInstanceOf(BrightDataBalanceError);
  });
});
