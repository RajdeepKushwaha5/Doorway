import type { IncidentClassification } from '@/lib/types';

/**
 * Status is never communicated by colour alone.
 *
 * Every chip carries a word as well as a hue, for colour-blind readers and for
 * judges watching a compressed video where the palette flattens. The wording
 * is also chosen to say what NOTICE concluded rather than how it feels:
 * "source changed" and "extractor drifted" are different facts, and a chip
 * that says "error" for both would hide the distinction the product exists to
 * make.
 */

const PRESENTATION: Record<
  IncidentClassification,
  { label: string; className: string; hint: string }
> = {
  healthy: {
    label: 'Verified',
    className: 'bg-ivory text-surface-raised border border-ivory',
    hint: 'Contract checks passed and the witness agrees.',
  },
  genuine_source_change: {
    label: 'Source changed',
    className: 'bg-surface-soft text-ivory border border-surface-border',
    hint: 'Both sensors agree on a new value. The collector is working and was not repaired.',
  },
  extractor_drift: {
    label: 'Extractor drifted',
    className: 'bg-coralSoft text-ember border border-ember/40',
    hint: 'The witness disagrees with the collector. Extraction moved, the page did not.',
  },
  access_anomaly: {
    label: 'Access anomaly',
    className: 'bg-coralSoft text-ember border border-ember/40',
    hint: 'The two sensors did not observe the same page. Not attributable to the collector.',
  },
  inconclusive: {
    label: 'Inconclusive',
    className: 'bg-coralSoft text-ember border border-ember/40',
    hint: 'Evidence was insufficient to blame either the page or the collector.',
  },
  explicit_failure: {
    label: 'Failed',
    className: 'bg-coralSoft text-ember border border-ember/40',
    hint: 'The collector returned an error, or nothing at all.',
  },
};

export function StatusChip({
  classification,
  showHint = false,
}: {
  classification: IncidentClassification;
  showHint?: boolean;
}) {
  const presentation = PRESENTATION[classification];
  return (
    <span className="inline-flex flex-col gap-1">
      <span className={`status-chip ${presentation.className}`} title={presentation.hint}>
        {presentation.label}
      </span>
      {showHint ? <span className="text-xs text-muted">{presentation.hint}</span> : null}
    </span>
  );
}

export function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-border"
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'confidence'}
      >
        <div
          className="h-full rounded-full bg-ivory"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      {/* The number is always shown next to the bar. A bare bar implies a
          precision the underlying estimate does not have. */}
      <span className="font-mono text-xs text-muted">{percent}%</span>
    </div>
  );
}
