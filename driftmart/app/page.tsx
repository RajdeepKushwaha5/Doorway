import { MODES, MODE_IDS } from '@/lib/modes';
import { getCurrentMode } from '@/lib/state';

/**
 * Index for the fixture.
 *
 * Exists because a bare 404 at the root reads as a broken deployment. Anyone
 * who lands here, a judge or a curious visitor, should immediately understand
 * what this host is, what it is not, and which URL does what.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DriftMartIndex() {
  const current = await getCurrentMode();

  return (
    <>
      <h1 style={{ fontSize: 22, marginBottom: '0.25rem' }}>DriftMart</h1>
      <p style={{ color: '#555', marginTop: 0, fontSize: 14 }}>
        A controlled fault-injection target for the NOTICE project. Currently serving mode{' '}
        <code>{current}</code>.
      </p>

      <h2 style={{ fontSize: 16, marginTop: '2rem' }}>The live page</h2>
      <p style={{ fontSize: 14, color: '#555' }}>
        One URL whose markup changes underneath it, the way a real redesign behaves. A collector
        bound to this address keeps running while the page shifts.
      </p>
      <p>
        <a href="/product/headphones">/product/headphones</a>
      </p>

      <h2 style={{ fontSize: 16, marginTop: '2rem' }}>Permanent fixtures</h2>
      <p style={{ fontSize: 14, color: '#555' }}>
        Every mode is always reachable at its own stable URL, whatever the live page is serving.
        This is what makes a regression corpus possible: after a repair is proposed, it can be
        checked against each of these, so &quot;it fixed the incident&quot; and &quot;it broke
        nothing that worked&quot; are both answerable.
      </p>
      <ul style={{ fontSize: 14, lineHeight: 1.9 }}>
        {MODE_IDS.map((id) => {
          const mode = MODES[id];
          return (
            <li key={id}>
              <a href={`/fixtures/${id}`}>/fixtures/{id}</a>
              <br />
              <span style={{ color: '#555' }}>
                {mode.label}{' '}
                <strong>
                  {mode.semanticChange
                    ? 'The underlying fact really changed here, so a correct run produces no repair.'
                    : ''}
                </strong>
              </span>
            </li>
          );
        })}
      </ul>

      <h2 style={{ fontSize: 16, marginTop: '2rem' }}>Why this exists</h2>
      <p style={{ fontSize: 14, color: '#555', maxWidth: '46rem' }}>
        NOTICE decides whether a website changed or a scraper broke. Proving it needs a page that
        can be made to do both on demand, which no real store will do on cue. The live page and the
        fixture for a given mode render from the same definition, so the fixtures cannot drift away
        from what the live page actually served.
      </p>
    </>
  );
}
