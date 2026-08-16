import { notFound } from 'next/navigation';
import { getMode, isModeId, MODE_IDS } from '@/lib/modes';

/**
 * Permanent, immutable fixtures.
 *
 * Every mode is always reachable at its own stable URL regardless of what the
 * live page is currently serving. This is what makes the approval gate
 * possible: after Self-Healing proposes a repair, the candidate is replayed
 * against every one of these, so "it fixed the incident" and "it did not break
 * anything that used to work" are both checkable claims rather than hopes.
 */
export const dynamic = 'force-static';

export function generateStaticParams(): { mode: string }[] {
  return MODE_IDS.map((mode) => ({ mode }));
}

export default async function FixturePage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode: modeParam } = await params;
  if (!isModeId(modeParam)) notFound();

  const mode = getMode(modeParam);

  return (
    <>
      <h1 style={{ fontSize: 20, marginBottom: '0.5rem' }}>DriftMart fixture</h1>
      <p style={{ color: '#555', fontSize: 14, marginTop: 0 }}>
        <code>{mode.id}</code> · {mode.label}
      </p>
      <p style={{ color: '#555', fontSize: 13 }}>
        Semantic change: <strong>{mode.semanticChange ? 'yes' : 'no'}</strong>.{' '}
        {mode.semanticChange
          ? 'A correct collector should return a different value here. This must not be healed.'
          : 'A correct collector should return the baseline value here.'}
      </p>
      <hr style={{ margin: '1.5rem 0', border: 0, borderTop: '1px solid #ddd' }} />
      <div dangerouslySetInnerHTML={{ __html: mode.html }} />
    </>
  );
}
