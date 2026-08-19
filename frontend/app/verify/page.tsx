import type { Metadata } from 'next';
import Link from 'next/link';
import { CertificateVerifier } from '@/components/CertificateVerifier';

export const metadata: Metadata = {
  title: 'Verify a certificate',
  description:
    'Re-derive the digest of a NOTICE evidence certificate in your own browser. Change any value and it fails.',
};

export default function VerifyPage() {
  return (
    <div className="bg-surface pt-10">
      <div className="section-index mx-auto max-w-5xl">
        <span>INDEPENDENT VERIFIER</span>
        <span>OFFLINE</span>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-24 pt-10 lg:px-8">
        <Link href="/" className="footer-link inline-flex items-center gap-2 text-sm">
          ← Back
        </Link>

        <h1 className="mt-8 max-w-3xl font-mondwest text-4xl font-normal not-italic leading-[1.0] tracking-tight text-gray-900 sm:text-5xl">
          Do not take our word for the verdict.
        </h1>

        <p className="mt-6 max-w-[68ch] font-mono text-[13.5px] leading-relaxed text-muted">
          Every incident can be exported as a certificate: the verdict, what each sensor read, the
          line the witness read it from, and a SHA-256 of the page body it read. The document
          carries a digest over all of that, so changing any single value breaks it.
        </p>

        <p className="mt-4 max-w-[68ch] font-mono text-[13.5px] leading-relaxed text-muted">
          This page re-derives that digest{' '}
          <span className="text-ivory">in your browser, with no network calls</span>. A verifier
          that asked our server whether our own document is valid would prove nothing — the answer
          would be exactly as trustworthy as the claim it checks.
        </p>

        <div className="mt-8 rounded-lg border border-surface-border bg-surface-soft/40 p-5 font-mono text-[12px] leading-relaxed text-muted">
          <p className="text-ivory">Get one:</p>
          <pre className="mt-2 overflow-x-auto">
            curl https://notice-api-0vfo.onrender.com/api/incidents/&lt;incident-id&gt;/certificate
          </pre>
          <p className="mt-3">
            Or open any incident from the control room and use its Certificate link. Then edit a
            single character in the JSON below and watch it fail.
          </p>
        </div>

        <CertificateVerifier />

        <div className="mt-12 border-t border-surface-border pt-6 font-mono text-[12px] leading-relaxed text-muted">
          <p className="text-ivory">What this does and does not prove.</p>
          <p className="mt-2">
            It proves the document has not been edited since it was issued. It is not a signature,
            so it does not prove NOTICE issued it — a forger could mint a fresh certificate with a
            matching digest. That is the honest limit, and it is stated here rather than left for
            you to find. The claim worth checking is the one about the evidence, not about us.
          </p>
        </div>
      </div>
    </div>
  );
}
