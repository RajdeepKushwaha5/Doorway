import { createHash } from 'node:crypto';
import type { CollectorRecord, IncidentRecord } from '../store/types.js';

/**
 * A verdict anyone can re-check, without trusting this server.
 *
 * The dashboard is the weakest possible place to prove something, because it
 * renders whatever it is told. A judgement about data is only worth as much as
 * the reader's ability to check it, and "open our website and read our number"
 * is not checking.
 *
 * So an incident can be exported as a certificate: a flat, canonically ordered
 * document carrying the verdict, both sensor readings, the line the witness
 * read from, and a SHA-256 of the page body it read. The digest covers every
 * field except itself, so altering any one of them breaks it. Re-deriving the
 * digest needs no key and no network, which is the point: a reader can do it in
 * their own browser, or with `sha256sum`, and reach the same answer we did.
 *
 * This is deliberately not a signature. A signature would prove NOTICE issued
 * the document, which is a claim about us. The digest proves the document has
 * not been edited, which is a claim about the evidence, and that is the one a
 * sceptical reader actually needs.
 */

/**
 * One field the incident named, reduced to what a reader has to check.
 *
 * The collector's own value is not repeated here as a field of its own: the
 * incident stores it only inside the human-readable `evidence` lines, and a
 * structured key that is always null would read as missing data rather than as
 * absent by design. The evidence lines carry both sides verbatim.
 */
export interface CertifiedField {
  path: string;
  witnessValue: unknown;
  /** The line the witness read its value from, verbatim. */
  readFrom: string | null;
  /** How the witness found it, and how much that method is trusted. */
  method: string | null;
  confidence: number | null;
}

export interface EvidenceCertificate {
  issuer: 'NOTICE';
  version: 1;
  incidentId: string;
  collectorId: string;
  brightDataCollectorId: string;
  url: string | null;
  verdict: string;
  confidence: number;
  quarantined: boolean;
  observedAt: string;
  fields: CertifiedField[];
  /** SHA-256 of the exact markdown the witness read, when there was one. */
  witnessContentHash: string | null;
  witnessFetchedAt: string | null;
  evidence: string[];
  /** SHA-256 over every field above, in the order they appear here. */
  digest: string;
}

/**
 * Serialise deterministically.
 *
 * `JSON.stringify` preserves insertion order for string keys, and every object
 * in a certificate is built by this module in a fixed order, so the bytes a
 * verifier hashes are the bytes we hashed. Sorting keys instead would be more
 * obviously safe but would stop the document reading top to bottom, and a
 * certificate nobody can read is a certificate nobody checks.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value);
}

export function digestOf(certificate: Omit<EvidenceCertificate, 'digest'>): string {
  return createHash('sha256').update(canonical(certificate), 'utf8').digest('hex');
}

export function buildCertificate(
  incident: IncidentRecord,
  collector: CollectorRecord,
): EvidenceCertificate {
  const witness = incident.witness;

  // Only fields the incident actually named. A certificate listing everything
  // the witness happened to read would bury the disagreement it exists to show.
  const fields: CertifiedField[] = incident.affectedFields.map((path) => {
    const reading = witness?.values.find((value) => value.path === path) ?? null;
    return {
      path,
      witnessValue: reading?.value ?? null,
      readFrom: reading?.evidence.line ?? null,
      method: reading?.evidence.strategy ?? null,
      confidence: reading?.confidence ?? null,
    };
  });

  const body: Omit<EvidenceCertificate, 'digest'> = {
    issuer: 'NOTICE',
    version: 1,
    incidentId: incident.id,
    collectorId: collector.id,
    brightDataCollectorId: collector.brightDataCollectorId,
    url: witness?.url ?? collector.watchUrls[0] ?? null,
    verdict: incident.classification,
    confidence: incident.confidence,
    quarantined: incident.quarantined,
    observedAt: incident.createdAt,
    fields,
    witnessContentHash: witness?.contentHash ?? null,
    witnessFetchedAt: witness?.fetchedAt ?? null,
    evidence: incident.evidence,
  };

  return { ...body, digest: digestOf(body) };
}

/** Re-derive the digest and report whether the document is intact. */
export function verifyCertificate(
  candidate: EvidenceCertificate,
): { valid: boolean; expected: string; found: string } {
  const { digest, ...body } = candidate;
  const expected = digestOf(body);
  return { valid: expected === digest, expected, found: digest };
}
