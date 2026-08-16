'use client';

import { ArrowClockwise, WarningOctagon } from '@phosphor-icons/react';

export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="bg-surface pt-20"><div className="section-index mx-auto max-w-7xl"><span>SYSTEM STATE</span><span>[ READ FAILED ]</span></div><div className="mx-auto flex min-h-[72vh] max-w-3xl items-center px-6 py-24">
      <section className="w-full border border-ember bg-coralSoft p-8 sm:p-12" data-reveal>
        <WarningOctagon size={32} weight="duotone" className="text-blocked" />
        <p className="eyebrow mt-8">Unexpected failure</p>
        <h1 className="mt-4 text-4xl font-medium tracking-tight text-ivory">The evidence view could not load.</h1>
        <p className="mt-4 max-w-xl leading-7 text-muted">Nothing has been approved or changed. Retry the read when the service is available.</p>
        <button type="button" onClick={reset} className="primary-button mt-8"><ArrowClockwise size={18} /> Try again</button>
      </section></div>
    </div>
  );
}
