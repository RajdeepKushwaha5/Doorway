import { getCurrentMode } from '@/lib/state';
import { findProduct, queryFieldName, resultHtml } from '@/lib/search';

/**
 * The page a collector has to drive rather than read.
 *
 * Results render only for a submitted term, so getting a specific product
 * means typing into the box and clicking the button. That is what Scraper
 * Studio's interaction functions are for, and it is the part of the platform a
 * single `navigate` never exercises.
 *
 * The form is a plain GET so the results are server-rendered and every sensor
 * can see them. Requiring JavaScript would have made the page invisible to a
 * non-rendering fetch, which is the mistake that makes a fixture prove nothing.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const mode = await getCurrentMode();
  const field = queryFieldName(mode);

  const raw = params['q'];
  const term = Array.isArray(raw) ? raw[0] : raw;
  const submitted = 'q' in params || 'query' in params;
  const { product, matched } = findProduct(term);

  return (
    <>
      <h1 style={{ fontSize: 20, marginBottom: '0.5rem' }}>DriftMart search</h1>
      <p style={{ color: '#555', fontSize: 14, marginTop: 0 }}>
        Serving mode <code>{mode}</code>
      </p>
      <hr style={{ margin: '1.5rem 0', border: 0, borderTop: '1px solid #ddd' }} />

      {/*
        The input keeps its id in every mode. Only the submitted field name
        moves, which is what an ordinary front-end refactor looks like and why
        a collector bound to the id goes on working while the server stops
        receiving the term.
      */}
      <form method="get" action="/search" className="search-form">
        <label htmlFor="site-search">Search the catalogue</label>
        <br />
        <input
          id="site-search"
          name={field}
          type="text"
          placeholder="Try: Nova"
          defaultValue={term ?? ''}
          style={{ padding: '0.4rem', fontSize: 14, minWidth: 220 }}
        />
        <button id="do-search" type="submit" style={{ padding: '0.4rem 0.9rem', marginLeft: 8 }}>
          Search
        </button>
      </form>

      {submitted ? (
        <div dangerouslySetInnerHTML={{ __html: resultHtml(product, matched) }} />
      ) : (
        <p className="hint" style={{ color: '#777', fontSize: 14 }}>
          Enter a product name to see its price.
        </p>
      )}
    </>
  );
}
