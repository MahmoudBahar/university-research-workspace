import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, type DraftContent, type OutreachRow } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { DataTable, ErrorBanner, IssueList, Loading, Notice, Panel, Pill, StateBadge } from '../components/ui';
import { AppLink } from '../components/AppLink';
import { EmptyState } from '../components/EmptyState';
import { MailtoActions } from '../components/MailtoActions';

interface OutreachDetail {
  outreach: { id: string; state: string; person_id: string };
  content: DraftContent;
  approval: { fingerprint: string; revision: number } | null;
  approvals: { id: string; revision: number; approved_at: string; invalidated_at: string | null; invalidated_reason: string | null }[];
}

interface Validation {
  ready: boolean;
  fingerprint: string;
  state: string;
  issues: { code: string; message: string; severity: 'blocker' | 'warning' }[];
}

export default function Review() {
  const { withUniversity, selection } = useUniversity();
  const drafts = useResource<OutreachRow[]>(withUniversity('/api/outreach'), [selection], { keepPrevious: true });
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useResource<OutreachDetail>(selected ? `/api/outreach/${encodeURIComponent(selected)}` : null, [selected]);
  const [validation, setValidation] = useState<Validation | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const pending = (drafts.data ?? []).filter((row) => ['draft', 'needs_review', 'approved'].includes(row.state));

  const open = async (outreachId: string) => {
    setSelected(outreachId);
    setValidation(undefined);
    setMessage(undefined);
    try {
      setValidation(await api.post<Validation>(`/api/outreach/${outreachId}/validate`, {}));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };

  const approve = async () => {
    if (!detail.data) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.post<{ revision: number }>(`/api/outreach/${detail.data.outreach.id}/approve`, {
        fingerprint: detail.data.content.fingerprint,
      });
      setMessage(`Approved revision ${result.revision}. Choose a planned time on the Send planner when you are ready.`);
      detail.reload();
      drafts.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: string, body: unknown, description: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.post(path, body);
      setMessage(description);
      detail.reload();
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
        <h2>Review</h2>
        <p className="lede">
          Approval binds the recipient, subject, exact body and attachment versions. The file is re-read and
          hashed again immediately before the approval is recorded.
        </p>
      </header>

      <ErrorBanner error={error} />
      {message ? <Notice kind="ok">{message}</Notice> : null}

      <Panel icon={ShieldCheck} title="Drafts awaiting a decision">
        {drafts.loading && drafts.data ? <div className="loading-bar" aria-hidden="true" /> : null}
        <DataTable
          rows={pending}
          rowKey={(row) => row.id}
          empty="Nothing is waiting for review."
          loading={drafts.loading}
          emptyState={
            <EmptyState icon={ShieldCheck} title="Nothing is waiting for review." command="/draft-outreach --ready">
              Drafts land here once Job 7 writes them.
            </EmptyState>
          }
          columns={[
            { key: 'id', header: 'Draft', sortValue: (row) => row.id, render: (row) => row.id },
            { key: 'person', header: 'Person', sortValue: (row) => row.person_title ?? row.person_id, render: (row) => row.person_title ?? row.person_id },
            { key: 'state', header: 'State', sortValue: (row) => row.state, render: (row) => <StateBadge state={row.state} /> },
            {
              key: 'open',
              header: '',
              render: (row) => (
                <div className="button-row">
                  <button type="button" onClick={() => open(row.id)}>
                    Review
                  </button>
                  <AppLink className="button" to={`/outreach/${row.id}`}>
                    Edit
                  </AppLink>
                </div>
              ),
            },
          ]}
        />
      </Panel>

      {selected ? (
        <Panel
          title={`Reviewing ${selected}`}
          actions={<button type="button" onClick={() => setSelected(null)}>Close</button>}
        >
          {detail.loading ? <Loading what="draft" variant="panel" /> : null}
          {detail.data ? (
            <>
              <dl className="meta-list">
                <dt>To</dt>
                <dd className="mono">{detail.data.content.recipient}</dd>
                <dt>Subject</dt>
                <dd>{detail.data.content.subject}</dd>
                <dt>Attachments</dt>
                <dd>
                  {detail.data.content.attachments.length === 0
                    ? 'None selected'
                    : detail.data.content.attachments.map((a) => `${a.filename} (${a.document_id} v${a.version})`).join(', ')}
                </dd>
                <dt>Fingerprint</dt>
                <dd className="mono small">{detail.data.content.fingerprint}</dd>
              </dl>
              <pre className="body-preview">{detail.data.content.body}</pre>
              <MailtoActions
                recipient={detail.data.content.recipient}
                subject={detail.data.content.subject}
                body={detail.data.content.body}
                note={
                  detail.data.outreach.state === 'approved'
                    ? 'Opens your mail client with the approved content. Nothing is sent or recorded here; report the send with “I sent this” on the planner afterwards.'
                    : 'Opens your mail client with this content. It is not approved yet; approve the exact revision first if you want the send recorded as approved.'
                }
              />
              {validation ? <IssueList issues={validation.issues} /> : null}

              {detail.data.approvals.some((approval) => approval.invalidated_at) ? (
                <Notice kind="warn" title="An earlier approval was invalidated.">
                  <ul>
                    {detail.data.approvals
                      .filter((approval) => approval.invalidated_at)
                      .map((approval) => (
                        <li key={approval.id}>
                          r{approval.revision}: {approval.invalidated_reason ?? 'content changed'}
                        </li>
                      ))}
                  </ul>
                </Notice>
              ) : null}

              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  onClick={approve}
                  disabled={busy || detail.data.outreach.state === 'approved' || (validation ? !validation.ready : false)}
                >
                  Approve this exact revision
                </button>
                <button
                  type="button"
                  onClick={() => act(`/api/outreach/${selected}/return`, { reason: 'Returned for editing from the review screen.' }, 'Returned for editing.')}
                  disabled={busy}
                >
                  Return for editing
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => act(`/api/outreach/${selected}/archive`, { reason: 'Archived from the review screen.' }, 'Archived.')}
                  disabled={busy}
                >
                  Archive
                </button>
                {detail.data.approval ? <Pill tone="ok">approved r{detail.data.approval.revision}</Pill> : null}
              </div>
            </>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}
