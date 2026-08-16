'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sticky navigation.
 *
 * Small monospace labels rather than a heavier sans, so the bar reads as
 * instrumentation and gives the serif headline the only strong voice on the
 * page. The active item is marked by ink weight rather than colour, because
 * colour here means a verdict.
 */

const links = [
  { href: '/#problem', label: 'Problem' },
  { href: '/#system', label: 'How it works' },
  { href: '/#gate', label: 'Deploy gate' },
  { href: '/#agents', label: 'For agents' },
  { href: '/verified', label: 'Verified feed' },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-surface-border bg-surface-raised/85 backdrop-blur-xl">
      <nav
        className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-8 px-6 lg:px-10"
        aria-label="Primary navigation"
      >
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Mark />
          <span className="font-display text-xl leading-none">NOTICE</span>
        </Link>

        <div className="ml-2 hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? 'page' : undefined}
              className={`text-[12px] uppercase tracking-eyebrow transition-colors duration-200 hover:text-ivory ${
                pathname === link.href ? 'text-ivory' : 'text-muted'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <a
            href="https://github.com/prabhatkumar67/notice"
            className="hidden text-[12px] uppercase tracking-eyebrow text-muted transition-colors hover:text-ivory sm:inline"
          >
            Source
          </a>
          <Link href="/#control-room" className="primary-button">
            Control room <span aria-hidden>→</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-label="Toggle navigation"
            className="md:hidden rounded-card border border-surface-border px-3 py-2 text-[12px]"
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </nav>

      {open ? (
        <div className="border-t border-surface-border bg-surface-raised px-6 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="text-[12px] uppercase tracking-eyebrow text-muted"
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

/** The mark: a circle with a checked centre, drawn rather than imported. */
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
