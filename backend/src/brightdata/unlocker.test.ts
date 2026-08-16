import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWitnessMarkdown } from './unlocker.js';

/**
 * A 200 from Web Unlocker does not mean the page was read.
 *
 * Bright Data's reference states it plainly: the outer response is 200 once
 * the request reaches the unlocker, and the real outcome lives in
 * `x-brd-status-code`, with failures also carrying `x-brd-error` and usually
 * `x-brd-error-code`.
 *
 * The witness is the sensor the rest of the system trusts to decide whether a
 * collector is broken. Accepting an unlock failure as page content would let
 * NOTICE reach a confident verdict from an error page, so every case below
 * must throw rather than return a document.
 */

const CONFIG = { apiKey: 'test-key', zone: 'test_zone', retryPolicy: { maxRetries: 0 } } as const;
const URL_UNDER_TEST = 'https://example.com/product';

function respond(body: string, headers: Record<string, string>): Response {
  return new Response(body, { status: 200, headers });
}

afterEach(() => void vi.restoreAllMocks());

describe('the witness refuses anything that is not a page', () => {
  it('rejects an unlock failure reported in headers behind a 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond('<html>blocked</html>', {
          'x-brd-error': 'Navigation failed',
          'x-brd-error-code': 'reject_block',
          'x-brd-status-code': '502',
        }),
      ),
    );

    await expect(fetchWitnessMarkdown(CONFIG, URL_UNDER_TEST)).rejects.toThrow(/reject_block/);
  });

  it('rejects a proxy-level error code, which uses a different header name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond('nope', { 'x-brd-err-code': 'policy_20020', 'x-brd-status-code': '403' }),
      ),
    );

    await expect(fetchWitnessMarkdown(CONFIG, URL_UNDER_TEST)).rejects.toThrow(/policy_20020/);
  });

  it("rejects the target's own 404, which is not a page either", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond('Not Found', { 'x-brd-status-code': '404' })),
    );

    await expect(fetchWitnessMarkdown(CONFIG, URL_UNDER_TEST)).rejects.toThrow(/404/);
  });

  it('rejects an empty document rather than reporting a page with nothing on it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond('   ', { 'x-brd-status-code': '200' })),
    );

    // Caught a layer earlier: the request helper turns a whitespace-only body
    // into null, so this lands on the "no document" guard rather than the
    // empty-string one. Both refuse, which is what matters. Asserting the
    // behaviour rather than the wording keeps this test about the contract.
    await expect(fetchWitnessMarkdown(CONFIG, URL_UNDER_TEST)).rejects.toThrow(
      /no document body|empty document/,
    );
  });

  it('accepts a genuine success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond('# Nova Headphones\n\nPrice: $249', { 'x-brd-status-code': '200' })),
    );

    const result = await fetchWitnessMarkdown(CONFIG, URL_UNDER_TEST);
    expect(result.markdown).toContain('Price: $249');
    expect(result.url).toBe(URL_UNDER_TEST);
  });

  it('refuses a private address before any request is made', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    await expect(fetchWitnessMarkdown(CONFIG, 'http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /private or loopback/,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
