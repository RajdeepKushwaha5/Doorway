import { WakeNotice } from '@/components/WakeNotice';

/**
 * Shown while a server render waits.
 *
 * The skeleton is the shape of what is coming. The notice underneath is the
 * reason it is taking a while, and it only appears once the wait is long
 * enough to need explaining, so a warm load stays quiet.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto min-h-[72vh] max-w-7xl animate-pulse px-6 pb-24 pt-36 lg:px-8"
      aria-label="Loading evidence"
    >
      <div className="h-3 w-24 bg-surface-border" />
      <div className="mt-8 h-16 max-w-3xl bg-surface-soft" />
      <div className="mt-4 h-6 max-w-xl bg-surface-soft" />
      <div className="mt-12 grid gap-8 lg:grid-cols-3">
        <div className="h-72 border border-surface-border bg-surface-raised lg:col-span-2" />
        <div className="h-72 border border-surface-border bg-surface-raised" />
      </div>
      {/* Outside the pulse: a message that throbs is harder to read, and this
          one is the only thing on screen actually saying anything. */}
      <div className="animate-none">
        <WakeNotice />
      </div>
    </div>
  );
}
