import Link from 'next/link';
import { ArrowLeft, Binoculars } from '@phosphor-icons/react/dist/ssr';

export default function NotFound() {
  return (
    <div className="bg-surface pt-20"><div className="section-index mx-auto max-w-7xl"><span>LOST SIGNAL</span><span>[ 404 ]</span></div><div className="mx-auto flex min-h-[72vh] max-w-7xl items-center px-6 py-24 lg:px-8">
      <section data-reveal className="grid w-full gap-12 border border-surface-border bg-surface-raised p-8 lg:grid-cols-[0.6fr_1fr] lg:items-end lg:p-16">
        <div>
          <p className="font-mono text-8xl tracking-tighter text-ember sm:text-9xl">404</p>
          <p className="eyebrow mt-4">Evidence not found</p>
        </div>
        <div>
          <Binoculars size={32} weight="duotone" className="text-muted" />
          <h1 className="mt-8 text-4xl font-medium tracking-tight text-ivory sm:text-6xl">This trail went cold.</h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted">The incident may have moved, expired, or never existed. Return to the control room to inspect the evidence NOTICE still has.</p>
          <Link href="/#control-room" className="primary-button mt-8"><ArrowLeft size={18} /> Open control room</Link>
        </div>
      </section></div>
    </div>
  );
}
