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

describe('retrying an unlock failure', () => {
  it('retries a block, because each attempt uses a different peer', async () => {
    // Bright Data's reference: "Retrying is worth doing for errors caused by
    // the peer or by the unlock attempt." A transient block that failed
    // permanently turned a readable page into a quarantined incident, which is
    // a false alarm dressed up as caution.
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempts += 1;
        return attempts === 1
          ? respond('blocked', { 'x-brd-error-code': 'reject_block', 'x-brd-status-code': '502' })
          : respond('# Nova Headphones\n\nPrice: $249', { 'x-brd-status-code': '200' });
      }),
    );

    const result = await fetchWitnessMarkdown(
      { apiKey: 'k', zone: 'z', retryPolicy: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 } },
      URL_UNDER_TEST,
    );

    expect(attempts).toBe(2);
    expect(result.markdown).toContain('$249');
  });

  it('does not retry a certificate error, which returns the same answer every time', async () => {
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempts += 1;
        return respond('bad cert', {
          'x-brd-error-code': 'net_err_cert_date_invalid',
          'x-brd-status-code': '502',
        });
      }),
    );

    await expect(
      fetchWitnessMarkdown(
        { apiKey: 'k', zone: 'z', retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 } },
        URL_UNDER_TEST,
      ),
    ).rejects.toThrow(/net_err_cert_date_invalid/);

    // Spending three more requests to be told the same thing helps nobody.
    expect(attempts).toBe(1);
  });
});

describe('device consistency between sensors', () => {
  it('requests desktop by default and says so', async () => {
    // Two sensors are comparable only if they saw the same page, and a mobile
    // layout is a different page. Recording which was asked for is what lets
    // a mismatch be called an access anomaly instead of extractor drift.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond('# Page\n\nPrice: $10', { 'x-brd-status-code': '200' })),
    );

    const result = await fetchWitnessMarkdown(CONFIG, URL_UNDER_TEST);
    expect(result.deviceType).toBe('desktop');

    const body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    // Desktop is the API's own default, so nothing needs sending for it.
    expect(body['ua']).toBeUndefined();
  });

  it('asks for a mobile layout when told to, and reports it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond('# Page\n\nPrice: $10', { 'x-brd-status-code': '200' })),
    );

    const result = await fetchWitnessMarkdown({ ...CONFIG, device: 'mobile' }, URL_UNDER_TEST);
    expect(result.deviceType).toBe('mobile');

    const body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect(body['ua']).toBe('mobile');
  });
});
