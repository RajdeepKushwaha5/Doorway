import { describe, expect, it } from 'vitest';
import { learnContract, validateRun, type BaselineRun, type Invariant } from '../contracts/index.js';
import { observeMarkdown, reconcile, type WitnessFieldSpec } from '../witness/index.js';
import { classify } from './classify.js';
import { evaluateGate } from './gate.js';
import { synthesizeRepairPrompt, PROMPT_CHARACTER_LIMIT } from './prompt.js';
import { canTransition, currentState, transition, IllegalTransitionError } from './state.js';

const SPECS: WitnessFieldSpec[] = [
  {
    path: 'price',
    meaning: 'the current non-refundable purchase price',
    labels: ['purchase price', 'price'],
    excludeLabels: ['deposit', 'refundable'],
    kind: 'money',
    allowed: [],
  },
  {
    path: 'deposit',
    meaning: 'the refundable security deposit',
    labels: ['refundable deposit', 'deposit'],
    excludeLabels: [],
    kind: 'money',
    allowed: [],
  },
];

const MARKDOWN = 'Nova Headphones\n\nPurchase price: $249\nRefundable deposit: $25\n';

const INVARIANTS: Invariant[] = [
  { kind: 'range', field: 'price.value', min: 1 },
  { kind: 'compare', left: 'price.value', op: '>', right: 'deposit.value' },
];

function baseline(count: number): BaselineRun[] {
  return Array.from({ length: count }, (_, i) => ({
    rows: [
      { price: { value: 249 + (i % 3), currency: 'USD' }, deposit: { value: 25, currency: 'USD' } },
    ],
    observedAt: new Date().toISOString(),
  }));
}

const CONTRACT = learnContract('c_test', baseline(10), INVARIANTS);
const OBSERVATION = observeMarkdown('https://d.example/p', MARKDOWN, SPECS, new Date().toISOString());

describe('classify', () => {
  it('reports healthy when nothing tripped', () => {
    const row = { price: { value: 249, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } };
    const result = classify({ checks: validateRun({ rows: [row], contract: CONTRACT }) });
    expect(result.verdict).toBe('healthy');
  });

  it('calls an explicit error a failure without needing a witness', () => {
    const result = classify({
      checks: validateRun({ rows: [{ error: 'parse_error' }], contract: CONTRACT }),
    });
    expect(result.verdict).toBe('explicit_failure');
    expect(result.confidence).toBe(1);
  });

  it('calls an empty result a failure, not silence', () => {
    const result = classify({ checks: validateRun({ rows: [], contract: CONTRACT }) });
    expect(result.verdict).toBe('explicit_failure');
  });

  it('calls it drift when the witness disagrees with the collector', () => {
    const drifted = {
      price: { value: 25, currency: 'USD' },
      deposit: { value: 25, currency: 'USD' },
    };
    const result = classify({
      checks: validateRun({ rows: [drifted], contract: CONTRACT }),
      reconciliation: reconcile(drifted, OBSERVATION, SPECS),
    });
    expect(result.verdict).toBe('extractor_drift');
    expect(result.affectedFields).toContain('price');
    expect(result.capturedInstead['price']).toContain('deposit');
  });

  it('calls it a genuine source change when both sensors agree on a new value', () => {
    // The single most important negative case. A working collector must never
    // be sent for repair because the world moved.
    const changedMarkdown = MARKDOWN.replace('$249', '$229');
    const changedObservation = observeMarkdown(
      'https://d.example/p',
      changedMarkdown,
      SPECS,
      new Date().toISOString(),
    );
    const row = { price: { value: 229, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } };

    const result = classify({
      checks: validateRun({ rows: [row], contract: CONTRACT }),
      reconciliation: reconcile(row, changedObservation, SPECS),
      departsFromBaseline: true,
    });
    expect(result.verdict).toBe('genuine_source_change');
  });

  it('does not use agreement on one field to explain a failure on another', () => {
    const row = {
      provider: 'wrong section label',
      price: { value: 249, currency: 'USD' },
      deposit: { value: 25, currency: 'USD' },
    };
    const result = classify({
      checks: [
        {
          checkId: 'invariant:enum:provider',
          field: 'provider',
          status: 'fail',
          severity: 1,
          confidence: 1,
          explanation: 'provider is outside the allowed set',
        },
      ],
      reconciliation: reconcile(row, OBSERVATION, SPECS),
      departsFromBaseline: true,
    });

    expect(result.verdict).toBe('inconclusive');
    expect(result.affectedFields).toContain('provider');
    expect(result.evidence.join(' ')).toContain('did not observe');
  });

  it('blames access rather than the extractor when the sensors saw different pages', () => {
    const drifted = {
      price: { value: 25, currency: 'USD' },
      deposit: { value: 25, currency: 'USD' },
    };
    const now = new Date().toISOString();
    const result = classify({
      checks: validateRun({ rows: [drifted], contract: CONTRACT }),
      reconciliation: reconcile(drifted, OBSERVATION, SPECS),
      collectorContext: {
        requestedUrl: 'https://d.example/p',
        deviceType: 'desktop',
        country: 'GB',
        variantMarkers: [],
        observedAt: now,
      },
      witnessContext: {
        requestedUrl: 'https://d.example/p',
        deviceType: 'desktop',
        country: 'US',
        variantMarkers: [],
        observedAt: now,
      },
    });
    expect(result.verdict).toBe('access_anomaly');
  });

  it('refuses to convict on weak witness evidence', () => {
    // Only one bare currency amount and no labels: confidence 0.35, below the
    // bar for authorizing a rewrite of a production collector.
    const weakObservation = observeMarkdown(
      'https://d.example/p',
      'Nova Headphones\n\n$249\n',
      [{ ...SPECS[0]!, labels: ['no-such-label'] }],
      new Date().toISOString(),
    );
    const drifted = { price: { value: 25, currency: 'USD' } };
    const result = classify({
      checks: validateRun({ rows: [drifted], contract: CONTRACT }),
      reconciliation: reconcile(drifted, weakObservation, [{ ...SPECS[0]!, labels: ['no-such-label'] }]),
    });
    expect(result.verdict).toBe('inconclusive');
  });

  it('is inconclusive when no witness was available', () => {
    const drifted = { price: { value: 25, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } };
    const result = classify({ checks: validateRun({ rows: [drifted], contract: CONTRACT }) });
    expect(result.verdict).toBe('inconclusive');
  });
});

describe('synthesizeRepairPrompt', () => {
  const drifted = { price: { value: 25, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } };
  const reconciliation = reconcile(drifted, OBSERVATION, SPECS);
  const classification = classify({
    checks: validateRun({ rows: [drifted], contract: CONTRACT }),
    reconciliation,
  });

  it('names the wrong value, the right value and the field actually captured', () => {
    const prompt = synthesizeRepairPrompt({
      classification,
      reconciliation,
      specs: SPECS,
      protectedFields: ['deposit'],
    });
    expect(prompt.text).toContain('price');
    expect(prompt.text).toContain('249');
    expect(prompt.text).toContain('deposit');
    expect(prompt.text).toContain('Preserve the existing output schema');
  });

  it('carries the declared meaning through to the healer', () => {
    const prompt = synthesizeRepairPrompt({
      classification,
      reconciliation,
      specs: SPECS,
      protectedFields: [],
    });
    expect(prompt.text).toContain('current non-refundable purchase price');
  });

  /**
   * The field under repair is normally protected as well, because protecting a
   * field means a repair may not *drop* it, not that its value may not change.
   * The prompt said "Do not change these fields", so the healer was told to fix
   * price and to leave price alone in the same paragraph.
   */
  it('does not tell the healer to leave the field it is repairing alone', () => {
    const prompt = synthesizeRepairPrompt({
      classification,
      reconciliation,
      specs: SPECS,
      protectedFields: ['price', 'product_name'],
    });

    expect(prompt.text).not.toContain('Do not change these fields');
    expect(prompt.text).toContain('must still be present in the output');
    // The instruction to repair price is still there, unambiguously.
    expect(prompt.text).toContain('price');
    expect(prompt.text).toContain('249');
  });

  it('does not end the declared meaning with a doubled full stop', () => {
    const prompt = synthesizeRepairPrompt({
      classification,
      reconciliation,
      specs: SPECS,
      protectedFields: [],
    });

    // The meaning is a human sentence that usually ends in a stop already, and
    // appending another produced "...sponsored listing price.." in a prompt
    // that goes to Bright Data.
    expect(prompt.text).not.toMatch(/\.\./);
  });

  it('stays within the documented character limit', () => {
    const prompt = synthesizeRepairPrompt({
      classification,
      reconciliation,
      specs: SPECS,
      protectedFields: ['deposit', 'name', 'availability', 'sku', 'upc'],
    });
    expect(prompt.text.length).toBeLessThanOrEqual(PROMPT_CHARACTER_LIMIT);
    expect(prompt.withinLimit).toBe(true);
  });
});

describe('evaluateGate', () => {
  const incident = { url: 'https://d.example/incident', expected: { 'price.value': 249 } };
  const regression = [
    { url: 'https://d.example/a', expected: { 'price.value': 249 }, label: 'baseline layout' },
    { url: 'https://d.example/b', expected: { 'price.value': 229 }, label: 'genuine change' },
  ];

  it('approves a repair that fixes the incident and holds every regression', () => {
    const rows = new Map<string, unknown[]>([
      [incident.url, [{ price: { value: 249, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
      ['https://d.example/a', [{ price: { value: 249, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
      ['https://d.example/b', [{ price: { value: 229, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
    ]);
    const decision = evaluateGate({
      incident,
      regression,
      candidateRowsByUrl: rows,
      protectedFields: ['deposit'],
      contract: CONTRACT,
    });
    expect(decision.approved).toBe(true);
  });

  it('rejects a repair whose preview looked fine but still fails the incident', () => {
    // This is the exact case the kill test found on a real collector: the
    // Self-Healing preview was green while the candidate still failed on the
    // page that caused the incident.
    const rows = new Map<string, unknown[]>([
      [incident.url, [{ error: 'Parse error: value must be finite number' }]],
      ['https://d.example/a', [{ price: { value: 249, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
      ['https://d.example/b', [{ price: { value: 229, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
    ]);
    const decision = evaluateGate({
      incident,
      regression,
      candidateRowsByUrl: rows,
      protectedFields: [],
      contract: CONTRACT,
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons[0]).toContain('incident page could not be verified');
  });

  it('rejects a repair that fixes the incident but breaks a working page', () => {
    const rows = new Map<string, unknown[]>([
      [incident.url, [{ price: { value: 249, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
      ['https://d.example/a', [{ price: { value: 25, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
      ['https://d.example/b', [{ price: { value: 229, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
    ]);
    const decision = evaluateGate({
      incident,
      regression,
      candidateRowsByUrl: rows,
      protectedFields: [],
      contract: CONTRACT,
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(' ')).toContain('baseline layout');
  });

  it('rejects when the candidate was never executed against a case', () => {
    // An unrun case has not been shown to work. Treating it as a pass is how
    // an unverified repair reaches production.
    const rows = new Map<string, unknown[]>([
      [incident.url, [{ price: { value: 249, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
    ]);
    const decision = evaluateGate({
      incident,
      regression,
      candidateRowsByUrl: rows,
      protectedFields: [],
      contract: CONTRACT,
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(' ')).toContain('never executed');
  });

  it('rejects a repair that drops a protected field', () => {
    const rows = new Map<string, unknown[]>([
      [incident.url, [{ price: { value: 249, currency: 'USD' }, deposit: null }]],
      ['https://d.example/a', [{ price: { value: 249, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
      ['https://d.example/b', [{ price: { value: 229, currency: 'USD' }, deposit: { value: 25, currency: 'USD' } }]],
    ]);
    const decision = evaluateGate({
      incident: { url: incident.url, expected: { 'price.value': 249, deposit: null } },
      regression,
      candidateRowsByUrl: rows,
      protectedFields: ['deposit'],
      contract: CONTRACT,
    });
    expect(decision.approved).toBe(false);
  });
});

describe('incident state machine', () => {
  it('permits the happy path from observation to resolution', () => {
    const path = [
      'observed',
      'validating',
      'witness_pending',
      'classifying',
      'drift_confirmed',
      'healing',
      'awaiting_candidate',
      'verifying_candidate',
      'awaiting_approval',
      'approving',
      'verifying_production',
      'resolved',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('makes approval unreachable without candidate verification', () => {
    // The safety property, expressed as a type-level fact rather than a
    // convention someone has to remember.
    expect(canTransition('healing', 'approving')).toBe(false);
    expect(canTransition('drift_confirmed', 'approving')).toBe(false);
    expect(canTransition('awaiting_candidate', 'approving')).toBe(false);
    expect(canTransition('verifying_candidate', 'approving')).toBe(false);
    expect(canTransition('awaiting_approval', 'approving')).toBe(true);
  });

  it('never allows a genuine source change to reach healing', () => {
    expect(canTransition('genuine_change', 'healing')).toBe(false);
    expect(canTransition('classifying', 'healing')).toBe(false);
  });

  it('throws on an illegal transition rather than corrupting state', () => {
    expect(() => transition('healthy', 'approving', { actor: 'system', reason: 'nope' })).toThrow(
      IllegalTransitionError,
    );
  });

  it('derives the current state from history', () => {
    const history = [
      transition('observed', 'validating', { actor: 'system', reason: 'run ingested' }),
      transition('validating', 'witness_pending', { actor: 'system', reason: 'contract tripped' }),
    ];
    expect(currentState(history)).toBe('witness_pending');
    expect(currentState([])).toBe('observed');
  });
});

describe('a healthy verdict states what was actually confirmed', () => {
  /**
   * Found on a live external site. The witness read availability, could not
   * find the price at all, and the incident still recorded "the independent
   * witness agrees". A witness cannot agree about a field it never saw, and a
   * project built to catch confident overstatement must not make one on its
   * own summary line.
   */
  const quiet = {
    checks: [],
    reconciliation: {
      comparisons: [],
      agreed: ['availability'],
      disagreed: [],
      incomparable: ['price'],
      agreementRate: 1,
      coverage: 0.5,
      weakestWitnessConfidence: 1,
    },
  };

  it('names the fields the witness confirmed', () => {
    const result = classify(quiet as never);
    expect(result.verdict).toBe('healthy');
    expect(result.evidence.join(' ')).toContain('agrees on availability');
  });

  it('says plainly which fields no second sensor could read', () => {
    const evidence = classify(quiet as never).evidence.join(' ');
    expect(evidence).toContain('could not read price');
    expect(evidence).toContain('unconfirmed by a second sensor');
  });

  it('never claims blanket agreement', () => {
    const evidence = classify(quiet as never).evidence.join(' ');
    expect(evidence).not.toContain('the independent witness agrees and');
    expect(evidence).not.toMatch(/witness agrees$/);
  });

  it('still reports healthy, because nothing contradicted the collector', () => {
    // The wording changes, the decision does not. An unread field is not
    // evidence of a fault.
    expect(classify(quiet as never).verdict).toBe('healthy');
  });
});
