import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import { MotionDirector } from '@/components/MotionDirector';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { siteUrl } from '@/lib/env';
import './globals.css';

const mondwest = localFont({
  src: '../public/fonts/ppmondwest-regular.otf',
  variable: '--font-mondwest',
  display: 'swap',
});

const neuebit = localFont({
  src: '../public/fonts/ppneuebit-bold.otf',
  variable: '--font-neuebit',
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
    <html lang="en" className={`${mondwest.variable} ${neuebit.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-surface font-mono text-ivory antialiased pt-[52px]">
        <MotionDirector />
        <SiteNav />
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-[100] -translate-y-24 bg-ivory px-4 py-2 text-sm text-surface-raised transition-transform duration-300 focus:translate-y-0"
        >
          Skip to content
        </a>
        <main id="main-content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
