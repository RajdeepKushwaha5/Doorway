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
    default: 'Doorway | Find the opportunities the web hides',
    template: '%s | Doorway',
  },
  description:
    'Doorway turns scattered scholarships, fellowships, internships and grants into a living, verified opportunity world built with Bright Data.',
  openGraph: {
    title: 'Doorway | Find the opportunities the web hides',
    description: 'A living opportunity world built and maintained with Bright Data Scraper Studio.',
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
