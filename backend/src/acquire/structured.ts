/**
 * Read what the page states in machine-readable form.
 *
 * Bright Data's markdown conversion is what makes label extraction possible on
 * a page nobody has written a selector for. It also throws away every piece of
 * structured data on the way, because `<script type="application/ld+json">` is
 * not prose and markdown has nowhere to put it.
 *
 * That turns out to be most of the missing deadlines. Publishers of
 * scholarships, courses and events embed schema.org markup because search
 * engines reward it, so the exact date a page shows a human as "15th July 2026"
 * is also sitting in the source as `"registrationDeadline": "2026-07-15"`,
 * already normalised, with no ordinal suffix to trip over and no ambiguity
 * about which of three dates on the page is the closing one.
 *
 * There is a second reason to want it, and it matters more than convenience.
 * Everything discovery produces has been read once, by one sensor, which is the
 * weakest claim this system makes. Structured data is a genuinely independent
 * reading of the same page: a different representation, authored separately
 * from the visible text, extracted by different code. When it agrees with what
 * the words said, that is the same kind of corroboration the witness provides
 * for a watched collector, and a discovered record can honestly claim more than
 * "we read this once".
 *
 * When it disagrees, that is worth knowing too, and it is not treated as a
 * tie-break: a page whose visible deadline and embedded deadline differ is a
 * page nobody should plan around without looking.
 */

/** Opportunity facts a page stated in machine-readable form. */
export interface StructuredFacts {
  title: string | null;
  provider: string | null;
  /** ISO date, as the page declared it. */
  deadline: string | null;
  /** Which property carried it, so a record can say where it came from. */
  deadlineField: string | null;
  startDate: string | null;
  currency: string | null;
  amount: number | null;
  /** The schema.org types found, useful for telling an Event from an Article. */
  types: string[];
}

const EMPTY: StructuredFacts = {
  title: null,
  provider: null,
  deadline: null,
  deadlineField: null,
  startDate: null,
  currency: null,
  amount: null,
  types: [],
};

/**
 * Properties that carry a closing date, best first.
 *
 * Order is the whole design here. A page describing an event has a start date,
 * an end date and often a registration deadline, and only one of those is the
 * date a student can miss. Taking the first date found would routinely publish
 * the day the programme begins as the day applications close.
 */
const DEADLINE_FIELDS = [
  'registrationDeadline',
  'applicationDeadline',
  'applicationDeadlineDate',
  'deadline',
  'validThrough',
  'expires',
  'endDate',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An ISO date, when the value is one and is not obviously nonsense. */
function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (match === null) return null;

  const year = Number(match[1]);
  if (year < 1990 || year > 2100) return null;
  return `${match[1] ?? ''}-${match[2] ?? ''}-${match[3] ?? ''}`;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed === '' ? null : trimmed;
  }
  // schema.org routinely nests: "provider": { "@type": "Organization", ... }
  if (isRecord(value)) return text(value['name']);
  if (Array.isArray(value)) return text(value[0]);
  return null;
}

/**
 * Walk every object in a JSON-LD document.
 *
 * Publishers nest arbitrarily: a graph of an Organization containing a
 * WebPage containing the Event that actually carries the date. Flattening
 * first is simpler than trying to predict the shape, and the field names are
 * distinctive enough that collecting from everywhere is safe.
 */
function* everyObject(value: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const entry of value) yield* everyObject(entry, depth + 1);
    return;
  }
  if (!isRecord(value)) return;

  yield value;
  for (const nested of Object.values(value)) yield* everyObject(nested, depth + 1);
}

/** Pull the JSON-LD blocks out of a document without parsing the HTML. */
function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const body = (match[1] ?? '').trim();
    if (body === '') continue;
    try {
      blocks.push(JSON.parse(body));
    } catch {
      // Publishers ship malformed JSON-LD constantly. One bad block is not a
      // reason to abandon the others.
    }
  }
  return blocks;
}

/** A meta tag's content, for the handful of dates that live there. */
function metaContent(html: string, names: readonly string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`,
      'i',
    );
    const match = pattern.exec(html);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/**
 * Everything this page declares about itself, in machine-readable form.
 *
 * Returns empty rather than throwing on anything. A page with no structured
 * data is the common case, not an error, and the caller already has a reading
 * from the visible text.
 */
export function readStructured(html: string): StructuredFacts {
  if (html.length < 40) return EMPTY;

  const facts: StructuredFacts = { ...EMPTY, types: [] };
  const types = new Set<string>();

  for (const block of jsonLdBlocks(html)) {
    for (const node of everyObject(block)) {
      const type = node['@type'];
      if (typeof type === 'string') types.add(type);
      else if (Array.isArray(type)) for (const one of type) if (typeof one === 'string') types.add(one);

      if (facts.title === null) facts.title = text(node['name']) ?? text(node['headline']);
      if (facts.provider === null) {
        facts.provider =
          text(node['provider']) ?? text(node['organizer']) ?? text(node['hiringOrganization']);
      }
      if (facts.startDate === null) facts.startDate = isoDate(node['startDate']);

      // Best-first, and never overwritten by a weaker field once found.
      if (facts.deadline === null) {
        for (const field of DEADLINE_FIELDS) {
          const found = isoDate(node[field]);
          if (found !== null) {
            facts.deadline = found;
            facts.deadlineField = field;
            break;
          }
        }
      }

      // Money, wherever schema.org happens to have put it this time.
      const offers = node['offers'];
      const money = isRecord(offers) ? offers : node;
      if (facts.amount === null) {
        const raw = money['amount'] ?? money['value'] ?? money['price'];
        const amount = typeof raw === 'number' ? raw : Number(typeof raw === 'string' ? raw : NaN);
        if (Number.isFinite(amount) && amount > 0) facts.amount = amount;
      }
      if (facts.currency === null) {
        const code = text(money['currency'] ?? money['priceCurrency']);
        if (code !== null && /^[A-Z]{3}$/.test(code)) facts.currency = code;
      }
    }
  }

  facts.types = [...types];

  // Meta tags are a distant third, and only consulted when nothing better said
  // anything at all.
  if (facts.title === null) facts.title = metaContent(html, ['og:title', 'twitter:title']);

  return facts;
}

/** Whether anything at all was declared. */
export function hasStructuredFacts(facts: StructuredFacts): boolean {
  return (
    facts.deadline !== null || facts.amount !== null || facts.title !== null || facts.types.length > 0
  );
}
