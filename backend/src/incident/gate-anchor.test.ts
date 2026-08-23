import { describe, expect, it } from 'vitest';
import { evaluateGate } from './gate.js';
import type { CollectorContract } from '../store/index.js';

/**
 * A repair that returns the right value from the wrong element.
 *
 * The gate compared values, so a candidate passed whenever its output matched
 * the pinned answer. On a page where the answer appears once that is sound. On
 * a page where it appears twice it proves nothing: a selector reading the
 * wrong element, which happens to hold the same text, is indistinguishable
 * from one reading the right element.
 *
 * That is the ordinary result of a repair that latches onto position rather
 * than meaning. It looks fixed, it passes every value check anyone has ever
 * written, and it breaks silently the first time the two elements stop
 * agreeing, which is the next redesign.
 *
 * The anchor case is a page served with the true value rewritten to a token
 * that appears nowhere else, and the value it used to hold left above it under
 * a different label. Reading the label returns the token; reading the position
 * returns the decoy.
 */

const INCIDENT = 'https://lab.test/opportunity/ai-fellowship';
const ANCHOR = 'https://lab.test/opportunity/ai-fellowship?mode=deadline_sentinel';

const SENTINEL = 'SENTINEL-4F2A9C-DEADLINE';
const CORRECT = '18 September 2026';

const contract = {
  requiredFields: [],
  invariants: [],
  confidence: 0.5,
  sampleCount: 0,
  rowCount: { median: 0 },
  fields: {},
} as unknown as CollectorContract;

/** Run the gate against a candidate that answers each page a given way. */
function gate(answers: { incident: string; anchor?: string }) {
  const rows = new Map<string, readonly unknown[]>([
    [INCIDENT, [{ deadline_raw: answers.incident }]],
  ]);
  if (answers.anchor !== undefined) {
    rows.set(ANCHOR, [{ deadline_raw: answers.anchor }]);
  }

  return evaluateGate({
    incident: { url: INCIDENT, expected: { deadline_raw: CORRECT } },
    regression: [],
    candidateRowsByUrl: rows,
    protectedFields: [],
    contract,
    ...(answers.anchor === undefined
      ? {}
      : {
          anchor: {
            url: ANCHOR,
            expected: { deadline_raw: SENTINEL },
            decoy: { deadline_raw: CORRECT },
          },
        }),
  });
}

describe('a candidate that reads the right element', () => {
  it('is promoted when it echoes the token back', () => {
    const decision = gate({ incident: CORRECT, anchor: SENTINEL });
    expect(decision.approved).toBe(true);
  });
});

describe('a candidate that reads the wrong element', () => {
  /*
   * This is the whole point. Both assertions below describe the same
   * candidate. Without the anchor page it is promoted, because its answer on
   * the incident page is correct and there is nothing else to check against.
   */
  it('was promoted before, because its value was right', () => {
    const decision = gate({ incident: CORRECT });
    expect(decision.approved).toBe(true);
  });

  it('is now rejected, because the value was right for the wrong reason', () => {
    const decision = gate({ incident: CORRECT, anchor: CORRECT });
    expect(decision.approved).toBe(false);
  });

  it('says which mistake was made, not just that one was', () => {
    // "It failed" sends an operator looking at the repair. "It read a
    // position" tells them what to ask the healer for next.
    const decision = gate({ incident: CORRECT, anchor: CORRECT });
    expect(decision.reasons.join(' ')).toContain('reading a position');
  });

  it('distinguishes reading the decoy from reading nothing recognisable', () => {
    const decision = gate({ incident: CORRECT, anchor: 'Applications are open' });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(' ')).toContain('has not been shown to read');
    expect(decision.reasons.join(' ')).not.toContain('reading a position');
  });
});

describe('an anchor page that could not be run', () => {
  it('blocks promotion rather than being skipped', () => {
    // A candidate that never reached the anchor page has not been shown to
    // read the labelled element. Treating an unrun case as absent would let a
    // network blip promote exactly the repair this check exists to stop.
    const decision = evaluateGate({
      incident: { url: INCIDENT, expected: { deadline_raw: CORRECT } },
      regression: [],
      candidateRowsByUrl: new Map([[INCIDENT, [{ deadline_raw: CORRECT }]]]),
      protectedFields: [],
      contract,
      anchor: {
        url: ANCHOR,
        expected: { deadline_raw: SENTINEL },
        decoy: { deadline_raw: CORRECT },
      },
    });

    expect(decision.approved).toBe(false);
    expect(decision.results.find((result) => result.label === 'anchor')?.passed).toBe(false);
  });
});

describe('the anchor case is optional', () => {
  it('changes nothing for a source whose markup we do not control', () => {
    // Most sources cannot be served with a token in place of a value. The gate
    // has to keep working against them exactly as it did.
    const decision = gate({ incident: CORRECT });
    expect(decision.results.some((result) => result.label === 'anchor')).toBe(false);
  });

  it('still rejects a candidate that is simply wrong', () => {
    const decision = gate({ incident: '1 September 2026' });
    expect(decision.approved).toBe(false);
  });
});
