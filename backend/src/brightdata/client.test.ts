import { describe, expect, it } from 'vitest';
import { normalizeHealProgress } from './client.js';
import { parseCliJson } from './cli.js';
import { healRequestSchema } from './types.js';

describe('healRequestSchema', () => {
  it('accepts a diagnosis with incident inputs', () => {
    const parsed = healRequestSchema.parse({
      prompt: 'price captured the deposit',
      custom_input: [{ url: 'https://example.com/product/1' }],
    });
    expect(parsed.custom_input).toHaveLength(1);
  });

  it('rejects a prompt beyond the documented 1000-character limit', () => {
    expect(() =>
      healRequestSchema.parse({ prompt: 'x'.repeat(1001), custom_input: [] }),
    ).toThrow();
  });

  it('rejects a non-URL incident input', () => {
    expect(() =>
      healRequestSchema.parse({ prompt: 'fix it', custom_input: [{ url: 'not-a-url' }] }),
    ).toThrow();
  });
});

describe('normalizeHealProgress', () => {
  /**
   * Captured verbatim from a live account on 2026-08-15, collector
   * c_mstkc1rkr8mit6wut, job ia_mstv19tu28te7z1nlp.
   *
   * The previous version of these tests asserted `{status: 'awaiting_approval'}`,
   * a shape that was assumed rather than observed. The real API signals the
   * gate through `step`, and its status string is `pending_answer`, which
   * matched none of the old patterns. The parser therefore reported a job
   * sitting at the gate as `pending` and a harness polled that misread for
   * fifteen minutes. Tests that encode an assumption validate the assumption.
   */
  const LIVE_GATE_PAYLOAD = {
    id: 'ia_mstv19tu28te7z1nlp',
    step: 'user_approval',
    completed_steps: ['planner', 'control_preview_runner', 'code_fixer', 'step_advance'],
    status: 'pending_answer',
    success: true,
    diff: { template_a: {}, template_b: {} },
    preview_result: [
      {
        title: 'Tipping the Velvet',
        price: { value: 53.74, currency: 'GBP' },
        availability: 'In stock (20 available) In stock',
        upc: '90fa61229261140a',
        rating: 'One',
      },
    ],
  };

  it('recognizes the approval gate from the real payload', () => {
    expect(normalizeHealProgress(LIVE_GATE_PAYLOAD).phase).toBe('awaiting_approval');
  });

  it('reads the job id from `id`, which is what the API actually returns', () => {
    expect(normalizeHealProgress(LIVE_GATE_PAYLOAD).jobId).toBe('ia_mstv19tu28te7z1nlp');
  });

  it('reads the preview result', () => {
    const progress = normalizeHealProgress(LIVE_GATE_PAYLOAD);
    expect(progress.previewResult).toHaveLength(1);
    expect((progress.previewResult?.[0] as { title: string }).title).toBe('Tipping the Velvet');
  });

  it('recognizes the gate from either field independently', () => {
    // Defensive: the API may settle on one signal or the other.
    expect(normalizeHealProgress({ step: 'user_approval' }).phase).toBe('awaiting_approval');
    expect(normalizeHealProgress({ status: 'pending_answer' }).phase).toBe('awaiting_approval');
  });

  it('treats an in-flight step as running, not pending', () => {
    expect(normalizeHealProgress({ step: 'code_fixer', status: 'running' }).phase).toBe('running');
  });

  it('treats success:false as failed', () => {
    expect(normalizeHealProgress({ step: 'planner', success: false }).phase).toBe('failed');
  });

  it('distinguishes an absent preview from an empty one', () => {
    // An empty preview array is a real signal: the healer ran and produced
    // nothing. Collapsing it to null would hide that from the approval gate.
    expect(normalizeHealProgress({ step: 'user_approval' }).previewResult).toBeNull();
    expect(
      normalizeHealProgress({ step: 'user_approval', preview_result: [] }).previewResult,
    ).toEqual([]);
  });

  it('reports pending only when nothing is recognizable, and keeps the payload', () => {
    const progress = normalizeHealProgress({ something_new: true });
    expect(progress.phase).toBe('pending');
    expect(progress.raw).toEqual({ something_new: true });
  });

  it('survives a null payload', () => {
    expect(normalizeHealProgress(null).phase).toBe('pending');
  });
});

describe('parseCliJson', () => {
  it('parses clean JSON', () => {
    expect(parseCliJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('extracts JSON from output interleaved with progress lines', () => {
    const stdout = 'Running collector c_abc123...\nDone in 4.2s\n[{"price":51.77}]\n';
    expect(parseCliJson(stdout)).toEqual([{ price: 51.77 }]);
  });

  it('returns null when there is no JSON at all', () => {
    expect(parseCliJson('login succeeded')).toBeNull();
    expect(parseCliJson('')).toBeNull();
  });
});
