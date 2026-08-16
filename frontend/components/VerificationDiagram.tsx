import { ArrowRight, Check, Eye, WarningOctagon } from '@phosphor-icons/react/dist/ssr';

export function VerificationDiagram() {
  return (
    <figure className="verification-diagram" aria-label="NOTICE compares a Scraper Studio result with an independent Bright Data witness and quarantines a disagreement">
      <div className="verification-diagram__bar">
        <span>LIVE VERIFICATION</span>
        <span>[ 01 / 03 ]</span>
      </div>

      <div className="verification-diagram__canvas">
        <SignalCard
          index="01"
          label="SCRAPER STUDIO"
          value="$25"
          detail="Valid JSON · request succeeded"
          icon={<Check size={18} weight="bold" />}
        />
        <div className="verification-diagram__route" aria-hidden>
          <span />
          <ArrowRight size={20} />
        </div>
        <SignalCard
          index="02"
          label="INDEPENDENT WITNESS"
          value="$249"
          detail="Purchase price · labelled line"
          icon={<Eye size={18} weight="bold" />}
        />
      </div>

      <div className="verification-diagram__decision">
        <div className="verification-diagram__decision-icon"><WarningOctagon size={24} weight="fill" /></div>
        <div>
          <p>NOTICE DECISION</p>
          <strong>Signals disagree. Quarantine the row.</strong>
        </div>
        <span>PRODUCTION UNCHANGED</span>
      </div>
    </figure>
  );
}

function SignalCard({ index, label, value, detail, icon }: { index: string; label: string; value: string; detail: string; icon: React.ReactNode }) {
  return (
    <div className="verification-diagram__signal">
      <div><span>{index}</span>{icon}</div>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
