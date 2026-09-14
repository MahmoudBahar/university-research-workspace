import { Activity, Database, FileText, ListChecks, Mail, ShieldCheck, type LucideIcon } from 'lucide-react';
import { type AppEvent, type EventsResponse } from '../lib/api';
import { useResource } from '../lib/useApi';
import { AppLink } from './AppLink';
import { Loading } from './ui';

function iconFor(kind: string): LucideIcon {
  if (kind.startsWith('task:')) return ListChecks;
  if (kind.startsWith('outreach:')) return Mail;
  if (kind.startsWith('entity:')) return Database;
  if (kind.startsWith('audit:')) return ShieldCheck;
  if (kind.startsWith('note:')) return FileText;
  return Activity;
}

function hrefFor(entityId: string | null): string | null {
  if (!entityId) return null;
  if (/^person-/.test(entityId)) return `/people/${entityId}`;
  if (/^lab-/.test(entityId)) return `/labs/${entityId}`;
  if (/^draft-/.test(entityId)) return `/outreach/${entityId}`;
  if (/^task-/.test(entityId)) return `/queue?target=${encodeURIComponent(entityId)}`;
  return null;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}

/** The newest workspace events. Events carry no university, so this is workspace-wide. */
export function ActivityFeed({ sinceSeq, limit = 40 }: { sinceSeq: number; limit?: number }) {
  const since = Math.max(0, sinceSeq - limit);
  const events = useResource<EventsResponse>(`/api/events?since=${since}&limit=${limit}`, [sinceSeq], { keepPrevious: true });
  if (events.loading && !events.data) return <Loading what="activity" variant="table" rows={5} columns={3} />;
  const rows = [...(events.data?.events ?? [])].reverse();
  if (rows.length === 0) return <p className="muted">No activity recorded yet.</p>;
  return (
    <ul className="activity">
      {rows.map((event: AppEvent) => {
        const Icon = iconFor(event.kind);
        const href = hrefFor(event.entityId);
        return (
          <li key={event.seq}>
            <Icon aria-hidden="true" />
            <span>
              <span className="activity-kind">{event.kind.replace(/[:_]/g, ' ')}</span>
              {event.entityId ? (
                <>
                  {' · '}
                  {href ? <AppLink to={href}>{event.entityId}</AppLink> : <span className="mono">{event.entityId}</span>}
                </>
              ) : null}
            </span>
            <time className="activity-when" dateTime={event.at} title={event.at}>
              {ago(event.at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
