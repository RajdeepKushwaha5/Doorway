import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The claim this whole project rests on, checked rather than asserted.
 *
 * Two sensors are only worth having if they cannot fail the same way at the
 * same time. The collector binds to selectors; the witness is supposed to find
 * the same fact by reading labels in text, sharing no code and no strategy with
 * it. Everything downstream, every verdict, every badge, assumes that.
 *
 * Up to now it was true because nobody had broken it, which is not a guarantee.
 * A single convenience import of a selector helper into the witness would
 * quietly turn two sensors into one, every verdict would keep rendering, and
 * the first sign of trouble would be a drift nobody caught.
 *
 * So it is enforced here. This is deliberately a test rather than a separate
 * lint script: it runs with everything else, on every commit, and a violation
 * fails the build rather than a job somebody has to remember to look at.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Source files of the witness, excluding tests. */
function witnessSources(): { name: string; code: string }[] {
  return readdirSync(HERE)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, code: readFileSync(join(HERE, name), 'utf8') }));
}

/**
 * Strip comments before searching.
 *
 * The witness talks about selectors constantly, because explaining why it does
 * not use them is most of its documentation. Matching on prose would fail the
 * build for saying the word, which teaches people to delete the explanation
 * rather than keep the property.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

describe('the witness shares nothing with the collector', () => {
  it('imports nothing from the Bright Data collector path', () => {
    const offenders = witnessSources()
      .filter(({ code: source }) => /from\s+'[^']*brightdata\//.test(code(source)))
      .map(({ name }) => name);

    // A collector import is the easiest way to lose independence and the
    // hardest to notice, because everything keeps working.
    expect(offenders).toEqual([]);
  });

  it('never reaches for a DOM or CSS query', () => {
    const banned = /querySelector|getElementBy|cheerio|jsdom|\bcss\s*\(/;
    const offenders = witnessSources()
      .filter(({ code: source }) => banned.test(code(source)))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  it('finds values by label, which is the property being protected', () => {
    // The positive half. The two rules above say what the witness must not do;
    // this says the strategy it must still be using, so deleting the label
    // logic and passing by doing nothing is not an option.
    const extract = witnessSources().find(({ name }) => name === 'extract.ts');
    expect(extract).toBeDefined();
    expect(code(extract?.code ?? '')).toMatch(/labels/);
  });
});

describe('the guard itself works', () => {
  it('would catch a collector import', () => {
    const sample = "import { runCollector } from '../brightdata/client.js';";
    expect(/from\s+'[^']*brightdata\//.test(code(sample))).toBe(true);
  });

  it('does not fire on prose that merely mentions selectors', () => {
    // Two real comments in this directory explain why selectors are avoided.
    // Both must remain harmless.
    const sample = '/* the witness can locate the same fact without sharing any selector */';
    expect(/querySelector|getElementBy/.test(code(sample))).toBe(false);
  });
});
