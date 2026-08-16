import Link from 'next/link';

export const metadata = { title: 'Terms' };

export default function TermsPage() {
  return (
    <div className="bg-surface pt-20"><div className="section-index mx-auto max-w-7xl"><span>NOTICE POLICIES</span><span>[ TERMS ]</span></div><article data-reveal className="prose-notice policy-page">
      <p className="eyebrow">Clear operating boundaries</p><h1>Terms</h1>
      <p className="lead">NOTICE is a verification tool. It provides evidence and safety gates, not a guarantee that every web value is correct.</p>
      <div className="policy-page__body"><h2>Operator responsibility</h2><p>Operators are responsible for the websites they access, the contracts they configure, the repairs they approve, and the decisions made from collected data.</p>
      <h2>Safe defaults</h2><p>When evidence is insufficient, NOTICE withholds data or blocks promotion. Operators should review incident evidence before overriding a blocked decision.</p>
      <h2>Availability</h2><p>This hackathon release is provided as a demonstration without warranties of uninterrupted service or fitness for a particular purpose.</p></div>
      <Link href="/" className="secondary-button mt-12">Return home</Link>
    </article></div>
  );
}
