import type { ModeId } from './modes';

/**
 * The opportunity fault corpus.
 *
 * Same discipline as the retail modes in `modes.ts`: the live page and the
 * permanent fixture render from these definitions, so the pages the approval
 * gate replays against are the pages that actually served.
 *
 * What changed is the vocabulary. A deadline a student would have planned an
 * evening of work around is a fault anybody can judge on sight, and it is the
 * fault Doorway exists to catch. "The price selector wrapped the deposit" asks
 * a reader to hold a retail schema in their head before they can tell whether
 * the system did well.
 *
 * Kept in its own file rather than folded into `modes.ts` because the retail
 * corpus is frozen: the regression gate replays against those exact pages, and
 * editing that file to add unrelated scenarios is how a corpus starts drifting
 * from what it is supposed to pin down.
 */

/** What a correct collector should extract from an opportunity mode. */
export interface ExpectedOpportunity {
  title: string;
  deadline: string;
  fundingLevel: string;
  hasApplicationUrl: boolean;
}

export interface OpportunityModeDefinition {
  id: ModeId;
  /** One line, in the words a student would use. */
  label: string;
  /** What to watch for, written for a visitor who is not an engineer. */
  plain: string;
  /** Whether a correct collector's output should change here. */
  semanticChange: boolean;
  /**
   * What a correct system should decide, named before the run.
   *
   * Stated up front so a visitor is not told after the fact that whatever
   * happened was the intended result. A demonstration that only explains
   * itself afterwards can never be wrong, which makes it worth nothing.
   *
   * Written as a decision rather than a label because the label is not always
   * a single value. A page whose deadline genuinely moved is `healthy` when
   * the collector has too little history to call the move a departure, and
   * `genuine_source_change` when it has enough. Both mean publish it and
   * repair nothing. Naming one and calling the other a failure would have had
   * this page accusing a system that did the right thing.
   */
  decision: string;

  /** The verdicts that satisfy `decision`. Observed, not predicted. */
  verdicts: string[];
  /** What it costs a student if nobody catches it. */
  consequence: string;
  expected: ExpectedOpportunity;
  html: string;
}

const CORRECT_DEADLINE = '18 September 2026';

const OPPORTUNITY_EXPECTED: ExpectedOpportunity = {
  title: 'Open AI Research Fellowship',
  deadline: CORRECT_DEADLINE,
  fundingLevel: 'Fully funded',
  hasApplicationUrl: true,
};

/**
 * The page body, with the parts that vary passed in.
 *
 * A definition list on purpose. That is how universities, ministries and
 * foundations publish structured facts, and it is the shape that exposed a real
 * extraction bug: rendered to markdown a `dl` puts the label on one line and
 * the value on another, and a witness that takes the label as the value will
 * accuse a collector that read the date correctly.
 */
function opportunityHtml(options: {
  deadlineRows: string;
  fundingRow?: string;
  applyRow?: string;
  prepend?: string;
}): string {
  const funding =
    options.fundingRow ?? '<dt>Funding</dt>\n    <dd class="funding-level">Fully funded</dd>';
  const apply =
    options.applyRow ??
    '<p class="apply"><a class="application-url" href="/opportunity/ai-fellowship/apply">Start application</a></p>';

  return `
${options.prepend ?? ''}
<article data-opportunity="ai-research-fellowship">
  <h1 class="opportunity-title">Open AI Research Fellowship</h1>
  <p class="provider-row"><span class="label">Provider:</span> <span class="provider">Doorway Research Foundation (controlled fixture)</span></p>
  <p class="summary">A controlled, fully funded research fellowship for undergraduate students interested in trustworthy artificial intelligence.</p>
  <dl class="facts">
    <dt>Opportunity type</dt>
    <dd class="opportunity-type">fellowship</dd>
    ${funding}
    <dt>Location</dt>
    <dd class="location">India</dd>
    <dt>Eligibility</dt>
    <dd class="eligibility">Undergraduate students interested in artificial intelligence</dd>
    ${options.deadlineRows}
    <dt>Required documents</dt>
    <dd class="documents">CV, transcript, research statement</dd>
  </dl>
  ${apply}
</article>`.trim();
}

/**
 * A value that exists nowhere else on the page, on the web, or in the store.
 *
 * Fixed rather than random so the gate can assert on it without the fixture
 * and the checker having to agree on a value at runtime. Its only job is to be
 * unmistakable: if an extractor returns this, it read the labelled row, and if
 * it returns anything else it did not.
 */
export const DEADLINE_SENTINEL = 'SENTINEL-4F2A9C-DEADLINE';

const BASELINE_OPPORTUNITY: OpportunityModeDefinition = {
  id: 'baseline',
  label: 'Baseline. The page is correct and the collector reads it correctly.',
  plain: 'Nothing is wrong. The deadline on the page is the real one.',
  semanticChange: false,
  decision: 'Publish it. Nothing here needs attention.',
  verdicts: ['healthy'],
  consequence: 'None. This is what a good day looks like.',
  expected: OPPORTUNITY_EXPECTED,
  html: opportunityHtml({
    deadlineRows: `<dt>Application deadline</dt>
    <dd class="deadline">${CORRECT_DEADLINE}</dd>`,
  }),
};

export const OPPORTUNITY_MODES: Readonly<Record<ModeId, OpportunityModeDefinition>> = {
  baseline: BASELINE_OPPORTUNITY,

  /*
   * The one to show first.
   *
   * The foundation adds an early-interest date above the real deadline. Every
   * word on the page is true and a person reading it is fine. The collector is
   * bound to the first date in the list, so it publishes 1 September as the
   * closing date. Schema-valid, plausible, and seventeen days early.
   */
  deadline_drift: {
    id: 'deadline_drift',
    label: 'An early-interest date is added above the real deadline.',
    plain:
      'The page now shows two dates. A person reads the labels and is fine. The collector takes the first one and publishes the wrong closing date.',
    semanticChange: false,
    decision: 'Catch it. The wrong date must not be published.',
    verdicts: ['extractor_drift'],
    consequence:
      'A student sees 1 September, assumes applications close then, and never comes back. They miss a fully funded fellowship that was open for another seventeen days.',
    expected: OPPORTUNITY_EXPECTED,
    html: opportunityHtml({
      deadlineRows: `<dt>Early interest deadline</dt>
    <dd class="deadline">1 September 2026</dd>
    <dt>Application deadline</dt>
    <dd class="real-deadline">${CORRECT_DEADLINE}</dd>`,
    }),
  },

  /*
   * The page that tells a meaning-bound extractor from a lucky one.
   *
   * Every other fault here changes a value and asks whether the system
   * notices. This one asks a harder question: when an extractor returns the
   * right answer, did it actually read the right place?
   *
   * The true value is rewritten to a token, and the value it used to hold is
   * left above it under a different label. An extractor anchored to
   * "Application deadline" returns the token. One anchored to position, or to
   * the first date it finds, returns the decoy and looks exactly as correct as
   * it did yesterday.
   *
   * This is what makes the promotion gate a test of meaning rather than of
   * coincidence. A repaired collector that passes every value check can still
   * fail here, and a repair that fails here was never fixed, it was lucky.
   */
  deadline_sentinel: {
    id: 'deadline_sentinel',
    label: 'The real deadline is replaced by a token, and a decoy keeps its place.',
    plain:
      'The labelled deadline now holds a value that appears nowhere else. The date it used to show sits above it under a different label. An extractor that reads the label returns the token; one that reads the position returns the decoy.',
    semanticChange: false,
    decision:
      'Return the token. Anything else means the extractor was reading a position, not a meaning, and a value match was hiding it.',
    verdicts: ['extractor_drift'],
    consequence:
      'A repair that reads the wrong element but happens to return the right value passes every value check ever written. It breaks the first time the two stop agreeing, which is exactly when nobody is looking.',
    expected: { ...OPPORTUNITY_EXPECTED, deadline: DEADLINE_SENTINEL },
    html: opportunityHtml({
      deadlineRows: `<dt>Programme dates</dt>
    <dd class="deadline">${CORRECT_DEADLINE}</dd>
    <dt>Application deadline</dt>
    <dd class="real-deadline">${DEADLINE_SENTINEL}</dd>`,
    }),
  },

  /*
   * The mirror image, and the reason this is not a diff tool.
   *
   * The deadline really did move. Both sensors read 30 September, because 30
   * September is what the page says. Nothing is broken and nothing should be
   * repaired. A monitor that alerts here trains its owner to ignore it.
   */
  deadline_extended: {
    id: 'deadline_extended',
    label: 'The foundation genuinely extends the deadline.',
    plain:
      'The deadline really moved to 30 September. The collector is working perfectly and must be left alone.',
    semanticChange: true,
    decision: 'Publish the new date and propose no repair. The collector is right.',
    // Both mean "the collector is fine, publish it". Which one comes back
    // depends on whether the collector has enough history to call the move a
    // departure from its own baseline; a young one has not.
    verdicts: ['healthy', 'genuine_source_change'],
    consequence:
      'None, if the system tells the truth. If it cries drift here, the next real drift gets ignored too.',
    expected: { ...OPPORTUNITY_EXPECTED, deadline: '30 September 2026' },
    html: opportunityHtml({
      deadlineRows: `<dt>Application deadline</dt>
    <dd class="deadline">30 September 2026</dd>`,
    }),
  },

  /*
   * What happens to funding pages every day.
   *
   * A paid listing is inserted above the real one, carrying its own deadline
   * and its own funding line. A collector bound to "the first listing on the
   * page" would publish a different programme under the fellowship's name.
   *
   * Run against a collector Scraper Studio generated from the baseline page,
   * this comes back healthy, and that is the correct answer. The generated
   * extractor is anchored to the real article rather than to page position, so
   * the paid card above it changes nothing it reads.
   *
   * Kept, and relabelled, because a demonstration made only of catches teaches
   * a reader that the system alerts on everything. The interesting property of
   * a monitor is as much what it stays quiet about.
   */
  sponsored_opportunity: {
    id: 'sponsored_opportunity',
    label: 'A sponsored programme is inserted above the real one.',
    plain:
      'A paid listing appears at the top of the page. Nothing about the real fellowship changed, and a collector anchored to the real listing should not budge.',
    semanticChange: false,
    decision: 'Stay quiet. Noise above the listing is not a reason to alarm.',
    verdicts: ['healthy'],
    consequence:
      'A collector bound to page position instead would publish a paid course with no funding under this fellowship name. This one is not, and the run should show that rather than assume it.',
    expected: OPPORTUNITY_EXPECTED,
    html: opportunityHtml({
      prepend: `<aside class="sponsored-opportunity" data-sponsored="true">
  <p class="label">Sponsored programme</p>
  <h1 class="opportunity-title">Fast Track AI Certificate</h1>
  <dl class="facts">
    <dt>Funding</dt>
    <dd class="funding-level">Self funded</dd>
    <dt>Application deadline</dt>
    <dd class="deadline">2 September 2026</dd>
  </dl>
</aside>`,
      deadlineRows: `<dt>Application deadline</dt>
    <dd class="real-deadline">${CORRECT_DEADLINE}</dd>`,
    }),
  },

  /*
   * The failure that is not a wrong value but an absent one.
   *
   * `application_url` is a protected field: an opportunity with no way to apply
   * is not an opportunity. A repair may not drop it and a publish may not omit
   * it, so this mode checks the floor rather than the ceiling.
   */
  application_link_removed: {
    id: 'application_link_removed',
    label: 'The apply button is replaced by a contact sentence.',
    plain:
      'There is no longer a link to apply. The listing still looks complete, and it is unusable.',
    semanticChange: false,
    decision: 'Withhold the listing, and blame nobody. The link really is gone.',
    // Both sensors agree the link vanished, so the collector is not at fault
    // and the verdict says so. The row is still unfit to serve, because
    // `application_url` is a protected field. Blame and publishability are two
    // questions, and this scenario exists because they were being answered
    // once: the row published, and the listing URL was quietly substituted for
    // the missing apply link.
    verdicts: ['genuine_source_change', 'extractor_drift'],
    consequence:
      'A student finds the fellowship, decides to apply, and there is nowhere to go. Doorway withholds the listing rather than serving a dead end.',
    expected: { ...OPPORTUNITY_EXPECTED, hasApplicationUrl: false },
    html: opportunityHtml({
      deadlineRows: `<dt>Application deadline</dt>
    <dd class="deadline">${CORRECT_DEADLINE}</dd>`,
      applyRow:
        '<p class="apply">Applications are open. Contact the programme team for access.</p>',
    }),
  },

  // Every retail mode leaves the opportunity page alone. One process serves
  // both fixtures, and a demonstration about scholarship deadlines should not
  // change underneath a visitor because somebody switched a headphone price in
  // another tab.
  genuine_price_change: BASELINE_OPPORTUNITY,
  selector_drift: BASELINE_OPPORTUNITY,
  silent_zero: BASELINE_OPPORTUNITY,
  missing_field: BASELINE_OPPORTUNITY,
  sponsored_insertion: BASELINE_OPPORTUNITY,
  pagination_collapse: BASELINE_OPPORTUNITY,
  search_drift: BASELINE_OPPORTUNITY,
};

export function getOpportunityMode(id: ModeId): OpportunityModeDefinition {
  return OPPORTUNITY_MODES[id];
}
