'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NoticeLogo } from '@/components/NoticeLogo';

const links = [
  { href: '/#world', label: 'OPPORTUNITY WORLD', active: true },
  { href: '/proof', label: 'CHECK IT YOURSELF' },
  { href: '/#system', label: 'HOW IT LIVES' },
  { href: '/verified', label: 'VERIFIED FEED' },
  { href: '/engine', label: 'TRUST ENGINE' },
  { href: '/verify', label: 'VERIFY' },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-stretch justify-between h-[56px] border-b border-gray-200 bg-[#fafafa]/90 backdrop-blur-md transition-colors select-none">
      {/* Left Brand Cell */}
      <Link
        href="/"
        className="flex items-center gap-2.5 px-5 sm:px-7 border-r border-gray-200 hover:bg-white transition-colors group shrink-0"
      >
        <NoticeLogo className="w-5 h-5 text-black transition-transform group-hover:scale-105" />
        <span className="font-mondwest font-normal not-italic text-[25px] leading-none tracking-tight text-gray-900">
          Doorway
        </span>
        <span className="font-mono text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded leading-none border border-emerald-300/40">
          '26
        </span>
      </Link>

      {/* Middle Grid Nav Link Cells (GitHub Universe Style) */}
      <nav className="hidden lg:flex items-stretch h-full flex-1">
        {links.map((link) => {
          const isActive = pathname === link.href || (link.active && pathname === '/');
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-grid-cell group ${isActive ? 'is-active' : ''}`}
            >
              <span className="text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity font-bold mr-1 -ml-1">
                [
              </span>
              <span>{link.label}</span>
              <span className="text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity font-bold ml-1 -mr-1">
                ]
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Right Action Cells */}
      <div className="flex items-stretch h-full shrink-0">
        <a
          href="https://brightdata.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden 2xl:flex items-center gap-2 px-4 border-l border-r border-gray-200 text-[11px] font-mono font-semibold text-emerald-800 bg-emerald-50/50 hover:bg-emerald-100/70 transition-colors whitespace-nowrap"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Bright Data Live
        </a>

        <a
          href="https://github.com/RajdeepKushwaha5/Doorway"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center px-5 border-l border-r border-gray-200 font-mono text-[11.5px] uppercase font-semibold text-gray-700 hover:text-black hover:bg-white transition-colors whitespace-nowrap"
        >
          Source ↗
        </a>

        {/* Solid Green CTA Cell (Matching GitHub Universe 'Get passes ↗') */}
        <Link
          href="/#world"
          className="nav-cta-cell hidden sm:flex items-center"
        >
          Build World ↗
        </Link>

        {/* Mobile Toggle Button */}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="inline-flex lg:hidden items-center px-4 font-mono text-[12px] uppercase font-bold text-gray-700 hover:bg-gray-100 border-l border-gray-200"
        >
          {open ? 'Close ▴' : 'Menu ▾'}
        </button>
      </div>

      {/* Mobile Menu Dropdown */}
      {open ? (
        <div className="absolute top-full left-0 right-0 border-b border-gray-200 bg-white lg:hidden shadow-2xl">
          <div className="flex flex-col divide-y divide-gray-100">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="font-mono text-[12px] uppercase tracking-[0.1em] font-semibold px-6 py-3.5 text-gray-700 hover:bg-gray-50 hover:text-emerald-600 flex items-center justify-between"
              >
                <span>{link.label}</span>
                <span className="text-gray-400">→</span>
              </Link>
            ))}
            <Link
              href="/#world"
              onClick={() => setOpen(false)}
              className="font-mono text-[12px] uppercase tracking-[0.1em] font-bold px-6 py-4 bg-emerald-500 text-black text-center"
            >
              Build My World ↗
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
