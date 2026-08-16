'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NoticeLogo } from './NoticeLogo';

const links = [
  { href: '/#story', label: 'Why NOTICE' },
  { href: '/#system', label: 'How it works' },
  { href: '/#proof', label: 'Proof' },
  { href: '/verified', label: 'Verified deals' },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <header className="site-nav-shell pointer-events-none fixed inset-x-0 top-0 z-50 border-b border-surface-border bg-surface-raised/95">
        <nav
          className="pointer-events-auto mx-auto flex h-20 w-full max-w-7xl items-center px-6 backdrop-blur-xl md:px-8"
          aria-label="Primary navigation"
        >
          <NoticeLogo />
          <div className="ml-auto hidden items-center gap-8 md:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? 'page' : undefined}
                className={`text-sm transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-ivory ${pathname === link.href ? 'text-ember' : 'text-muted'}`}
              >
                {link.label}
              </Link>
            ))}
            <Link href="/#control-room" className="primary-button !text-sm">
              Open control room <span aria-hidden>↗</span>
            </Link>
          </div>
          <button
            type="button"
            className="relative ml-auto h-10 w-10 border border-surface-border md:hidden"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            onClick={() => setOpen((value) => !value)}
          >
            <span
              className={`absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 bg-ivory transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? 'rotate-45' : '-translate-y-1'}`}
            />
            <span
              className={`absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 bg-ivory transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? '-rotate-45' : 'translate-y-1'}`}
            />
          </button>
        </nav>
      </header>
      <div
        id="mobile-navigation"
        className={`fixed inset-0 z-40 flex items-center bg-surface/95 px-8 backdrop-blur-3xl transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] md:hidden ${open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <div className="w-full space-y-6">
          {links.map((link, index) => (
            <div
              key={link.href}
              className={`overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
              style={{ transitionDelay: `${String(100 + index * 50)}ms` }}
            >
              <Link href={link.href} aria-current={pathname === link.href ? 'page' : undefined} className={`block text-3xl font-medium ${pathname === link.href ? 'text-ember' : ''}`} onClick={() => setOpen(false)}>
                {link.label}
              </Link>
            </div>
          ))}
          <Link href="/#control-room" className="primary-button mt-6 w-full" onClick={() => setOpen(false)}>
            Open control room
          </Link>
        </div>
      </div>
    </>
  );
}
