'use client';

import { useEffect, useState } from 'react';

/**
 * Say why the wait is long, once it is long enough to need saying.
 *
 * The API sleeps after fifteen minutes idle on a free plan, and the request
 * that wakes it can take most of a minute. The page already waits that long
 * rather than giving up, which is the right behaviour and looks identical to
 * being broken: a visitor sees pulsing grey boxes and no reason for them.
 *
 * Nothing is shown for the first few seconds, so a warm load never flashes an
 * explanation for a wait that did not happen. After that the reason appears,
 * and after longer it says what is actually going on, because by then the
 * visitor has earned more than a spinner.
 *
 * Deliberately not a progress bar. There is no progress to report, and a bar
 * that fills on a timer is a guess presented as information.
 */

/** When each line appears. Nothing before the first: a fast load stays silent. */
const FIRST_MS = 3_500;
const SECOND_MS = 14_000;

export function WakeNotice() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (elapsed < FIRST_MS) return null;

  return (
    <div
      className="mt-10 max-w-[52ch] border border-surface-border bg-surface-soft p-4"
      role="status"
      aria-live="polite"
    >
      <p className="font-mono text-[12px] leading-relaxed text-muted">
        Waking the API. It sleeps after fifteen minutes idle on the free plan, so the first
        request after a quiet period takes a little while.
      </p>
      {elapsed < SECOND_MS ? null : (
        <p className="mt-3 font-mono text-[12px] leading-relaxed text-muted">
          Still going. This page waits rather than giving up, because the alternative is
          telling you the service is unreachable when it is only starting.
        </p>
      )}
    </div>
  );
}
