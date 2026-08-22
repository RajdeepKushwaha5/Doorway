import { getCurrentMode } from '@/lib/state';
import { getOpportunityMode } from '@/lib/opportunity-modes';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The live opportunity page.
 *
 * Renders from the shared mode definition rather than from markup written
 * here. Before, this page built its own JSX and the permanent fixtures built
 * theirs, which meant the approval gate could replay against a page that never
 * served. Two sources for one page is the same class of bug this whole project
 * is about.
 */
export default async function FellowshipPage() {
  const modeId = await getCurrentMode();
  const mode = getOpportunityMode(modeId);

  return (
    <main style={{ maxWidth: 820, margin: '0 auto' }}>
      <p style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        Doorway Lab / Research opportunity
      </p>
      <div dangerouslySetInnerHTML={{ __html: mode.html }} />
      <p style={{ marginTop: 40, color: '#666', fontSize: 12 }}>
        Controlled fixture. Not a real opportunity. Current mode: <code>{mode.id}</code>
      </p>
    </main>
  );
}
