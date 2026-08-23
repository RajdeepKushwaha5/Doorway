import { describe, expect, it } from 'vitest';
import { parseRobots, isAllowed, checkWatchUrls } from './robots.js';

describe('parseRobots', () => {
  it('keeps consecutive user-agent lines in one group', () => {
    // Split into two groups, the first would have no rules at all and the
    // second would silently apply to only one of the two agents.
    const groups = parseRobots('User-agent: alpha\nUser-agent: beta\nDisallow: /private');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.agents).toEqual(['alpha', 'beta']);
    expect(groups[0]?.disallow).toEqual(['/private']);
  });

  it('treats an empty Disallow as permission rather than a rule', () => {
    const groups = parseRobots('User-agent: *\nDisallow:');
    expect(groups[0]?.disallow).toEqual([]);
    expect(isAllowed(groups, 'https://example.test/anything').allowed).toBe(true);
  });

  it('ignores comments and unparseable lines without dropping the rest', () => {
    const groups = parseRobots(
      '# a comment\nUser-agent: *\nthis line has no colon\nDisallow: /x  # trailing\n',
    );
    expect(groups[0]?.disallow).toEqual(['/x']);
  });
});

describe('isAllowed', () => {
  const rules = parseRobots(
    ['User-agent: *', 'Disallow: /admin', 'Disallow: /search', 'Allow: /search/public'].join('\n'),
  );

  it('refuses a disallowed path and quotes the directive that did it', () => {
    const verdict = isAllowed(rules, 'https://example.test/admin/users');
    expect(verdict.allowed).toBe(false);
    // The point of the quote is that a human can check the claim, so the rule
    // has to appear verbatim rather than as a paraphrase.
    if (!verdict.allowed) expect(verdict.rule).toBe('Disallow: /admin');
  });

  it('lets a longer Allow re-permit one page inside a disallowed directory', () => {
    expect(isAllowed(rules, 'https://example.test/search/public/list').allowed).toBe(true);
    expect(isAllowed(rules, 'https://example.test/search/private').allowed).toBe(false);
  });

  it('prefers a named group over the wildcard', () => {
    const named = parseRobots(
      ['User-agent: *', 'Disallow: /', '', 'User-agent: friendly', 'Disallow:'].join('\n'),
    );
    expect(isAllowed(named, 'https://example.test/x', 'friendly').allowed).toBe(true);
    expect(isAllowed(named, 'https://example.test/x', 'somebody-else').allowed).toBe(false);
  });

  it('honours * and $ wildcards', () => {
    const wild = parseRobots('User-agent: *\nDisallow: /*.pdf$');
    expect(isAllowed(wild, 'https://example.test/docs/a.pdf').allowed).toBe(false);
    expect(isAllowed(wild, 'https://example.test/docs/a.pdf.html').allowed).toBe(true);
  });

  it('does not let regex characters in a path change the meaning of a rule', () => {
    // `/a.b` must match a literal dot, not any character, or a site that
    // disallowed one path would be refusing others it never named.
    const dotted = parseRobots('User-agent: *\nDisallow: /a.b');
    expect(isAllowed(dotted, 'https://example.test/a.b').allowed).toBe(false);
    expect(isAllowed(dotted, 'https://example.test/axb').allowed).toBe(true);
  });

  it('allows everything when no group applies', () => {
    const other = parseRobots('User-agent: someone-else\nDisallow: /');
    expect(isAllowed(other, 'https://example.test/x').allowed).toBe(true);
  });
});

describe('checkWatchUrls', () => {
  it('refuses the disallowed URL and permits the rest of the same host', async () => {
    const checks = await checkWatchUrls(
      ['https://example.test/open', 'https://example.test/admin/x'],
      async () => 'User-agent: *\nDisallow: /admin',
    );
    expect(checks[0]?.allowed).toBe(true);
    expect(checks[1]?.allowed).toBe(false);
    expect(checks[1]?.detail).toContain('Disallow: /admin');
  });

  it('reads robots.txt once per origin', async () => {
    // Three URLs on one host must not be three fetches. A registration that
    // hammers robots.txt to decide whether it may read the site is impolite in
    // exactly the way this check exists to prevent.
    const asked: string[] = [];
    await checkWatchUrls(
      ['https://a.test/1', 'https://a.test/2', 'https://b.test/1'],
      async (url) => {
        asked.push(url);
        return 'User-agent: *\nDisallow:';
      },
    );
    expect(asked).toEqual(['https://a.test/robots.txt', 'https://b.test/robots.txt']);
  });

  it('treats an unreadable robots.txt as permission and says so', async () => {
    const checks = await checkWatchUrls(['https://example.test/x'], async () => null);
    expect(checks[0]?.allowed).toBe(true);
    // Permission granted for a stated reason, not silently.
    expect(checks[0]?.detail).toContain('no robots.txt');
  });

  it('does not throw on a value that is not a URL', async () => {
    const checks = await checkWatchUrls(['not a url'], async () => 'User-agent: *\nDisallow: /');
    expect(checks[0]?.allowed).toBe(true);
  });
});
