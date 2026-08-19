import { describe, expect, it } from 'vitest';
import { buildCertificate, verifyCertificate, type EvidenceCertificate } from './certificate.js';
import type { CollectorRecord, IncidentRecord } from '../store/types.js';

/**
 * A certificate exists so a sceptic does not have to trust this server. The
 * only property that matters is that editing it is detectable, so these test
 * tampering rather than construction.
 */

function collector(): CollectorRecord {
  return {
    id: 'col-1',
    brightDataCollectorId: 'c_test123',
    name: 'DriftMart headphones',
    targetDomain: 'driftmart.test',
    status: 'active',
    schedule: null,
    watchUrls: ['https://driftmart.test/product/headphones'],
    witnessSpecs: [],
    invariants: [],
    protectedFields: [],
    goldenCases: [],
    acquisitionContext: {},
    autoPromote: 'never',
    freshnessMinutes: null,
    currency: 'USD',
    createdAt: '2026-08-18T00:00:00.000Z',
  };
}

function incident(): IncidentRecord {
  return {
    id: 'inc-1',
    collectorId: 'col-1',
    runId: 'run-1',
    classification: 'extractor_drift',
    confidence: 0.92,
    affectedFields: ['price'],
    evidence: ['"price": collector reported 25, witness read 249 from "Purchase price: **$249**"'],
    witness: {
      url: 'https://driftmart.test/product/headphones',
      fetchedAt: '2026-08-18T00:00:01.000Z',
      contentHash: 'a'.repeat(64),
      excerpt: 'Purchase price: **$249**',
      values: [
        {
          path: 'price',
          value: 249,
          confidence: 0.85,
          evidence: { line: 'Purchase price: **$249**', lineNumber: 15, strategy: 'labelled-line' },
        },
      ],
      notFound: [],
    },
    repairPrompt: null,
    screenshotId: null,
    history: [],
    gateResults: [],
    quarantined: true,
    createdAt: '2026-08-18T00:00:02.000Z',
    resolvedAt: null,
  };
}

describe('an evidence certificate', () => {
  it('verifies against its own digest', () => {
    const certificate = buildCertificate(incident(), collector());
    expect(verifyCertificate(certificate).valid).toBe(true);
  });

  it('carries the hash of the page body the witness read', () => {
    const certificate = buildCertificate(incident(), collector());
    expect(certificate.witnessContentHash).toBe('a'.repeat(64));
    expect(certificate.fields[0]?.readFrom).toBe('Purchase price: **$249**');
  });

  it('is deterministic, so two readers derive the same digest', () => {
    expect(buildCertificate(incident(), collector()).digest).toBe(
      buildCertificate(incident(), collector()).digest,
    );
  });

  /**
   * The whole point. Every one of these is a field somebody would want to
   * change to make a verdict say something it did not say.
   */
  it.each([
    ['the verdict', (c: EvidenceCertificate) => ({ ...c, verdict: 'healthy' })],
    ['the confidence', (c: EvidenceCertificate) => ({ ...c, confidence: 0.1 })],
    ['the quarantine flag', (c: EvidenceCertificate) => ({ ...c, quarantined: false })],
    ['the page hash', (c: EvidenceCertificate) => ({ ...c, witnessContentHash: 'b'.repeat(64) })],
    ['the evidence line', (c: EvidenceCertificate) => ({ ...c, evidence: ['nothing was wrong'] })],
    [
      'the witness reading',
      (c: EvidenceCertificate) => ({
        ...c,
        fields: c.fields.map((f) => ({ ...f, witnessValue: 25 })),
      }),
    ],
  ])('fails when %s is edited', (_label, tamper) => {
    const tampered = tamper(buildCertificate(incident(), collector()));
    expect(verifyCertificate(tampered).valid).toBe(false);
  });

  it('fails when only the digest is swapped', () => {
    const certificate = buildCertificate(incident(), collector());
    expect(verifyCertificate({ ...certificate, digest: 'f'.repeat(64) }).valid).toBe(false);
  });
});
