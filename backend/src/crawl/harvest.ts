/**
 * Turn the pages we throw away into the reason we can crawl at scale.
 *
 * Discovery treats a listing page as a failure. It extracts beautifully and
 * means nothing, because the deadline it yields belongs to whichever entry
 * happened to be first, so it is dropped and the request is wasted.
 *
 * That is exactly backwards for a crawler. A roundup of "50 fully funded
 * scholarships" is a poor opportunity and an excellent index: fifty links to
 * real pages, assembled by somebody who did the finding for us. One fetch of a
 * listing page yields more frontier than ten searches do.
 *
 * This is the difference between a search that opens a dozen pages on demand
 * and a crawl that reaches thousands. The listing pages were always there. We
 * were reading them for the wrong thing.
 */

/** A link worth adding to the frontier. */
export interface HarvestedLink {
  url: string;
  /** The anchor text, which is usually the opportunity's name. */
  text: string;
  /** Where it was found, kept so a record can explain its own provenance. */
  foundOn: string;
}

/** Words in a URL or anchor that suggest an opportunity page. */
const PROMISING =
  /\b(scholarship|fellowship|internship|grant|hackathon|bursary|stipend|funding|award|programme|program|apply|admission|challenge|competition|call-for|opportunit)/i;

/**
 * Paths that are never an opportunity, however promising the words look.
 *
 * Checked before the promising test rather than after, because a login page at
 * /account/apply matches "apply" and a privacy policy at /legal/programme-terms
 * matches "programme".
 */
const NEVER_PATHS =
  /\/(?:login|signin|sign-in|signup|register-account|account|profile|cart|checkout|privacy|terms|legal|cookie|contact|about-us|sitemap|feed|rss|tag|tags|category|categories|author|search|share)\b/i;

const NEVER_HOSTS = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'quora.com',
  'linkedin.com',
  'whatsapp.com',
  't.me',
  'google.',
  'gstatic.com',
  'doubleclick',
  'googletagmanager',
];

const NEVER_EXTENSIONS = /\.(?:pdf|jpe?g|png|gif|svg|webp|zip|docx?|pptx?|xlsx?|mp4|mp3|css|js)(?:$|\?)/i;

/**
 * Resolve a link against the page it was found on.
 *
 * Listing pages are full of relative hrefs, and a crawler that only understands
 * absolute URLs harvests a fraction of what is there.
 */
function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // The fragment is never a different page, and keeping it multiplies the
    // frontier by every anchor on every page.
    url.hash = '';
    // Tracking parameters make the same page look like many.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref|source)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Every link on this page that might be an opportunity.
 *
 * Deliberately generous. A frontier entry costs almost nothing to hold and is
 * only paid for when it is fetched, so the expensive mistake is missing a real
 * opportunity, not carrying a candidate that turns out to be a contact page.
 * The strict judgement happens after the fetch, where the page itself can
 * answer for what it is.
 */
export function harvestLinks(
  markdown: string,
  pageUrl: string,
  options: { sameHostOnly?: boolean; limit?: number } = {},
): HarvestedLink[] {
  const limit = options.limit ?? 200;
  const pageHost = hostOf(pageUrl);

  const found: HarvestedLink[] = [];
  const seen = new Set<string>();

  // Markdown links, which is how Bright Data renders every anchor.
  const pattern = /\[([^\]]{0,160})\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  for (const match of markdown.matchAll(pattern)) {
    if (found.length >= limit) break;

    const text = (match[1] ?? '').replace(/\s+/g, ' ').trim();
    const href = (match[2] ?? '').trim();
    if (href === '') continue;

    const url = absolute(href, pageUrl);
    if (url === null) continue;
    if (seen.has(url)) continue;

    const host = hostOf(url);
    if (host === '') continue;
    if (NEVER_HOSTS.some((bad) => host.includes(bad))) continue;
    if (NEVER_EXTENSIONS.test(url)) continue;
    if (NEVER_PATHS.test(new URL(url).pathname)) continue;
    if (options.sameHostOnly === true && host !== pageHost) continue;

    // The link is worth following if either its words or its address suggest
    // an opportunity. Anchor text alone misses "Read more"; the URL alone
    // misses /p/12345.
    if (!PROMISING.test(text) && !PROMISING.test(url)) continue;

    // A link to the page we are already on adds nothing.
    if (url.replace(/\/$/, '') === pageUrl.replace(/\/$/, '')) continue;

    seen.add(url);
    found.push({ url, text, foundOn: pageUrl });
  }

  return found;
}

/**
 * Whether a page is worth harvesting rather than reading.
 *
 * A page carrying many opportunity-shaped links is an index, and an index is
 * worth more to a crawler than any single opportunity on it. This is the same
 * observation discovery uses to reject a page, pointed the other way.
 */
export function looksHarvestable(markdown: string, pageUrl: string): boolean {
  return harvestLinks(markdown, pageUrl, { limit: 12 }).length >= 8;
}
