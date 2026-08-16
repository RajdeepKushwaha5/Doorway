import { getMode } from '@/lib/modes';
import { getCurrentMode } from '@/lib/state';

/**
 * The live product page.
 *
 * The URL never changes. Only the markup underneath it does, which is the
 * whole point: a collector bound to this URL keeps running while the page
 * shifts beneath it, exactly as a real redesign would behave.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function LiveProductPage() {
  const modeId = await getCurrentMode();
  const mode = getMode(modeId);

  return (
    <>
      <h1 style={{ fontSize: 20, marginBottom: '0.5rem' }}>DriftMart</h1>
      <p style={{ color: '#555', fontSize: 14, marginTop: 0 }}>
        Serving mode <code>{mode.id}</code>
      </p>
      <hr style={{ margin: '1.5rem 0', border: 0, borderTop: '1px solid #ddd' }} />
      {/* Rendered from the shared mode definition so this page and the
          permanent fixture for the same mode are byte-identical. If they could
          drift apart, the regression corpus would be testing markup the live
          page never actually served. */}
      <div dangerouslySetInnerHTML={{ __html: mode.html }} />
    </>
  );
}
