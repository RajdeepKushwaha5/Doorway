import { describe, expect, it } from 'vitest';
import { canonical, Frontier } from './frontier.js';
import { harvestLinks, looksHarvestable } from './harvest.js';

/**
 * A crawl is only as good as its queue.
 *
 * Without one the system opened a dozen pages per request, threw away
 * everything it learned, and started from nothing next time. The properties
 * below are what make the work compound instead of evaporating, and each of
 * them is a way a naive crawler fails.
 */

describe('the frontier', () => {
  it('never offers the same page twice', () => {
    const frontier = new Frontier();
    expect(frontier.add({ url: 'https://a.test/x', depth: 0 })).toBe(true);
    expect(frontier.add({ url: 'https://a.test/x', depth: 0 })).toBe(false);
    // The same scholarship is linked from forty aggregators. Fetching it forty
    // times spends forty page loads to learn one fact.
    expect(frontier.add({ url: 'https://www.a.test/x/', depth: 1 })).toBe(false);
    expect(frontier.size).toBe(1);
  });

  it('treats trailing slashes, www and scheme as the same page', () => {
    expect(canonical('http://www.Example.com/a/')).toBe(canonical('https://example.com/a'));
  });

  /*
   * Depth-first is the natural shape of a naive crawl and the wrong one: follow
   * every link you find and you end up inside whichever site has the most
   * internal navigation, holding one site's opinion of the world.
   */
  it('spreads a batch across hosts rather than draining one', () => {
    const frontier = new Frontier();
    for (let i = 0; i < 20; i++) frontier.add({ url: `https://big.test/${String(i)}`, depth: 0 });
    for (let i = 0; i < 3; i++) frontier.add({ url: `https://small.test/${String(i)}`, depth: 0 });

    const batch = frontier.take(6);
    const hosts = new Set(batch.map((entry) => entry.host));
    expect(hosts.size).toBe(2);
    // Not fifteen from the big one and one from the small one.
    expect(batch.filter((e) => e.host === 'small.test').length).toBeGreaterThanOrEqual(2);
  });

  it('will not take more than a host is allowed to give', () => {
    const frontier = new Frontier({ maxFetches: 100, maxPerHost: 3, maxDepth: 3 });
    for (let i = 0; i < 20; i++) frontier.add({ url: `https://one.test/${String(i)}`, depth: 0 });
    expect(frontier.take(20)).toHaveLength(3);
  });

  /* Every fetch is a paid request. A queue that cannot run out of money is a
   * way to discover your billing limit. */
  it('stops at the ceiling however much is queued', () => {
    const frontier = new Frontier({ maxFetches: 5, maxPerHost: 100, maxDepth: 3 });
    for (let i = 0; i < 50; i++) frontier.add({ url: `https://a.test/${String(i)}`, depth: 0 });
    expect(frontier.take(50)).toHaveLength(5);
    expect(frontier.exhausted).toBe(true);
    expect(frontier.take(10)).toHaveLength(0);
  });

  it('refuses links further out than the crawl is allowed to go', () => {
    const frontier = new Frontier({ maxFetches: 100, maxPerHost: 100, maxDepth: 1 });
    expect(frontier.add({ url: 'https://a.test/near', depth: 1 })).toBe(true);
    expect(frontier.add({ url: 'https://a.test/far', depth: 2 })).toBe(false);
  });
});

describe('harvesting a listing page', () => {
  const listing = `
# 50 Fully Funded Scholarships

* [IndiaAI Fellowship](https://indiaai.gov.in/fellowship)
* [Adobe Research Scholarship](/scholarships/adobe)
* [Read more](https://blog.test/privacy)
* [Log in](https://site.test/login)
* [Share on Facebook](https://facebook.com/share)
* [Oxford AI Grant](https://ox.ac.uk/grant-ai)
* [Brochure](https://site.test/file.pdf)
`;

  it('turns one page into many frontier entries', () => {
    const links = harvestLinks(listing, 'https://site.test/roundup');
    const urls = links.map((link) => link.url);

    expect(urls).toContain('https://indiaai.gov.in/fellowship');
    expect(urls).toContain('https://ox.ac.uk/grant-ai');
    // Relative hrefs are most of a listing page, and a crawler that only
    // understands absolute URLs harvests a fraction of what is there.
    expect(urls).toContain('https://site.test/scholarships/adobe');
  });

  it('leaves out what is never an opportunity', () => {
    const urls = harvestLinks(listing, 'https://site.test/roundup').map((l) => l.url);
    expect(urls.some((u) => u.includes('facebook.com'))).toBe(false);
    expect(urls.some((u) => u.includes('/login'))).toBe(false);
    expect(urls.some((u) => u.endsWith('.pdf'))).toBe(false);
    expect(urls.some((u) => u.includes('/privacy'))).toBe(false);
  });

  it('drops tracking parameters that make one page look like many', () => {
    const links = harvestLinks(
      '[Scholarship](https://a.test/x?utm_source=news&id=7)',
      'https://site.test/roundup',
    );
    expect(links[0]?.url).toBe('https://a.test/x?id=7');
  });

  /*
   * This is the observation the whole crawl rests on: the pages discovery
   * throws away are the cheapest reach available.
   */
  it('recognises a page whose value is its links', () => {
    const many = Array.from(
      { length: 10 },
      (_, i) => `* [Scholarship ${String(i)}](https://x${String(i)}.test/scholarship)`,
    ).join('\n');
    expect(looksHarvestable(many, 'https://site.test/list')).toBe(true);
    expect(looksHarvestable('# One Fellowship\n\nApply by 1 May 2027.', 'https://a.test/f')).toBe(
      false,
    );
  });
});
