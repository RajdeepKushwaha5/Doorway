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
    const show = (node: Element): void => node.classList.add('is-visible');

    if (reduced) {
      revealNodes.forEach(show);
      return () => root.classList.remove('motion-ready');
    }

    // Anything already on screen is revealed straight away rather than waiting
    // for the observer. A 0.14 threshold combined with the overflow-x clipping
    // on html and body can leave an element that is plainly visible below the
    // ratio, and the hero panel then never appears at all.
    revealNodes.forEach((node) => {
      const box = node.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) show(node);
    });

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          show(entry.target);
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -8% 0px' },
    );
    revealNodes.forEach((node) => revealObserver.observe(node));

    // Fail open. An entrance animation must never be able to hide content
    // permanently: if the observer does not fire, for any reason, the reader
    // is left staring at a blank column with no way to recover.
    const failOpen = window.setTimeout(() => revealNodes.forEach(show), 2000);

    return () => {
      window.clearTimeout(failOpen);
      revealObserver.disconnect();
      root.classList.remove('motion-ready');
    };
  }, [pathname]);

  return null;
}
