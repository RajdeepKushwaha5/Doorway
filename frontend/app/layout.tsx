import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { MotionDirector } from '@/components/MotionDirector';
import { SiteNav } from '@/components/SiteNav';
import { NoticeLogo } from '@/components/NoticeLogo';
import { siteUrl } from '@/lib/env';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: 'NOTICE | Trust the data, not the green check',
    template: '%s | NOTICE',
  },
  description:
    'NOTICE catches believable but wrong scraper data, decides whether the site changed or the extractor broke, and proves every repair before production.',
  openGraph: {
    title: 'NOTICE | Trust the data, not the green check',
    description: 'The verification layer for Bright Data Scraper Studio collectors.',
    images: ['/notice-signal-hero.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-surface font-sans text-ivory antialiased">
        <MotionDirector />
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-[100] -translate-y-24 bg-ivory px-4 py-2 text-sm font-semibold text-surface-raised transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:translate-y-0"
        >
          Skip to content
        </a>
        <SiteNav />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <div className="site-footer__intro">
          <NoticeLogo inverse />
          <h2>Proof infrastructure<br />for live web data.</h2>
          <p>Two independent signals. One decision your product can defend.</p>
        </div>
        <FooterColumn title="Product" links={[["How it works", "/#system"], ["Verification proof", "/#proof"], ["Verified feed", "/verified"], ["Control room", "/#control-room"]]} />
        <FooterColumn title="Resources" links={[["Bright Data CLI", "https://github.com/brightdata/cli"], ["Scraper Studio", "https://brightdata.com/products/web-scraper/studio"], ["Scrape Verse", "https://www.wemakedevs.org/hackathons/scrape-verse"]]} />
        <FooterColumn title="Company" links={[["Privacy", "/privacy"], ["Terms", "/terms"], ["Home", "/"]]} />
      </div>
      <div className="site-footer__legal"><span>© 2026 NOTICE</span><span>BUILT WITH BRIGHT DATA</span></div>
      {/*
        Mark above word, in a column, so the logo can never sit on top of the
        letters. Both were absolutely positioned and centred before, which put
        the square over the middle of the word and hid two characters.
      */}
      <div className="site-footer__sign" aria-hidden>
        <div className="site-footer__mark"><NoticeLogo inverse compact /></div>
        <div className="site-footer__word">
          {/*
            textLength pins the rendered width to the viewBox regardless of the
            font's metrics, so the word spans the full footer at any viewport
            instead of being guessed at with a vw font size that stops growing
            at its clamp ceiling. lengthAdjust="spacing" tightens the gaps and
            leaves the glyph shapes undistorted.
          */}
          <svg viewBox="0 0 1000 170" preserveAspectRatio="xMidYMax meet" role="presentation">
            <text x="500" y="155" textLength="960" lengthAdjust="spacing" textAnchor="middle">
              NOTICE
            </text>
          </svg>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<[string, string]> }) {
  return <div className="site-footer__column"><p>{title}</p>{links.map(([label, href]) => href.startsWith('http') ? <a key={href} href={href}>{label}</a> : <Link key={href} href={href}>{label}</Link>)}</div>;
}
