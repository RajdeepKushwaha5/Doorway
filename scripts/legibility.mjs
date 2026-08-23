/**
 * The three-second test, applied to every section.
 *
 * A reader scrolling a dashboard does not read it. They land on a section,
 * spend about three seconds, and either understand what they are looking at or
 * move on. What they actually take in is the heading, the label above it, and
 * roughly the first line: whatever survives being skimmed.
 *
 * So this prints exactly that, per section, with nothing else. Reading the
 * result is the test. A heading that needs its own paragraph to make sense has
 * failed, and it is much easier to see that in a list of headings than on the
 * page, where the surrounding prose quietly explains it for you.
 *
 * It also measures each section, because a section taller than about two
 * screens is one nobody meets in three seconds anyway.
 *
 * Usage:
 *   npm run legibility -- --base http://localhost:3100 --route /engine
 */
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const base = (arg('base', 'http://localhost:3000') ?? '').replace(/\/+$/, '');
const routes = (arg('route', '/,/engine,/proof,/verify,/verified') ?? '').split(',');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const route of routes) {
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(800);

  const sections = await page.evaluate(() => {
    const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('section')].map((node) => {
      const heading = node.querySelector('h1, h2, h3');
      // The small uppercase label above a heading, whatever it is called here.
      const eyebrow = node.querySelector('.eyebrow, [class*="uppercase"]');
      const paragraph = node.querySelector('p');
      return {
        eyebrow: clean(eyebrow?.textContent).slice(0, 44),
        heading: clean(heading?.textContent).slice(0, 72),
        first: clean(paragraph?.textContent).slice(0, 96),
        height: Math.round(node.getBoundingClientRect().height),
      };
    });
  });

  process.stdout.write(`\n${'='.repeat(78)}\n  ${route}   ${String(sections.length)} sections\n${'='.repeat(78)}\n`);
  for (const [index, section] of sections.entries()) {
    // Two screens at 900px. Past that, a section is a page.
    const tall = section.height > 1800 ? `  << ${String(section.height)}px, over two screens` : '';
    process.stdout.write(`\n  ${String(index + 1).padStart(2, '0')}  ${section.heading || '(NO HEADING)'}${tall}\n`);
    if (section.eyebrow !== '') process.stdout.write(`      label   ${section.eyebrow}\n`);
    if (section.first !== '') process.stdout.write(`      first   ${section.first}\n`);
  }
}

await browser.close();
process.stdout.write('\n');
