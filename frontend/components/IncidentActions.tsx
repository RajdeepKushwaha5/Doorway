'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveAction,
  healAction,
  rejectAction,
  retryWitnessAction,
  type ActionResult,
} from '@/app/actions';
import { apiBase } from '@/lib/env';
import type { Incident, JobRecord } from '@/lib/types';

/**
 * The operator controls for one incident.
 *
 * Which buttons appear is derived from the incident's actual state, not left
 * to the reader. Offering "approve" on an incident that has not reached the
 * gate would invite a click the backend then refuses, and a demo where the
 * operator clicks something that fails is worse than one where the button was
 * never there.
 */
export function IncidentActions({ incident }: { incident: Incident }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const state = incident.history.at(-1)?.to ?? 'observed';
  const repairable =
    incident.classification === 'extractor_drift' || incident.classification === 'explicit_failure';

  const canHeal = repairable && (state === 'drift_confirmed' || state === 'repair_rejected');
  const canApprove = state === 'awaiting_approval';
  const canReject = state === 'awaiting_approval' || state === 'verifying_candidate';
  const canRetryWitness = incident.classification === 'inconclusive';

  const run = (label: string, action: () => Promise<ActionResult>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setMessage({ tone: 'ok', text: `${label} accepted.` });
        const data = result.data as { job?: { id: string } } | undefined;
        if (data?.job?.id !== undefined) setJobId(data.job.id);
        router.refresh();
      } else {
        setMessage({ tone: 'error', text: result.error });
      }
    });
  };

  if (!canHeal && !canApprove && !canReject && !canRetryWitness) {
    return (
      <p className="text-sm text-muted">
        No action is available in state <code className="font-mono">{state}</code>.
        {incident.classification === 'genuine_source_change'
          ? ' The collector is working and must not be repaired.'
          : ''}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {canHeal ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('Repair', () => healAction(incident.id))}
            className="status-chip border border-surface-border bg-surface-raised px-3 py-1.5 text-muted hover:text-ivory disabled:opacity-50"
          >
            {pending ? 'Working' : 'Diagnose and repair'}
          </button>
        ) : null}

        {canApprove ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('Promotion', () => approveAction(incident.id))}
            className="status-chip border border-verified/40 bg-verified/10 px-3 py-1.5 text-verified disabled:opacity-50"
          >
            {pending ? 'Working' : 'Approve and promote'}
          </button>
        ) : null}

        {canReject ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('Rejection', () => rejectAction(incident.id))}
            className="status-chip border border-blocked/40 bg-blocked/10 px-3 py-1.5 text-blocked disabled:opacity-50"
          >
            {pending ? 'Working' : 'Reject candidate'}
          </button>
        ) : null}

        {canRetryWitness ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('Retry', () => retryWitnessAction(incident.id))}
            className="status-chip border border-suspect/40 bg-suspect/10 px-3 py-1.5 text-suspect disabled:opacity-50"
          >
            {pending ? 'Working' : 'Retry witness'}
          </button>
        ) : null}
      </div>

      {canApprove ? (
        <p className="text-xs text-muted">
          The backend re-checks the incident state and the recorded gate before promoting. A repair
          that did not pass is refused here, not trusted.
        </p>
      ) : null}

      {message !== null ? (
        <p className={`text-sm ${message.tone === 'ok' ? 'text-verified' : 'text-blocked'}`}>
          {message.text}
        </p>
      ) : null}

      {jobId !== null ? <JobProgress jobId={jobId} /> : null}
    </div>
  );
}

/**
 * Poll a queued repair.
 *
 * A heal runs for minutes on the worker, so the page shows progress rather
 * than freezing. Polling stops as soon as the job reaches a terminal state.
 */
function JobProgress({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobRecord | null>(null);
  const base = apiBase();

  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      while (!cancelled) {
        try {
          // Reads go straight to the API. A job poll needs no token, and
          // routing it through a server action would add a round trip per
          // tick for no benefit.
          const response = await fetch(`${base}/api/jobs/${jobId}`, { cache: 'no-store' });
          if (response.ok) {
            const next = (await response.json()) as JobRecord;
            if (cancelled) return;
            setJob(next);
            if (next.status === 'succeeded' || next.status === 'failed') {
              router.refresh();
              return;
            }
          }
        } catch {
          // Transient. Keep polling: the job lives on the worker and outlives
          // any dropped request from this page.
        }
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, base, router]);

  return (
    <div className="border border-surface-border bg-surface-raised p-3">
      <p className="font-mono text-xs uppercase tracking-wide text-muted">
        Repair job {jobId.slice(0, 8)}, {job?.status ?? 'queued'}
      </p>
      <p className="mt-1 text-sm text-muted">
        {job?.detail ?? 'Waiting for a worker to pick this up.'}
      </p>
      {job?.error != null ? <p className="mt-1 text-sm text-blocked">{job.error}</p> : null}
    </div>
  );
}
