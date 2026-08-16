import Link from 'next/link';

export const metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return <Policy title="Privacy" intro="NOTICE is designed to inspect scraper health without turning evidence into a new data collection problem.">
    <h2>What NOTICE stores</h2><p>NOTICE stores collector run metadata, contract results, witness evidence, repair status, and audit history needed to explain a decision. Deployment operators control their own storage and retention.</p>
    <h2>Secrets</h2><p>Bright Data credentials and administrator tokens belong in server environment variables. They are never intentionally exposed to the browser.</p>
    <h2>Evidence</h2><p>Evidence can include short source lines and content hashes used to verify extracted fields. Operators should configure targets and retention according to their own privacy obligations.</p>
  </Policy>;
}

function Policy({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return <div className="bg-surface pt-20"><div className="section-index mx-auto max-w-7xl"><span>NOTICE POLICIES</span><span>[ PRIVACY ]</span></div><article data-reveal className="prose-notice policy-page"><p className="eyebrow">Evidence with boundaries</p><h1>{title}</h1><p className="lead">{intro}</p><div className="policy-page__body">{children}</div><Link href="/" className="secondary-button mt-12">Return home</Link></article></div>;
}
