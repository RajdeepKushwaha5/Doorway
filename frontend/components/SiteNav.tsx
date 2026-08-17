'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NoticeLogo } from '@/components/NoticeLogo';

/**
 * Every href here must match an `id` that exists on the page.
 *
 * Three of these pointed at sections the redesign removed, so a third of the
 * navigation silently did nothing when clicked. A dead nav link is worse than a
 * missing one: the reader assumes the page is broken rather than that the item
 * was never there.
 */
const links = [
  { href: '/#problem', label: 'DISCOVER', active: true },
  { href: '/#gap', label: 'THE GAP' },
  { href: '/#system', label: 'HOW IT WORKS' },
  { href: '/#automation', label: 'AUTOMATION' },
  { href: '/#control-room', label: 'CONTROL ROOM' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/verified', label: 'VERIFIED FEED' },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 sm:px-8 h-[52px] border-b border-gray-200 bg-white/95 backdrop-blur-sm transition-colors">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 select-none shrink-0 group">
          <NoticeLogo className="w-5 h-5 text-black transition-transform group-hover:scale-105" />
          <span className="font-mondwest font-normal not-italic text-[24px] leading-none tracking-tight text-gray-900">
            Notice
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1">
          {links.map((link) => {
            const isActive = pathname === link.href || (link.active && pathname === '/');
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`font-mono text-[11.5px] uppercase tracking-[0.1em] font-semibold px-3 py-1.5 rounded-[6px] transition-colors whitespace-nowrap ${
                  isActive
                    ? 'text-gray-900 bg-[#F0F2F5]'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <a
          href="https://brightdata.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-700 bg-emerald-50/80 border border-emerald-600/30 px-3 py-1.5 rounded-[6px] hover:bg-emerald-100/80 transition-colors whitespace-nowrap"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Bright Data Live
        </a>

        <a
          href="https://github.com/prabhatkumar67/notice"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-600 hover:text-gray-900 px-3 py-1.5 transition-colors whitespace-nowrap"
        >
          Source
        </a>

        <Link
          href="/#control-room"
          className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] px-4 py-1.5 bg-black text-white rounded-[6px] hover:bg-neutral-800 transition-colors whitespace-nowrap"
        >
          Control Room
        </Link>

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="inline-flex lg:hidden items-center gap-1 rounded-md px-2.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-gray-600 hover:bg-gray-100"
        >
          {open ? 'Close ▴' : 'Menu ▾'}
        </button>
      </div>

      {open ? (
        <div className="absolute top-full left-0 right-0 border-b border-gray-200 bg-white px-6 py-4 lg:hidden shadow-xl">
          <div className="flex flex-col gap-1.5">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="font-mono text-[12px] uppercase tracking-[0.1em] font-semibold px-3 py-2 rounded-md text-gray-700 hover:bg-gray-100"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </header>
  );
}
