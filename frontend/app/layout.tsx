import type { Metadata } from 'next';
import { Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import { MotionDirector } from '@/components/MotionDirector';
import { SiteNav } from '@/components/SiteNav';
import { siteUrl } from '@/lib/env';
import './globals.css';

// A high-contrast serif for display and monospace for everything else. The
// serif gives the page a voice; the mono keeps every number, field name and
// status reading as data, which is most of what this interface shows.
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
});
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

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
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-surface font-mono text-ivory antialiased">
        <MotionDirector />
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-[100] -translate-y-24 bg-ivory px-4 py-2 text-sm text-surface-raised transition-transform duration-300 focus:translate-y-0"
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
    <footer className="border-t border-surface-border bg-surface-raised">
      <div className="mx-auto max-w-[1400px] px-6 py-20 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_repeat(4,0.7fr)]">
          <div className="max-w-xs">
            <p className="font-display text-3xl">NOTICE</p>
            <p className="mt-4 text-sm leading-6 text-muted">
              The verification layer for live web data. Two independent Bright Data sensors, one
              decision your product can defend.
            </p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-surface-border px-3 py-1 text-[11px] uppercase tracking-eyebrow text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-verified" aria-hidden />
              Built with Bright Data
            </p>
          </div>

          <FooterColumn
            title="Product"
            links={[
              ['How it works', '/#system'],
              ['Proof', '/#proof'],
              ['Verified feed', '/verified'],
              ['Control room', '/#control-room'],
            ]}
          />
          <FooterColumn
            title="Developers"
            links={[
              ['Deploy gate', '/#gate'],
              ['MCP server', '/#agents'],
              ['Source', 'https://github.com/prabhatkumar67/notice'],
            ]}
          />
          <FooterColumn
            title="Bright Data"
            links={[
              ['Scraper Studio', 'https://brightdata.com/products/web-scraper/studio'],
              ['Web Unlocker', 'https://brightdata.com/products/web-unlocker'],
              ['CLI', 'https://github.com/brightdata/cli'],
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              ['Privacy', '/privacy'],
              ['Terms', '/terms'],
            ]}
          />
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-surface-border pt-8 text-[11px] uppercase tracking-eyebrow text-muted">
          <span>© 2026 NOTICE. Trust the data, not the green check.</span>
          <span>Into the Scrape-Verse</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-eyebrow text-muted">{title}</p>
      <div className="mt-4 flex flex-col gap-3 text-sm">
        {links.map(([label, href]) =>
          href.startsWith('http') ? (
            <a key={href} href={href} className="text-ivory transition-colors hover:text-verified">
              {label}
            </a>
          ) : (
            <Link key={href} href={href} className="text-ivory transition-colors hover:text-verified">
              {label}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
