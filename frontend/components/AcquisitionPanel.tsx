import type { AcquisitionContext, ContextAlignment, Incident } from '@/lib/types';

/**
 * Under what conditions each sensor read the page.
 *
 * The classifier has always compared these, and the interface has never shown
 * them. That made `access_anomaly` the one verdict a reader had to take purely
 * on trust: the system was saying "these two sensors were not looking at the
 * same thing" while giving no way to see what differed. The most restrained
 * verdict in the project therefore looked like the least substantiated one.
 *
 * It matters just as much when the contexts agree. A sceptical reader's first
 * objection to any disagreement between two sensors is that they saw different
 * storefronts, and the honest answer to that objection is a record showing the
 * same country, the same device class and four seconds between the reads.
 * Ruling the boring explanation out is what makes the interesting one worth
 * believing.
 */

/**
 * Name a country from its code, and fall back to the code.
 *
 * `Intl.DisplayNames` is present in every runtime this renders in, but it
 * throws on an input it cannot parse, and a malformed country string stored on
 * an old record should not take out the page it appears on.
 */
function countryName(code: string): string {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/**
 * State what actually matched, rather than asserting a clean sweep.
 *
 * `aligned` only means nothing contradicted anything. Two fetches that both
 * declined to pin a country are aligned, and a sentence reading "same exit
 * country" would be reporting an agreement neither sensor made. Each line here
 * names what was known or says plainly that it was not, which is the same
 * standard the rest of the system holds its own outputs to.
 */
function agreements(
  collector: AcquisitionContext,
  witness: AcquisitionContext,
  alignment: ContextAlignment,
): string[] {
  const lines: string[] = [
    `Both sensors requested ${collector.requestedUrl}`,
  ];

  if (collector.country !== undefined && witness.country !== undefined) {
    lines.push(`Both left through ${countryName(collector.country)} (${collector.country.toUpperCase()})`);
  } else if (collector.country === undefined && witness.country === undefined) {
    lines.push('Neither fetch pinned an exit country, so region is untested here rather than matched');
  } else {
    const known = collector.country ?? witness.country;
    const side = collector.country === undefined ? 'the witness' : 'the collector';
    lines.push(
      `Only ${side} declared a region (${countryName(known ?? '')}), so the two could not be compared on it`,
    );
  }

  if (collector.deviceType !== 'unknown' && witness.deviceType !== 'unknown') {
    lines.push(`Both read the ${collector.deviceType} layout`);
  } else {
    lines.push(
      'One side did not declare a device class, so layout variant is untested here rather than matched',
    );
  }

  lines.push(
    `The two reads were ${alignment.observationGapSeconds} second${
      alignment.observationGapSeconds === 1 ? '' : 's'
    } apart`,
  );

  return lines;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-surface-border py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono text-ivory">{value}</span>
    </div>
  );
}

function Sensor({
  title,
  product,
  context,
}: {
  title: string;
  product: string;
  context: AcquisitionContext;
}) {
  return (
    <div className="border border-surface-border bg-surface-soft p-5">
      <p className="eyebrow">{product}</p>
      <h3 className="mt-1 text-base font-medium text-ivory">{title}</h3>
      <div className="mt-4">
        <Row
          label="Exit country"
          value={
            context.country === undefined
              ? 'not pinned'
              : `${countryName(context.country)} (${context.country.toUpperCase()})`
          }
        />
        <Row
          label="Device"
          value={context.deviceType === 'unknown' ? 'not declared' : context.deviceType}
        />
        <Row label="Read at" value={context.observedAt.slice(11, 19)} />
        {context.resolvedUrl !== undefined && context.resolvedUrl !== context.requestedUrl ? (
          <Row label="Redirected to" value={context.resolvedUrl} />
        ) : null}
        {context.variantMarkers.length > 0 ? (
          <Row label="Variant markers" value={context.variantMarkers.join(', ')} />
        ) : null}
      </div>
    </div>
  );
}

export function AcquisitionPanel({ incident }: { incident: Incident }) {
  const acquisition = incident.acquisition;

  if (acquisition === null) {
    return (
      <p className="text-sm leading-6 text-muted">
        No acquisition record was kept for this incident. It predates the point where the two
        sensors&apos; conditions were stored, or it opened before any comparison was made. Shown as
        absent rather than assumed, because an assumed country is exactly the kind of plausible
        wrong value this system exists to refuse.
      </p>
    );
  }

  const { collector, witness, alignment } = acquisition;
  const anomaly = incident.classification === 'access_anomaly';

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <Sensor
          title="The selector-bound collector"
          product="Scraper Studio"
          context={collector}
        />
        <Sensor title="The selector-free witness" product="Web Unlocker" context={witness} />
      </div>

      <div
        className={`mt-5 border p-5 ${
          alignment.aligned
            ? 'border-verified/30 bg-parse-accentBg'
            : 'border-suspect/40 bg-amber-50'
        }`}
      >
        <p className="eyebrow">{alignment.aligned ? 'Conditions matched' : 'Conditions differed'}</p>
        {alignment.aligned ? (
          <>
            <p className="mt-2 text-sm leading-6 text-muted">
              Nothing about how these two pages were fetched explains a difference in what they
              said, which is what makes the disagreement above worth acting on.
            </p>
            <ul className="mt-3 space-y-1.5">
              {agreements(collector, witness, alignment).map((line) => (
                <li
                  key={line}
                  className="border border-surface-border bg-surface p-3 text-sm text-muted"
                >
                  {line}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm leading-6 text-muted">
              The sensors did not observe the page under the same conditions, so a difference
              between their readings is not evidence that the extractor drifted.
            </p>
            <ul className="mt-3 space-y-1.5">
              {alignment.mismatches.map((mismatch) => (
                <li key={mismatch} className="border border-surface-border bg-surface p-3 text-sm text-muted">
                  {mismatch}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {anomaly ? (
        <p className="mt-4 text-sm leading-6 text-muted">
          This is why the verdict is <span className="text-ivory">access_anomaly</span> and not{' '}
          <span className="text-ivory">extractor_drift</span>. No repair was proposed and no
          collector was rewritten. A monitor that blamed the extractor here would have sent a
          working collector to be healed for reading a different region&apos;s storefront correctly.
        </p>
      ) : null}
    </div>
  );
}
