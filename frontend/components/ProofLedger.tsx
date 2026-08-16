'use client';

import { useState } from 'react';
import { CheckCircle, Eye, ShieldCheck, WarningOctagon } from '@phosphor-icons/react';

const cases = [
  {
    id: 'silent-corruption',
    number: '01',
    label: 'Silent corruption',
    title: 'Valid JSON. Wrong fact.',
    description: 'A selector captured a refundable deposit instead of the purchase price. Nothing crashed, so an ordinary pipeline would ship it.',
    collector: '₹2,500 · success',
    witness: '₹24,000 · purchase price',
    decision: 'Quarantine row',
    tone: 'blocked' as const,
  },
  {
    id: 'source-change',
    number: '02',
    label: 'Source changed',
    title: 'A new value is not a broken scraper.',
    description: 'The structured collector and independent witness both read the same new price. NOTICE records the change and leaves the working extractor alone.',
    collector: '£249 · changed',
    witness: '£249 · confirmed',
    decision: 'Do not heal',
    tone: 'verified' as const,
  },
  {
    id: 'empty-batch',
    number: '03',
    label: 'Empty batch',
    title: 'No rows can be a dangerous answer.',
    description: 'An empty array often looks like “nothing found” downstream. NOTICE treats the unexplained disappearance of expected records as an explicit failure.',
    collector: '[] · no error',
    witness: 'Products still visible',
    decision: 'Block downstream',
    tone: 'blocked' as const,
  },
  {
    id: 'repair-gate',
    number: '04',
    label: 'Repair gate',
    title: 'A green preview is not deployment proof.',
    description: 'The proposed repair is replayed against the incident and known working pages. If NOTICE cannot verify both, production remains unchanged.',
    collector: 'Preview · pass',
    witness: 'Incident replay · fail',
    decision: 'Production unchanged',
    tone: 'blocked' as const,
  },
];

export function ProofLedger() {
  const [activeId, setActiveId] = useState(cases[0]!.id);
  const active = cases.find((item) => item.id === activeId) ?? cases[0]!;
  const blocked = active.tone === 'blocked';

  return (
    <div className="evidence-ledger">
      <div className="evidence-ledger__tabs" role="tablist" aria-label="Verification cases">
        {cases.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === activeId}
            aria-controls="verification-case"
            onClick={() => setActiveId(item.id)}
            className={item.id === activeId ? 'is-active' : ''}
          >
            <span>{item.number}</span>
            <strong>{item.label}</strong>
            <i aria-hidden />
          </button>
        ))}
      </div>

      <article id="verification-case" role="tabpanel" key={active.id} className="evidence-ledger__case">
        <div className="evidence-ledger__copy">
          <div className={`evidence-ledger__icon ${blocked ? 'is-blocked' : 'is-verified'}`}>
            {blocked ? <WarningOctagon size={26} weight="duotone" /> : <CheckCircle size={26} weight="duotone" />}
          </div>
          <div>
            <p className="eyebrow">Case {active.number}</p>
            <h3>{active.title}</h3>
            <p>{active.description}</p>
          </div>
        </div>

        <div className="evidence-ledger__signals">
          <Signal icon={<Eye size={18} />} label="Scraper Studio" value={active.collector} />
          <span className="evidence-ledger__connector" aria-hidden>+</span>
          <Signal icon={<ShieldCheck size={18} />} label="Bright Data witness" value={active.witness} />
          <span className="evidence-ledger__connector" aria-hidden>→</span>
          <div className={`evidence-ledger__verdict ${blocked ? 'is-blocked' : 'is-verified'}`}>
            <span>NOTICE verdict</span>
            <strong>{active.decision}</strong>
          </div>
        </div>
      </article>

      <div className="evidence-ledger__metrics">
        <Metric value="4" label="failure classes" />
        <Metric value="2" label="independent signals" />
        <Metric value="1" label="approval gate" />
        <Metric value="0" label="blind promotions" />
      </div>
    </div>
  );
}

function Signal({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="evidence-ledger__signal"><span>{icon}{label}</span><strong>{value}</strong></div>;
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}
