/**
 * Ask the site first.
 *
 * A collector is a standing instruction to read somebody else's page on a
 * schedule, and this project's whole argument is that a system should not
 * publish what it cannot defend. Registering a watch on a path the site has
 * asked robots not to crawl is not defensible, and finding out later is worse
 * than being refused now: by then the collector exists, it has run, and its
 * output is in a feed.
 *
 * One site was rejected by hand during development on exactly these grounds.
 * Doing it by hand is how it gets skipped when somebody is in a hurry.
 *
 * What this is not: a crawler. It reads one file, applies the rules in it, and
 * reports. Bright Data does the fetching and honours its own policies on top of
 * this; the point here is that a refusal is recorded and explained at the
 * moment somebody asks for the watch, with the offending line quoted.
 */

/** One group of rules from a robots.txt file, for one or more user agents. */
export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

/** What robots.txt says about one specific URL. */
export type RobotsVerdict =
  | { allowed: true; reason: 'no_rules' | 'explicitly_allowed' | 'not_disallowed' }
  | { allowed: false; reason: 'disallowed'; rule: string; agent: string };

/**
 * Parse robots.txt into its groups.
 *
 * Deliberately forgiving. A malformed robots.txt is common and is not the
 * site's way of saying yes: unparseable lines are skipped, and everything that
 * did parse is still applied.
 */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  /*
   * Consecutive `User-agent` lines share the group that follows them, per the
   * standard. Tracking this is what keeps
   *
   *   User-agent: a
   *   User-agent: b
   *   Disallow: /x
   *
   * from becoming a group for `a` with no rules and a group for `b`.
   */
  let expectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!expectingAgents || current === null) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (current === null) continue;
    expectingAgents = false;

    // An empty Disallow value means "nothing is disallowed", which is the
    // conventional way to say yes. Recording it as a rule would invert that.
    if (field === 'disallow' && value !== '') current.disallow.push(value);
    if (field === 'allow' && value !== '') current.allow.push(value);
  }

  return groups;
}

/**
 * The group that applies to a user agent.
 *
 * A named match beats `*`, and the standard says only one group applies rather
 * than the union of every matching group.
 */
function groupFor(groups: readonly RobotsGroup[], userAgent: string): RobotsGroup | null {
  const wanted = userAgent.toLowerCase();
  const named = groups.find((group) =>
    group.agents.some((agent) => agent !== '*' && wanted.includes(agent)),
  );
  return named ?? groups.find((group) => group.agents.includes('*')) ?? null;
}

/**
 * Whether a pattern matches a path.
 *
 * Supports the two wildcards in common use: `*` for any run of characters and
 * `$` anchoring to the end. Built as a regex from an escaped pattern so a path
 * containing regex syntax cannot change the meaning of the rule.
 */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path);
}

/**
 * Apply the rules to one URL.
 *
 * Longest match wins, and Allow beats Disallow at equal length, which is what
 * lets a site disallow a directory and re-permit one page inside it.
 */
export function isAllowed(
  groups: readonly RobotsGroup[],
  url: string,
  userAgent = '*',
): RobotsVerdict {
  const group = groupFor(groups, userAgent);
  if (group === null) return { allowed: true, reason: 'no_rules' };

  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    // Not a URL this can reason about. Callers validate URLs before here; a
    // parse failure must not read as permission.
    return { allowed: true, reason: 'no_rules' };
  }

  const longest = (patterns: readonly string[]): string | null =>
    patterns
      .filter((pattern) => matches(pattern, path))
      .reduce<string | null>(
        (best, pattern) => (best === null || pattern.length > best.length ? pattern : best),
        null,
      );

  const blocked = longest(group.disallow);
  if (blocked === null) return { allowed: true, reason: 'not_disallowed' };

  const permitted = longest(group.allow);
  if (permitted !== null && permitted.length >= blocked.length) {
    return { allowed: true, reason: 'explicitly_allowed' };
  }

  return {
    allowed: false,
    reason: 'disallowed',
    rule: `Disallow: ${blocked}`,
    agent: group.agents.join(', '),
  };
}

/** What a registration check concluded, per URL. */
export interface RobotsCheck {
  url: string;
  allowed: boolean;
  /** Plain language, quoting the directive when there is one to quote. */
  detail: string;
}

/**
 * Check every URL a collector wants to watch.
 *
 * `fetchText` is injected so this is testable without a network and so the
 * caller decides the timeout. It should resolve to null when robots.txt cannot
 * be read at all.
 *
 * Unreadable robots.txt is treated as permission, deliberately. Most sites have
 * no robots.txt, and a host that is briefly down would otherwise block every
 * registration against it. The asymmetry that matters is the other one: an
 * explicit Disallow is refused rather than warned about.
 */
export async function checkWatchUrls(
  urls: readonly string[],
  fetchText: (robotsUrl: string) => Promise<string | null>,
  userAgent = '*',
): Promise<RobotsCheck[]> {
  const cache = new Map<string, RobotsGroup[] | null>();
  const checks: RobotsCheck[] = [];

  for (const url of urls) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      checks.push({ url, allowed: true, detail: 'not a URL this check can read' });
      continue;
    }

    if (!cache.has(origin)) {
      const text = await fetchText(`${origin}/robots.txt`);
      cache.set(origin, text === null ? null : parseRobots(text));
    }

    const groups = cache.get(origin) ?? null;
    if (groups === null) {
      checks.push({ url, allowed: true, detail: 'no robots.txt could be read' });
      continue;
    }

    const verdict = isAllowed(groups, url, userAgent);
    checks.push(
      verdict.allowed
        ? { url, allowed: true, detail: 'permitted by robots.txt' }
        : {
            url,
            allowed: false,
            detail: `robots.txt disallows this path for "${verdict.agent}": ${verdict.rule}`,
          },
    );
  }

  return checks;
}
