'use client';

import { useState } from 'react';

/**
 * Re-derive a certificate's digest in the reader's own browser.
 *
 * Nothing here talks to the NOTICE API, deliberately. A verifier that asks our
 * server whether our document is valid proves nothing at all; the answer would
 * be exactly as trustworthy as the claim it is checking. The hash is computed
 * locally with SubtleCrypto, so this page works with the network off and gives
 * the same answer to somebody who does not trust us.
 *
 * The body is rebuilt in a fixed key order rather than hashed as pasted, so
 * reformatting the JSON or reordering its keys does not fail verification.
 * Only a changed *value* breaks the digest, which is the thing worth detecting.
 */

/** The order the backend serialises in. Both sides must agree exactly. */
const FIELD_ORDER = [
  'issuer',
  'version',
  'incidentId',
  'collectorId',
  'brightDataCollectorId',
  'url',
  'verdict',
  'confidence',
  'quarantined',
  'observedAt',
  'fields',
  'witnessContentHash',
  'witnessFetchedAt',
  'evidence',
] as const;

const CERTIFIED_FIELD_ORDER = ['path', 'witnessValue', 'readFrom', 'method', 'confidence'] as const;

type Json = Record<string, unknown>;

function canonicalBody(certificate: Json): string {
  const body: Json = {};
  for (const key of FIELD_ORDER) {
    if (key === 'fields' && Array.isArray(certificate['fields'])) {
      body['fields'] = (certificate['fields'] as Json[]).map((field) => {
        const ordered: Json = {};
        for (const inner of CERTIFIED_FIELD_ORDER) ordered[inner] = field[inner] ?? null;
        return ordered;
      });
      continue;
    }
    body[key] = certificate[key] ?? null;
  }
  return JSON.stringify(body);
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Result =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'checked'; valid: boolean; expected: string; found: string; certificate: Json };

export function CertificateVerifier() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  async function verify(): Promise<void> {
    setBusy(true);
    try {
      let parsed: Json;
      try {
        parsed = JSON.parse(text) as Json;
      } catch {
        setResult({ kind: 'error', message: 'That is not valid JSON.' });
        return;
      }

      const found = typeof parsed['digest'] === 'string' ? parsed['digest'] : '';
      if (found === '') {
        setResult({ kind: 'error', message: 'No "digest" field. Is this a NOTICE certificate?' });
        return;
      }

      const expected = await sha256Hex(canonicalBody(parsed));
      setResult({ kind: 'checked', valid: expected === found, expected, found, certificate: parsed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10">
      <label htmlFor="certificate" className="eyebrow">
        Paste a certificate
      </label>
      <textarea
        id="certificate"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setResult({ kind: 'idle' });
        }}
        rows={12}
        spellCheck={false}
        placeholder='{ "issuer": "NOTICE", "version": 1, ... }'
        className="mt-3 w-full rounded-lg border border-surface-border bg-white p-4 font-mono text-[12px] leading-relaxed text-ivory focus:border-ivory/40 focus:outline-none"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void verify()}
          disabled={busy || text.trim() === ''}
          className="primary-button disabled:opacity-40"
        >
          {busy ? 'Checking' : 'Verify'}
        </button>
        <button
          type="button"
          onClick={() => {
            setText('');
            setResult({ kind: 'idle' });
          }}
          className="secondary-button"
        >
          Clear
        </button>
        <span className="font-mono text-[11px] text-muted">
          Computed in this browser. Nothing is sent anywhere.
        </span>
      </div>

      {result.kind === 'error' ? (
        <p className="mt-6 rounded-lg border border-blocked/30 bg-blocked/5 p-4 font-mono text-[12px] text-blocked">
          {result.message}
        </p>
      ) : null}

      {result.kind === 'checked' ? (
        <div
          className={`mt-6 overflow-hidden rounded-lg border ${
            result.valid ? 'border-verified/40' : 'border-blocked/40'
          }`}
        >
          <div
            className={`flex items-center justify-between px-5 py-3 font-mono text-[12px] uppercase tracking-eyebrow ${
              result.valid ? 'bg-verified/10 text-verified' : 'bg-blocked/10 text-blocked'
            }`}
          >
            <span>{result.valid ? 'Intact' : 'Tampered or altered'}</span>
            <span>{result.valid ? 'digest matches' : 'digest does not match'}</span>
          </div>

          <div className="space-y-3 bg-white p-5 font-mono text-[12px]">
            <div>
              <span className="text-muted">expected </span>
              <span className="break-all text-ivory">{result.expected}</span>
            </div>
            <div>
              <span className="text-muted">in document </span>
              <span className="break-all text-ivory">{result.found}</span>
            </div>

            {result.valid ? (
              <div className="border-t border-surface-border pt-3 leading-relaxed text-muted">
                <p>
                  <span className="text-muted">verdict </span>
                  <span className="text-ivory">{String(result.certificate['verdict'])}</span>
                  <span className="text-muted"> · collector </span>
                  <span className="text-ivory">
                    {String(result.certificate['brightDataCollectorId'])}
                  </span>
                </p>
                <p className="mt-2">
                  <span className="text-muted">page body sha-256 </span>
                  <span className="break-all text-ivory">
                    {String(result.certificate['witnessContentHash'])}
                  </span>
                </p>
                <p className="mt-3">
                  This document has not been edited since NOTICE issued it. The hash above is of the
                  exact page text the second sensor read.
                </p>
              </div>
            ) : (
              <p className="border-t border-surface-border pt-3 leading-relaxed text-blocked">
                At least one value differs from what was certified. Re-fetch the certificate from
                the incident page and compare.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
