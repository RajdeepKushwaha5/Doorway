import { getCurrentMode } from '@/lib/state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function FellowshipPage() {
  const mode = await getCurrentMode();
  const genuineChange = mode === 'genuine_price_change';
  const selectorDrift = mode === 'selector_drift';
  const missingField = mode === 'missing_field';
  const sponsored = mode === 'sponsored_insertion';

  return (
    <main style={{ maxWidth: 820, margin: '0 auto' }}>
      <p style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        Doorway Lab / Research opportunity
      </p>
      {sponsored ? (
        <aside className="sponsored-opportunity" style={{ border: '1px solid #aaa', padding: 16 }}>
          <strong>Sponsored programme</strong>
          <h2>Fast Track AI Certificate</h2>
          <p>Deadline: 2 September 2026</p>
        </aside>
      ) : null}
      <article data-opportunity="ai-research-fellowship">
        <h1 className="opportunity-title">Open AI Research Fellowship</h1>
        <p>
          <strong>Provider:</strong> <span className="provider">Doorway Research Foundation</span>
        </p>
        <p>
          A controlled, fully funded research fellowship for undergraduate students interested in
          trustworthy artificial intelligence.
        </p>
        <dl style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '12px 20px' }}>
          <dt>Opportunity type</dt>
          <dd className="opportunity-type">fellowship</dd>
          <dt>Funding</dt>
          <dd className="funding-level">Fully funded</dd>
          <dt>Location</dt>
          <dd className="location">India</dd>
          <dt>Eligibility</dt>
          <dd className="eligibility">Undergraduate students interested in artificial intelligence</dd>
          <dt>{selectorDrift ? 'Early interest deadline' : 'Application deadline'}</dt>
          <dd className={selectorDrift ? 'application-deadline' : 'deadline'}>
            {selectorDrift ? '1 September 2026' : genuineChange ? '30 September 2026' : '18 September 2026'}
          </dd>
          {selectorDrift ? (
            <>
              <dt>Application deadline</dt>
              <dd className="real-deadline">18 September 2026</dd>
            </>
          ) : null}
          <dt>Required documents</dt>
          <dd className="documents">CV, transcript, research statement</dd>
        </dl>
        {!missingField ? (
          <p style={{ marginTop: 28 }}>
            <a className="application-url" href="/opportunity/ai-fellowship/apply">
              Start application
            </a>
          </p>
        ) : (
          <p style={{ marginTop: 28 }}>Applications are open. Contact the programme team for access.</p>
        )}
      </article>
      <p style={{ marginTop: 40, color: '#666', fontSize: 12 }}>
        Fixture mode: <code>{mode}</code>
      </p>
    </main>
  );
}
