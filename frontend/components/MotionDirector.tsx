'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Scroll reveal, arranged so it can never withhold content.
 *
 * The earlier version hid every [data-reveal] element as soon as this ran,
 * then depended on an IntersectionObserver to restore each one. That makes the
 * page's legibility conditional on a browser API firing correctly for every
 * element, and when it did not the hero panel rendered into the HTML and stayed
 * blank on screen.
 *
 * The hidden state is now opt-in and applied only to elements that begin below
 * the fold, where hiding them changes nothing a reader can see. Anything
 * already on screen is left exactly as the server rendered it. If this file
 * throws, if the observer never fires, or if JavaScript is off entirely, the
 * page is complete and static rather than partly missing.
 */
export function MotionDirector() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const viewportHeight = window.innerHeight;

    const reveal = (node: Element): void => {
      node.classList.remove('is-pending');
      node.classList.add('is-visible');
    };

    // Only elements whose top edge starts below the viewport are candidates.
    // A partially visible element is already being read, and animating it out
    // and back in would be a flicker rather than an entrance.
    const pending = nodes.filter((node) => node.getBoundingClientRect().top >= viewportHeight);
    pending.forEach((node) => node.classList.add('is-pending'));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0, rootMargin: '0px 0px -6% 0px' },
    );
    pending.forEach((node) => observer.observe(node));

    // Last resort. Even with the above, a hidden element must not be able to
    // stay hidden indefinitely.
    const failOpen = window.setTimeout(() => pending.forEach(reveal), 2500);

    return () => {
      window.clearTimeout(failOpen);
      observer.disconnect();
      nodes.forEach((node) => node.classList.remove('is-pending'));
    };
  }, [pathname]);

  return null;
}
