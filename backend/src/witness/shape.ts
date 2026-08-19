/**
 * Whether the witness read the page it asked for.
 *
 * This project's entire position is that no single sensor should be believed.
 * The second sensor was the one exception: `observeMarkdown` took whatever
 * markdown came back and began pulling values out of it, with no check that
 * the thing it read was the page under observation at all.
 *
 * That matters because the ways a fetch quietly returns the wrong page are
 * ordinary. A consent wall, an interstitial that says it is checking your
 * browser, a soft 404 answering 200, a login redirect. Each of those is a
 * successful HTTP response containing a real document, and the witness would
 * read it exactly as attentively as the product page. The best case is every
 * field lands in `notFound` and the run is quarantined without anyone being
 * able to say why. The worst case is the wall carries a labelled number, the
 * witness reads it, and a working collector is accused of drifting.
 *
 * A content hash cannot answer this: it changes when one digit changes, so it
 * cannot tell "the price moved" from "this is a different document". What
 * distinguishes them is shape. A page whose price changed keeps its headings,
 * its labels and its density. A consent wall shares almost none of them.
 *
 * The technique is borrowed from Scrapling, whose adaptive element relocation
 * scores structural similarity to decide where an element went. The same
 * measurement is used here for a different question, because "which element is
 * this now" is a guess and "is this even the same document" is checkable.
 */

/** The structural signature of one fetched page. */
export interface PageShape {
  /** Ordered heading levels, so `# … ## … ##` becomes [1, 2, 2]. */
  headings: number[];
  /** Normalized `Label:` prefixes, deduplicated and sorted. */
  labels: string[];
  /** Non-empty lines. */
  lines: number;
  links: number;
  tables: number;
  images: number;
  /** Total words, which catches a full page replaced by a two-line notice. */
  words: number;
}

/** How closely two shapes match, and which parts disagreed. */
export interface ShapeComparison {
  /**
   * Weighted total over the components there was evidence for, 0 to 1.
   *
   * Supporting evidence rather than the decision. A component neither page has
   * anything to say about is left out of the average entirely instead of being
   * scored as agreement, for the same reason a contract check that could not be
   * evaluated reports `unknown` rather than `pass`: absence of evidence must
   * not be counted as evidence.
   */
  similarity: number;
  /** Per-component ratios, so a low score can say what actually moved. */
  parts: { labels: number; headings: number; density: number; media: number };
  /** Plain-language notes on the components that fell furthest. */
  notes: string[];
  /** Whether these two readings can be treated as the same document. */
  samePage: boolean;
  /** Why, in one sentence, suitable for an incident's evidence. */
  reason: string;
}

const HEADING = /^(#{1,6})\s+\S/;
/**
 * A labelled line, such as `Purchase price: $249` or `**Availability:** In stock`.
 *
 * Bounded at 48 characters before the colon so a sentence containing a colon
 * mid-paragraph is not mistaken for a field label. The same bound the extractor
 * uses, for the same reason.
 */
const LABEL = /^\s*[*_>\s-]*([A-Za-z][A-Za-z0-9 /'()&-]{0,47}?)\s*[:：]\s*\S/;
const LINK = /\[[^\]]*\]\([^)]*\)/g;
const IMAGE = /!\[[^\]]*\]/g;

/** Reduce a page to its structure, discarding every value it contains. */
export function pageShape(markdown: string): PageShape {
  const headings: number[] = [];
  const labels = new Set<string>();
  let lines = 0;
  let tables = 0;

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    lines += 1;

    const heading = HEADING.exec(line);
    if (heading !== null) {
      headings.push(heading[1]?.length ?? 1);
      continue;
    }

    if (line.startsWith('|')) {
      tables += 1;
      continue;
    }

    const label = LABEL.exec(line);
    if (label !== null) {
      // Lowercased and space-collapsed so "Purchase Price" and "purchase
      // price" are the same label. Casing changes on a redesign all the time
      // and mean nothing about whether this is the same document.
      labels.add((label[1] ?? '').toLowerCase().replace(/\s+/g, ' ').trim());
    }
  }

  return {
    headings,
    labels: [...labels].sort(),
    lines,
    tables,
    links: (markdown.match(LINK) ?? []).length,
    images: (markdown.match(IMAGE) ?? []).length,
    words: markdown.split(/\s+/).filter((word) => word !== '').length,
  };
}

/** Overlap of two sets. Only called when at least one side has members. */
function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Similarity of two heading collections.
 *
 * Compared as a multiset rather than a sequence: a redesign that moves one
 * section above another has not produced a different document, and treating
 * that as a mismatch would make the check fire on cosmetic edits, which is the
 * one thing it must not do.
 */
function headingSimilarity(left: readonly number[], right: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const level of left) counts.set(level, (counts.get(level) ?? 0) + 1);
  let shared = 0;
  for (const level of right) {
    const available = counts.get(level) ?? 0;
    if (available > 0) {
      shared += 1;
      counts.set(level, available - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

/** Closeness of two counts. Null when neither side has any, which is not agreement. */
function ratio(left: number, right: number): number | null {
  if (left === 0 && right === 0) return null;
  return Math.min(left, right) / Math.max(left, right);
}

/** Average of the sub-ratios that had anything to measure. */
function meanOf(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((total, value) => total + value, 0) / present.length;
}

/**
 * Weights, applied only to components with evidence.
 *
 * Labels dominate because they are what the witness actually reads. Media
 * counts are worth least: a link or image count moves for reasons that have
 * nothing to do with a document's identity.
 */
const WEIGHTS = { labels: 0.45, headings: 0.2, density: 0.25, media: 0.1 } as const;

/**
 * Below this, two readings are not treated as the same page.
 *
 * A false positive here downgrades a real `extractor_drift` to `inconclusive`,
 * which costs an automatic repair and asks a human to look. A false negative
 * lets the witness testify about a page it never read, and a working collector
 * is accused on that testimony. Both are bad; only one of them writes a wrong
 * accusation into the record, so the bar sits high enough to catch it.
 */
export const SAME_PAGE_THRESHOLD = 0.55;

/**
 * How many labelled fields the reference needs before their total absence is
 * decisive on its own.
 *
 * One label disappearing is a page edit. Every label disappearing, when there
 * were several, means there is nothing left for the witness to read, and a
 * reading with nothing to read is not a reading of this page.
 */
const DECISIVE_LABEL_COUNT = 2;

export function compareShapes(before: PageShape, after: PageShape): ShapeComparison {
  const labels =
    before.labels.length === 0 && after.labels.length === 0
      ? null
      : jaccard(before.labels, after.labels);
  const headings =
    before.headings.length === 0 && after.headings.length === 0
      ? null
      : headingSimilarity(before.headings, after.headings);
  const density = meanOf([ratio(before.lines, after.lines), ratio(before.words, after.words)]);
  const media = meanOf([
    ratio(before.links, after.links),
    ratio(before.images, after.images),
    ratio(before.tables, after.tables),
  ]);

  const scored: [number, number][] = [];
  if (labels !== null) scored.push([labels, WEIGHTS.labels]);
  if (headings !== null) scored.push([headings, WEIGHTS.headings]);
  if (density !== null) scored.push([density, WEIGHTS.density]);
  if (media !== null) scored.push([media, WEIGHTS.media]);

  const weight = scored.reduce((total, [, each]) => total + each, 0);
  const similarity =
    weight === 0 ? 1 : scored.reduce((total, [value, each]) => total + value * each, 0) / weight;

  const parts = {
    labels: labels ?? 1,
    headings: headings ?? 1,
    density: density ?? 1,
    media: media ?? 1,
  };

  const notes: string[] = [];
  const lost = before.labels.filter((label) => !after.labels.includes(label));
  if (labels !== null && labels < 0.5) {
    notes.push(
      lost.length === 0
        ? 'the labelled fields on the page are almost entirely different'
        : `labelled fields present on the verified page and absent now: ${lost.slice(0, 6).join(', ')}`,
    );
  }
  if (headings !== null && headings < 0.5) {
    notes.push(
      `heading structure differs: ${String(before.headings.length)} headings on the verified page, ${String(after.headings.length)} now`,
    );
  }
  if (density !== null && density < 0.5) {
    notes.push(
      `page length differs sharply: ${String(before.words)} words on the verified page, ${String(after.words)} now`,
    );
  }

  const rounded = Math.round(similarity * 1000) / 1000;

  // The reference is too thin to identify a document by, so this check has no
  // opinion. A page with no headings and at most one labelled field could be
  // half the pages on the web, and asserting identity from that would produce
  // exactly the confident wrong answer this module exists to prevent.
  //
  // Standing down is safe: extraction still fails loudly on its own if the
  // page is wrong, and the run is still judged on the evidence that does
  // exist. A first observation must never be blocked by the absence of its
  // own history.
  if (weight === 0 || (before.labels.length < DECISIVE_LABEL_COUNT && before.headings.length === 0)) {
    return {
      similarity: rounded,
      parts,
      notes: [],
      samePage: true,
      reason: 'the verified reading had too little structure to compare against',
    };
  }

  // Decisive on its own: not one labelled field survived. There is nothing on
  // this page for the witness to read, so whatever it read, it was not this.
  if (before.labels.length >= DECISIVE_LABEL_COUNT && labels === 0) {
    return {
      similarity: rounded,
      parts,
      notes,
      samePage: false,
      reason: `none of the ${String(before.labels.length)} labelled fields on the verified page are present in what the witness read`,
    };
  }

  return {
    similarity: rounded,
    parts,
    notes,
    samePage: rounded >= SAME_PAGE_THRESHOLD,
    reason:
      rounded >= SAME_PAGE_THRESHOLD
        ? `${String(Math.round(rounded * 100))}% of the verified page's structure is still present`
        : `only ${String(Math.round(rounded * 100))}% of the verified page's structure is present`,
  };
}

/** Whether a fetched page can be treated as the page that was verified before. */
export function isSamePage(comparison: ShapeComparison): boolean {
  return comparison.samePage;
}
