import { useState } from 'react';
import { Clock } from 'lucide-react';
import { api, type PlannerRow } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { DataTable, ErrorBanner, Notice, Panel, Pill } from '../components/ui';
import { AppLink } from '../components/AppLink';

interface PlannerResponse {
  displayZone: string;
  rows: PlannerRow[];
}

interface Suggestion {
  available: boolean;
  reason?: string;
  date?: string;
  time?: string;
  zone?: string;
  rationale?: string;
  zoneBasis?: string;
}

export default function SendPlanner() {
  const { withUniversity, selection } = useUniversity();
  const planner = useResource<PlannerResponse>(withUniversity('/api/send-plans'), [selection], { keepPrevious: true });
  const [editing, setEditing] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [zone, setZone] = useState('');
  const [occurrence, setOccurrence] = useState<'' | 'earlier' | 'later'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [suggestion, setSuggestion] = useState<Suggestion | undefined>();
  const [anotherSend, setAnotherSend] = useState<string | null>(null);

  const startEdit = async (row: PlannerRow) => {
    setEditing(row.outreachId);
    setError(undefined);
    setMessage(undefined);
    setOccurrence('');
    setDate(row.plan?.local_date ?? '');
    setTime(row.plan?.local_time ?? '09:00');
    setZone(row.plan?.recipient_zone ?? '');
    try {
      const result = await api.get<Suggestion>(`/api/outreach/${row.outreachId}/suggest-time`);
      setSuggestion(result);
      if (result.available && !row.plan) {
        setDate(result.date ?? '');
        setTime(result.time ?? '09:00');
        setZone(result.zone ?? '');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };

  const savePlan = async () => {
    if (!editing) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.put<{ utc_instant: string; recipient_zone: string; zone_basis: string }>(
        `/api/outreach/${editing}/send-plan`,
        { date, time, zone: zone || undefined, occurrence: occurrence || undefined },
      );
      setMessage(
        `Planned for ${date} ${time} in ${result.recipient_zone} (${result.zone_basis.replace(/_/g, ' ')}), which is ${result.utc_instant}. Nothing is sent by this.`,
      );
      setEditing(null);
      planner.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const markSent = async (outreachId: string, again = false) => {
    setBusy(true);
    setError(undefined);
    try {
      // The key is derived from the exact approved content, so a second click
      // records nothing new. Recording another send of the same content is a
      // separate, explicit action.
      const detail = await api.get<{ content: { fingerprint: string } }>(`/api/outreach/${outreachId}`);
      const base = `sent:${outreachId}:${detail.content.fingerprint}`;
      const key = again ? `${base}:${Date.now()}` : base;
      const result = await api.post<{ duplicate: boolean; event: { was_approved: number } }>(`/api/outreach/${outreachId}/mark-sent`, {
        idempotencyKey: key,
      });
      if (result.duplicate) {
        setMessage('That send was already recorded for this exact content.');
        setAnotherSend(outreachId);
      } else {
        setMessage('Recorded your report that the message was sent.');
        setAnotherSend(null);
      }
      planner.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const rows = planner.data?.rows ?? [];
  const ambiguous = (error as { detail?: { code?: string } } | undefined)?.detail?.code === 'ambiguous_local_time';

  return (
    <>
      <header>
        <h2>Send planner</h2>
        <p className="lede">
          Planned times are reminders. No scheduler exists, nothing wakes up at the planned time, and a time that has
          passed only changes the due view. You send from your own mail client.
        </p>
      </header>

      <ErrorBanner error={error} />
      {ambiguous ? (
        <Notice kind="warn" title="That local time happens twice.">
          Choose the earlier or later occurrence below, then save again.
        </Notice>
      ) : null}
      {message ? <Notice kind="ok">{message}</Notice> : null}
      {anotherSend ? (
        <Notice kind="info">
          If you genuinely sent {anotherSend} a second time with the same content,{' '}
          <button type="button" className="ghost" disabled={busy} onClick={() => markSent(anotherSend, true)}>
            Record another send
          </button>
        </Notice>
      ) : null}

      <Panel icon={Clock} title="Plans" hint={`Your display zone is ${planner.data?.displayZone ?? 'unknown'}.`}>
        {planner.loading && planner.data ? <div className="loading-bar" aria-hidden="true" /> : null}
        <DataTable
          rows={rows}
          rowKey={(row) => row.outreachId}
          empty="No drafts yet."
          loading={planner.loading}
          columns={[
            {
              key: 'draft',
              header: 'Draft',
              sortValue: (row) => row.outreachId,
              render: (row) => (
                <>
                  <AppLink to={`/outreach/${row.outreachId}`}>{row.outreachId}</AppLink>
                  <div className="small muted">{row.personTitle ?? ''}</div>
                </>
              ),
            },
            { key: 'state', header: 'State', sortValue: (row) => row.state, render: (row) => <Pill>{row.state.replace(/_/g, ' ')}</Pill> },
            {
              key: 'recipient',
              header: "Recipient's local time",
              sortValue: (row) => row.plan?.utc_instant,
              render: (row) =>
                row.recipientRendering ? (
                  <>
                    {row.recipientRendering.weekday} {row.recipientRendering.formatted}
                    {row.plan?.zone_basis ? <div className="small muted">zone basis: {row.plan.zone_basis.replace(/_/g, ' ')}</div> : null}
                  </>
                ) : (
                  <span className="muted">not planned</span>
                ),
            },
            {
              key: 'yours',
              header: 'Your local time',
              sortValue: (row) => row.plan?.utc_instant,
              render: (row) => (row.displayRendering ? row.displayRendering.formatted : <span className="muted">—</span>),
            },
            {
              key: 'due',
              header: 'Due',
              render: (row) =>
                row.sent ? (
                  <Pill tone="ok">sent</Pill>
                ) : row.due === 'overdue' ? (
                  <Pill tone="danger">overdue</Pill>
                ) : row.due === 'due' ? (
                  <Pill tone="warn">due</Pill>
                ) : row.due === 'scheduled' ? (
                  <Pill>scheduled</Pill>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              key: 'drift',
              header: 'Zone rules',
              render: (row) =>
                row.drift?.drifted ? (
                  <Pill tone="warn" title={row.drift.reason ?? 'The stored wall-clock intent no longer maps to the saved instant.'}>
                    changed
                  </Pill>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (row) => (
                <div className="button-row">
                  <button type="button" onClick={() => startEdit(row)} disabled={busy}>
                    {row.plan ? 'Reschedule' : 'Plan a time'}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => markSent(row.outreachId)}
                    disabled={busy || row.sent || row.state !== 'approved'}
                    title={row.state !== 'approved' ? 'Approve the exact content first, or record an external send from Sent history.' : ''}
                  >
                    I sent this
                  </button>
                </div>
              ),
            },
          ]}
        />
      </Panel>

      {editing ? (
        <Panel title={`Plan a time for ${editing}`} actions={<button type="button" onClick={() => setEditing(null)}>Cancel</button>}>
          {suggestion && !suggestion.available ? <Notice kind="warn">{suggestion.reason}</Notice> : null}
          {suggestion?.available ? <Notice kind="info">{suggestion.rationale}</Notice> : null}
          <div className="field-row">
            <div className="field">
              <label htmlFor="plan-date">Date in the recipient's zone</label>
              <input id="plan-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="plan-time">Time</label>
              <input id="plan-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="plan-zone">
                IANA zone <span className="optional">override</span>
              </label>
              <input id="plan-zone" value={zone} onChange={(event) => setZone(event.target.value)} placeholder="America/Toronto" />
            </div>
            <div className="field">
              <label htmlFor="plan-occurrence">
                If the time happens twice <span className="optional">(clocks go back)</span>
              </label>
              <select id="plan-occurrence" value={occurrence} onChange={(event) => setOccurrence(event.target.value as '' | 'earlier' | 'later')}>
                <option value="">Not applicable</option>
                <option value="earlier">First occurrence</option>
                <option value="later">Second occurrence</option>
              </select>
            </div>
          </div>
          <div className="button-row">
            <button type="button" className="primary" onClick={savePlan} disabled={busy || !date || !time}>
              Save plan
            </button>
          </div>
          <p className="small muted">
            A time that does not exist because the clocks move forward is refused rather than shifted silently.
          </p>
        </Panel>
      ) : null}
    </>
  );
}
