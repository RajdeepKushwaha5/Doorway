'use client';

import { useEffect, useRef, useState } from 'react';

export function WordReveal({ text }: { text: string }) {
  const root = useRef<HTMLParagraphElement>(null);
  const [visibleWords, setVisibleWords] = useState(0);

  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const timers: number[] = [];
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting !== true) return;
        text.split(' ').forEach((_, index) => {
          timers.push(window.setTimeout(() => setVisibleWords(index + 1), index * 55));
        });
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [text]);

  return (
    <p ref={root} className="max-w-4xl text-4xl font-medium tracking-tight md:text-6xl">
      {text.split(' ').map((word, index) => (
        <span
          key={`${word}-${String(index)}`}
          className={`mr-1 inline-block transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${index < visibleWords ? 'translate-y-0 text-ivory opacity-100' : 'translate-y-4 text-ivory opacity-30'}`}
        >
          {word}
        </span>
      ))}
    </p>
  );
}
