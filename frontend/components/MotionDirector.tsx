'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function MotionDirector() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.classList.add('motion-ready');

    const revealNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (reduced) {
      revealNodes.forEach((node) => node.classList.add('is-visible'));
    }

    const revealObserver = reduced
      ? null
      : new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add('is-visible');
              revealObserver?.unobserve(entry.target);
            });
          },
          { threshold: 0.14, rootMargin: '0px 0px -8% 0px' },
        );
    revealNodes.forEach((node) => revealObserver?.observe(node));

    return () => {
      revealObserver?.disconnect();
      root.classList.remove('motion-ready');
    };
  }, [pathname]);

  return null;
}
