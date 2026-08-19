import type { AuditEvent } from '@/lib/types';

/**
 * What the system actually did, with the actor that did it.
 *
 * The backend has written these on every observation, heal, approval and
 * rejection since the beginning, and returned them on every incident fetch.
 * Nothing rendered them, so the one record that distinguishes "NOTICE decided
 * this" from "Bright Data decided this" was fetched and thrown away on every
 * page load.
 *
 * It belongs beside the transition timeline rather than inside it. The timeline
 * says how an incident moved between states; this says who moved it, which is
 * the question anyone auditing an automated repair actually has.
 */

/** Colour by who acted, since that is the distinction worth seeing at a glance. */
const ACTOR: Record<AuditEvent['actor'], { label: string; tone: string }> = {
  system: { label: 'NOTICE', tone: 'text-muted' },
  brightdata: { label: 'Bright Data', tone: 'text-parse-accent' },
  user: { label: 'Operator', tone: 'text-ivory' },
};

/**
 * Summarise a payload without dumping it.
 *
 * These carry Bright Data responses and collector rows. Rendering them whole
 * would put arbitrary scraped content, and potentially a long template, into a
 * page somebody is likely to be screen-sharing.
 */
function summarise(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const keys = Object.keys(payload as Record<string, unknown>);
  if (keys.length === 0) return null;
  return keys.slice(0, 6).join(', ');
}

export function AuditLog({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted">
        No audit events recorded against this incident yet. They are written when the system acts,
        not when it renders.
      </p>
    );
  }

  const ordered = [...events].sort((left, right) => left.at.localeCompare(right.at));

  return (
    <div className="overflow-x-auto border border-surface-border">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="sr-only">Audit events recorded against this incident</caption>
        <thead className="bg-surface-raised text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Time
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Actor
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Event
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Recorded
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border">
          {ordered.map((event) => {
            const actor = ACTOR[event.actor];
            return (
              <tr key={event.id}>
                <td className="px-4 py-2 font-mono text-xs text-muted">
                  {event.at.replace('T', ' ').slice(0, 19)}
                </td>
                <td className={`px-4 py-2 text-xs font-semibold ${actor.tone}`}>{actor.label}</td>
                <td className="px-4 py-2 font-mono text-xs text-ivory">{event.eventType}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted">
                  {summarise(event.payload) ?? 'no detail'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
