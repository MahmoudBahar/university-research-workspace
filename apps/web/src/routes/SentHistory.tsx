import { useState } from 'react';
import { History } from 'lucide-react';
import { api, type OutreachRow } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { useToast } from '../lib/toast';
import { DataTable, ErrorBanner, Panel, Pill } from '../components/ui';
import { AppLink } from '../components/AppLink';
import { EmptyState } from '../components/EmptyState';

interface SentRow {
  id: string;
  outreach_id: string;
  sent_at_utc: string;
  recipient: string;
  subject: string;
  attachments_json: string;
  was_approved: number;
  source: string;
  message_reference: string | null;
  note: string | null;
  snapshot_path: string;
  corrections: { id: string; at: string; action: string; detail_json: string }[];
}

export default function SentHistory() {
  const { withUniversity, selection } = useUniversity();
  const { toast } = useToast();
  const sent = useResource<SentRow[]>(withUniversity('/api/sent'), [selection], { keepPrevious: true });
  const drafts = useResource<OutreachRow[]>(withUniversity('/api/outreach'), [selection], { keepPrevious: true });
  const [snapshot, setSnapshot] = useState<{ id: string; text: string } | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [field, setField] = useState('sent_at_utc');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [externalDraft, setExternalDraft] = useState('');
  const [externalNote, setExternalNote] = useState('');
  const [anotherSend, setAnotherSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const viewSnapshot = async (id: string) => {
    try {
      const result = await api.get<{ text: string }>(`/api/sent/${id}/snapshot`);
      setSnapshot({ id, text: result.text });
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };

  const submitCorrection = async () => {
    if (!correcting) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/api/sent/${correcting}/correct`, { field, value, reason });
      toast({ kind: 'ok', message: 'Correction appended. The original snapshot is unchanged.' });
      setCorrecting(null);
      setValue('');
      setReason('');
      sent.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const recordExternal = async () => {
    if (!externalDraft) return;
    setBusy(true);
    setError(undefined);
    try {
      const draft = (drafts.data ?? []).find((row) => row.id === externalDraft);
      // The key is derived from the content, so a repeated click records one
      // send. "Record another send" mints a fresh key on purpose.
      const base = `sent:${externalDraft}:${draft?.current_fingerprint ?? 'unknown'}`;
      const key = anotherSend ? `${base}:${Date.now()}` : base;
      const result = await api.post<{ duplicate: boolean; event: { was_approved: number } }>(`/api/outreach/${externalDraft}/mark-sent`, {
        idempotencyKey: key,
        note: externalNote,
        allowUnapproved: true,
      });
      toast({
        kind: result.duplicate ? 'info' : 'ok',
        message: result.duplicate
          ? 'That send was already recorded for this exact content. Tick "Record another send" if you truly sent it again.'
          : result.event.was_approved
            ? 'Recorded. The content matched an approval.'
            : 'Recorded as an external send. The history keeps the fact that this version was never approved.',
      });
      setExternalNote('');
      setAnotherSend(false);
      sent.reload();
      drafts.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header>
        <h2>Sent history</h2>
        <p className="lede">
          Immutable snapshots of what you reported sending. Nothing here implies delivery, reading or a reply — only that
          you said you sent it.
        </p>
      </header>

      <ErrorBanner error={error} />

      <Panel icon={History} title="Recorded sends">
        {sent.loading && sent.data ? <div className="loading-bar" aria-hidden="true" /> : null}
        <DataTable
          rows={sent.data ?? []}
          rowKey={(row) => row.id}
          empty="Nothing has been recorded as sent."
          loading={sent.loading}
          defaultSort={{ key: 'at', dir: 'desc' }}
          emptyState={
            <EmptyState icon={History} title="Nothing has been recorded as sent.">
              After you send a message from your own mail client, report it with “I sent this” on the Send planner.
            </EmptyState>
          }
          columns={[
            {
              key: 'draft',
              header: 'Draft',
              sortValue: (row) => row.outreach_id,
              render: (row) => <AppLink to={`/outreach/${row.outreach_id}`}>{row.outreach_id}</AppLink>,
            },
            { key: 'at', header: 'Sent at (UTC)', sortValue: (row) => row.sent_at_utc, render: (row) => row.sent_at_utc.slice(0, 19) + 'Z' },
            { key: 'recipient', header: 'Recipient', sortValue: (row) => row.recipient, render: (row) => <span className="mono small">{row.recipient}</span> },
            { key: 'subject', header: 'Subject', sortValue: (row) => row.subject, render: (row) => row.subject },
            {
              key: 'attachments',
              header: 'Attachments',
              render: (row) => {
                const attachments = JSON.parse(row.attachments_json) as { filename: string; version: number }[];
                return attachments.length === 0 ? <span className="muted">none</span> : attachments.map((a) => `${a.filename} v${a.version}`).join(', ');
              },
            },
            {
              key: 'approved',
              header: 'Was approved',
              sortValue: (row) => row.was_approved,
              render: (row) => (row.was_approved ? <Pill tone="ok">yes</Pill> : <Pill tone="warn">no — external send</Pill>),
            },
            { key: 'source', header: 'Source', render: (row) => <Pill>{row.source.replace(/_/g, ' ')}</Pill> },
            {
              key: 'corrections',
              header: 'Corrections',
              render: (row) => (row.corrections.length === 0 ? <span className="muted">—</span> : row.corrections.length),
            },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <div className="button-row">
                  <button type="button" onClick={() => viewSnapshot(row.id)}>
                    Snapshot
                  </button>
                  <button type="button" onClick={() => setCorrecting(row.id)}>
                    Correct
                  </button>
                </div>
              ),
            },
          ]}
        />
      </Panel>

      {snapshot ? (
        <Panel title="Snapshot" actions={<button type="button" onClick={() => setSnapshot(null)}>Close</button>}>
          <p className="small muted">Stored exactly as it was when you reported the send. Later edits to the draft never touch it.</p>
          <pre className="body-preview">{snapshot.text}</pre>
        </Panel>
      ) : null}

      {correcting ? (
        <Panel title="Append a correction" actions={<button type="button" onClick={() => setCorrecting(null)}>Cancel</button>}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="correct-field">Field</label>
              <select id="correct-field" value={field} onChange={(event) => setField(event.target.value)}>
                {['sent_at_utc', 'recipient', 'subject', 'attachments', 'note'].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="correct-value">Corrected value</label>
              <input id="correct-value" value={value} onChange={(event) => setValue(event.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="correct-reason">Why</label>
            <input id="correct-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <button type="button" className="primary" onClick={submitCorrection} disabled={busy || value === '' || reason.length < 3}>
            Append correction
          </button>
          <p className="small muted">Corrections are new events. The original record stays exactly as it was.</p>
        </Panel>
      ) : null}

      <Panel title="Record a message you already sent" hint="Use this when you sent something that was changed or never approved.">
        <div className="field-row">
          <div className="field">
            <label htmlFor="external-draft">Draft</label>
            <select id="external-draft" value={externalDraft} onChange={(event) => setExternalDraft(event.target.value)}>
              <option value="">Choose a draft…</option>
              {(drafts.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.id} · {row.person_title ?? row.person_id} · {row.state}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="external-note">
              Note <span className="optional">what was different</span>
            </label>
            <input id="external-note" value={externalNote} onChange={(event) => setExternalNote(event.target.value)} />
          </div>
        </div>
        <div className="button-row">
          <button type="button" onClick={recordExternal} disabled={busy || !externalDraft}>
            Record external send
          </button>
          <label htmlFor="another-send" style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', margin: 0, fontWeight: 400 }}>
            <input id="another-send" type="checkbox" checked={anotherSend} onChange={(event) => setAnotherSend(event.target.checked)} />
            Record another send of the same content
          </label>
        </div>
        <p className="small muted">
          The current file content is re-read and fingerprinted first, then your report is recorded. If it was never
          approved, the record says so permanently. Reporting the same content twice records one send unless you say
          otherwise.
        </p>
      </Panel>
    </>
  );
}
