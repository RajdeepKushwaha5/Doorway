import { describe, expect, it } from 'vitest';
import { extractField } from './extract.js';
import { reconcile } from './compare.js';
import type { WitnessFieldSpec, WitnessObservation } from './spec.js';

/**
 * The field whose loss makes a listing useless, and which nobody was reading.
 *
 * `application_url` was protected and carried a required invariant, and it was
 * absent from the witness specs. `reconcile` iterates the specs, so no second
 * sensor ever compared it. The collector went on reporting an apply URL for a
 * page that had stopped offering one, every witnessed field agreed, and the
 * run came back healthy while a student had nowhere to click.
 */

const APPLY_SPEC: WitnessFieldSpec = {
  path: 'application_url',
  meaning: 'where a student goes to apply',
  labels: ['apply', 'application'],
  excludeLabels: [],
  kind: 'text',
  allowed: [],
  shape: 'url',
  requiredOnPage: true,
};

const WITH_LINK = `
# Open AI Research Fellowship

Application deadline: 18 September 2026

[Apply now](https://doorway-lab.onrender.com/opportunity/ai-fellowship/apply)
`.trim();

const WITHOUT_LINK = `
# Open AI Research Fellowship

Application deadline: 18 September 2026

Applications are open. Contact the programme team for access.
`.trim();

const observationOf = (markdown: string): WitnessObservation => {
  const found = extractField(markdown, APPLY_SPEC);
  return {
    url: 'https://doorway-lab.onrender.com/opportunity/ai-fellowship',
    fetchedAt: new Date().toISOString(),
    contentHash: 'hash',
    excerpt: markdown.slice(0, 40),
    values: found === null ? [] : [found],
    notFound: found === null ? [APPLY_SPEC.path] : [],
    shape: { headings: [], labels: [], lines: 0, links: 0, tables: 0, images: 0, words: 0 },
  };
};

describe('reading the apply link', () => {
  it('finds a markdown link by its text', () => {
    const found = extractField(WITH_LINK, APPLY_SPEC);
    expect(found?.value).toBe('https://doorway-lab.onrender.com/opportunity/ai-fellowship/apply');
    expect(found?.evidence.strategy).toBe('markdown-link');
  });

  it('reports nothing when the page offers no link', () => {
    expect(extractField(WITHOUT_LINK, APPLY_SPEC)).toBeNull();
  });

  it('refuses a value that is not a URL', () => {
    const prose = 'Apply: contact the programme team';
    expect(extractField(prose, APPLY_SPEC)).toBeNull();
  });
});

describe('a link the page no longer offers', () => {
  const claimed = {
    application_url: 'https://doorway-lab.onrender.com/opportunity/ai-fellowship/apply',
  };

  it('agrees while the page still shows it', () => {
    const summary = reconcile(claimed, observationOf(WITH_LINK), [APPLY_SPEC]);
    expect(summary.agreed).toContain('application_url');
    expect(summary.disagreed).toHaveLength(0);
  });

  it('disagrees once the page stops showing it, rather than shrugging', () => {
    const summary = reconcile(claimed, observationOf(WITHOUT_LINK), [APPLY_SPEC]);
    expect(summary.disagreed).toContain('application_url');
    expect(summary.incomparable).toHaveLength(0);
  });

  it('carries enough confidence for the disagreement to count', () => {
    const summary = reconcile(claimed, observationOf(WITHOUT_LINK), [APPLY_SPEC]);
    // Left at zero, the classifier rounds a real finding back to inconclusive.
    expect(summary.weakestDisagreementConfidence).toBeGreaterThan(0.5);
  });

  it('still shrugs for a field the page is not required to show', () => {
    const optional: WitnessFieldSpec = { ...APPLY_SPEC, requiredOnPage: false };
    const summary = reconcile(claimed, observationOf(WITHOUT_LINK), [optional]);
    expect(summary.incomparable).toContain('application_url');
    expect(summary.disagreed).toHaveLength(0);
  });
});

describe('why the url shape is not optional here', () => {
  /*
   * Measured, not assumed.
   *
   * "application" appears in "Application deadline", so an apply-link spec
   * without a shape reads the closing date as the URL, disagrees with the
   * collector's correct link and reports drift on a page where nothing is
   * wrong. Adding the spec without the gate is worse than not adding it.
   */
  const unshaped: WitnessFieldSpec = {
    path: 'application_url',
    meaning: 'where a student goes to apply',
    labels: ['apply', 'application'],
    excludeLabels: [],
    kind: 'text',
    allowed: [],
  };

  it('reads the deadline as the apply link when nothing holds it to a shape', () => {
    expect(extractField(WITH_LINK, unshaped)?.value).toBe('18 September 2026');
  });

  it('reads the link once the shape is declared', () => {
    expect(extractField(WITH_LINK, { ...unshaped, shape: 'url' })?.value).toBe(
      'https://doorway-lab.onrender.com/opportunity/ai-fellowship/apply',
    );
  });
});

describe('links as pages actually write them', () => {
  /*
   * Taken verbatim from the first live run against the fixture.
   *
   * The strategy first shipped matching only absolute URLs. The page renders
   * "[Start application](/opportunity/ai-fellowship/apply)", so the witness
   * found nothing, requiredOnPage turned that silence into a disagreement, and
   * a page where nothing was wrong was quarantined on a baseline run. A false
   * accusation is worse than the blind spot it replaced, because it teaches an
   * operator to stop believing incidents.
   */
  const PAGE = 'https://doorway-lab.onrender.com/opportunity/ai-fellowship';
  const REAL_MARKDOWN = [
    '# Open AI Research Fellowship',
    '',
    'Application deadline',
    '',
    '18 September 2026',
    '',
    '[Start application](/opportunity/ai-fellowship/apply)',
  ].join('\n');

  it('resolves a relative href against the page it was read from', () => {
    const found = extractField(REAL_MARKDOWN, APPLY_SPEC, PAGE);
    expect(found?.value).toBe('https://doorway-lab.onrender.com/opportunity/ai-fellowship/apply');
  });

  it('still reads an absolute href', () => {
    expect(extractField(WITH_LINK, APPLY_SPEC, PAGE)?.value).toBe(
      'https://doorway-lab.onrender.com/opportunity/ai-fellowship/apply',
    );
  });

  it('agrees with the collector once the relative link resolves', () => {
    const found = extractField(REAL_MARKDOWN, APPLY_SPEC, PAGE);
    const summary = reconcile(
      { application_url: 'https://doorway-lab.onrender.com/opportunity/ai-fellowship/apply' },
      {
        url: PAGE,
        fetchedAt: new Date().toISOString(),
        contentHash: 'h',
        excerpt: '',
        values: found === null ? [] : [found],
        notFound: [],
        shape: { headings: [], labels: [], lines: 0, links: 0, tables: 0, images: 0, words: 0 },
      },
      [APPLY_SPEC],
    );
    expect(summary.agreed).toContain('application_url');
    expect(summary.disagreed).toHaveLength(0);
  });

  it('refuses hrefs that are not somewhere a student can apply', () => {
    for (const href of ['#apply', 'mailto:apply@example.org', 'javascript:void(0)']) {
      const markdown = `[Apply now](${href})`;
      expect(extractField(markdown, APPLY_SPEC, PAGE)).toBeNull();
    }
  });
});
