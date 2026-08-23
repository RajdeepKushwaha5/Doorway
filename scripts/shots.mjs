/**
 * Look at the pages, at the widths people actually hold them at.
 *
 * Every UI change in this repository until now was reasoned about rather than
 * seen. That is a bad way to build an interface and an impossible way to check
 * one: a box that stretches to fill its grid column looks fine in the source
 * and wrong on the screen, and the architecture diagram shipped that exact bug
 * for two rewrites because nobody could see it.
 *
 * Writes to `.visual-qa/`, which is gitignored. Screenshots are for looking at,
 * not for committing, and a repository that carries a hundred PNGs of itself is
 * one nobody can clone on a slow connection.
 *
 * Usage:
 *   npm run shots                        # every route, three widths
 *   npm run shots -- --base https://...  # against a deployment
 *   npm run shots -- --route /engine     # one route
 *   npm run shots -- --width 390         # one width
 *   npm run shots -- --clip "#system"    # just the element that matters
 *
 * Widths are chosen rather than inherited: 390 is an iPhone 15, 768 is the
 * tailwind `md` breakpoint where most of this layout changes its mind, and
 * 1440 is a laptop. A layout that works at all three works.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = '.visual-qa';

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

/** Public routes. Detail pages need an id, so they are driven by --route. */
const ROUTES = ['/', '/engine', '/proof', '/verify', '/verified'];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const base = (arg('base', 'http://localhost:3000') ?? '').replace(/\/+$/, '');
const only = arg('route', null);
const onlyWidth = arg('width', null);
const clip = arg('clip', null);

const routes = only === null ? ROUTES : [only];
const widths =
  onlyWidth === null ? WIDTHS : WIDTHS.filter((w) => String(w.width) === String(onlyWidth));

/**
 * Text that means the page gave up.
 *
 * Screenshotting an error page and filing it as evidence the layout works is
 * the failure this tool exists to prevent, so it reports what it found rather
 * than only that it found something.
 */
const FAILURE_MARKERS = [
  'Application error',
  'This page could not be found',
  'Internal Server Error',
  'ECONNREFUSED',
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const report = [];

for (const { name, width, height } of widths) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    // Animations settle differently under reduced motion, and a screenshot of
    // a half-finished transition is not a layout.
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  for (const route of routes) {
    const url = `${base}${route}`;
    const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
    const file = join(OUT, `${slug}-${name}.png`);

    let status = 'ok';
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      const code = response?.status() ?? 0;
      if (code >= 400) status = `http ${code}`;

      // Let font swaps and any reveal-on-scroll settle before capturing.
      await page.waitForTimeout(1200);

      const body = await page.evaluate(() => document.body.innerText);
      const found = FAILURE_MARKERS.filter((marker) => body.includes(marker));
      if (found.length > 0) status = `error page: ${found.join(', ')}`;

      const target = clip === null ? null : page.locator(clip).first();
      if (target !== null && (await target.count()) > 0) {
        await target.screenshot({ path: file });
      } else {
        await page.screenshot({ path: file, fullPage: true });
      }

      // Horizontal overflow is the single most common way a page that looks
      // finished on a laptop is broken on a phone, and it never shows up in a
      // full-page screenshot because the screenshot is as wide as the content.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      report.push({ route, width: name, status, overflowPx: overflow, file });
    } catch (error) {
      report.push({
        route,
        width: name,
        status: `failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}`,
        overflowPx: 0,
        file: null,
      });
    }
  }

  await context.close();
}

await browser.close();

await writeFile(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const pad = (value, width) => String(value).padEnd(width);
process.stdout.write(`\n  ${pad('route', 12)}${pad('width', 10)}${pad('overflow', 10)}status\n`);
process.stdout.write(`  ${'-'.repeat(58)}\n`);
for (const row of report) {
  const overflow = row.overflowPx > 0 ? `${String(row.overflowPx)}px !` : '-';
  process.stdout.write(
    `  ${pad(row.route, 12)}${pad(row.width, 10)}${pad(overflow, 10)}${row.status}\n`,
  );
}
process.stdout.write(`\n  ${String(report.length)} shots in ${OUT}/\n\n`);
