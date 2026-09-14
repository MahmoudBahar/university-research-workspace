import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mail, Paperclip } from 'lucide-react';
import { api, type DocumentRow, type DraftContent, type RevisionDetail, type SendPlan } from '../lib/api';
import { useResource } from '../lib/useApi';
import { DataTable, ErrorBanner, IssueList, Loading, Markdown, Notice, Panel, Pill, StateBadge } from '../components/ui';
import { AppLink } from '../components/AppLink';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CopyButton } from '../components/CopyButton';
import { DiffView } from '../components/DiffView';
import { MailtoActions } from '../components/MailtoActions';

interface OutreachDetail {
  outreach: { id: string; person_id: string; state: string; current_revision: number; draft_path: string; program_id: string };
  content: DraftContent;
  noteSha256: string;
  noteText: string;
  brief: string | null;
  approval: { id: string; fingerprint: string; revision: number } | null;
  approvals: { id: string; revision: number; fingerprint: string; approved_at: string; invalidated_at: string | null; invalidated_reason: string | null }[];
  plan: SendPlan | null;
  sent: { id: string; sent_at_utc: string; was_approved: number }[];
  revisions: { revision: number; recipient: string; subject: string; fingerprint: string; source: string; created_at: string }[];
}

interface Validation {
  state: string;
  ready: boolean;
  fingerprint: string;
  issues: { code: string; message: string; severity: 'blocker' | 'warning' }[];
}

export default function EmailWorkspace() {
  const { id } = useParams();
  const detail = useResource<OutreachDetail>(id ? `/api/outreach/${encodeURIComponent(id)}` : null, [id]);
  const documents = useResource<{ documents: DocumentRow[] }>('/api/documents');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<{ document_id: string; version: number }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [validation, setValidation] = useState<Validation | undefined>();
  const [compare, setCompare] = useState<number | ''>('');
  const revisionDetail = useResource<RevisionDetail>(id && compare !== '' ? `/api/outreach/${encodeURIComponent(id)}/revisions/${compare}` : null, [id, compare]);

  useEffect(() => {
    if (!detail.data || dirty) return;
    setRecipient(detail.data.content.recipient);
    setSubject(detail.data.content.subject);
    setBody(detail.data.content.body);
    setAttachments(detail.data.content.attachments.map((a) => ({ document_id: a.document_id, version: a.version })));
  }, [detail.data, dirty]);

  if (detail.loading && !detail.data) return <Loading what="draft" variant="panel" />;
  if (detail.error) return <ErrorBanner error={detail.error} />;
  const data = detail.data;
  if (!data) return <Notice kind="warn">No draft {id}.</Notice>;

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.put<{ revision: number; approvalInvalidated: boolean; reason?: string }>(`/api/outreach/${data.outreach.id}`, {
        expectedSha: data.noteSha256,
        recipient,
        subject,
        body,
        attachments,
      });
      setMessage(
        `Saved revision ${result.revision}.${result.approvalInvalidated ? ` Approval invalidated: ${result.reason ?? ''}` : ''}`,
      );
      setDirty(false);
      setValidation(undefined);
      detail.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    setBusy(true);
    try {
      const result = await api.post<Validation>(`/api/outreach/${data.outreach.id}/validate`, {});
      setValidation(result);
      detail.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const compareRevision = compare === '' ? undefined : data.revisions.find((revision) => revision.revision === compare);

  return (
    <>
      <header>
        <Breadcrumbs items={[{ label: 'Email drafts', to: '/outreach' }, { label: `Draft ${data.outreach.id}` }]} />
        <h2>Draft {data.outreach.id}</h2>
        <p className="lede">
          <StateBadge state={data.outreach.state} /> · revision {data.outreach.current_revision} ·{' '}
          <AppLink to={`/people/${data.outreach.person_id}`}>open the profile</AppLink> ·{' '}
          <span className="mono small">{data.outreach.draft_path}</span>
        </p>
      </header>

      <ErrorBanner error={error} />
      {message ? <Notice kind="ok">{message}</Notice> : null}
      {dirty ? <Notice kind="warn">Unsaved edits. Saving creates a new revision and invalidates any approval that no longer matches.</Notice> : null}
      {data.approval ? (
        <Notice kind="ok" title="Approved.">
          Revision {data.approval.revision} is approved with fingerprint <span className="mono">{data.approval.fingerprint.slice(0, 16)}…</span>. Changing
          the recipient, subject, body or attachments returns it to review.
        </Notice>
      ) : null}

      <div className="split">
        <Panel icon={Mail} title="Editor">
          <div className="field">
            <label htmlFor="recipient">To</label>
            <input
              id="recipient"
              value={recipient}
              onChange={(event) => {
                setRecipient(event.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="subject">Subject</label>
            <input
              id="subject"
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="body">Message body</label>
            <textarea
              id="body"
              rows={18}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="button-row">
            <button type="button" className="primary" onClick={save} disabled={busy || !dirty}>
              Save revision
            </button>
            <button type="button" onClick={validate} disabled={busy || dirty}>
              Validate package
            </button>
            <CopyButton value={body} label="body" disabled={dirty} />
          </div>
        </Panel>

        <Panel title="Clean preview" hint="Exactly what you paste into your mail client. Internal notes are never part of it.">
          <dl className="meta-list">
            <dt>To</dt>
            <dd className="mono">{recipient || '—'}</dd>
            <dt>Subject</dt>
            <dd>{subject || '—'}</dd>
          </dl>
          <pre className="body-preview">{body}</pre>
          <MailtoActions
            recipient={data.content.recipient}
            subject={data.content.subject}
            body={data.content.body}
            disabled={dirty}
            includeBodyCopy={false}
            note={dirty ? 'Save the revision first; the mail client opens with the saved content only.' : undefined}
          />
          <p className="small muted">Fingerprint of the saved version: <span className="mono">{data.content.fingerprint.slice(0, 24)}…</span></p>
        </Panel>
      </div>

      {validation ? <IssueList issues={validation.issues} /> : null}

      <Panel icon={Paperclip} title="Attachments" hint="No attachment is selected by default, and nothing is ever uploaded or sent from here.">
        <DataTable
          rows={(documents.data?.documents ?? []).flatMap((doc) => doc.versions.map((version) => ({ doc, version })))}
          rowKey={(row) => row.version.id}
          empty="No documents imported. Add them on the Applicant screen."
          dense
          columns={[
            {
              key: 'select',
              header: 'Attach',
              render: (row) => {
                const selected = attachments.some((a) => a.document_id === row.doc.id && a.version === row.version.version);
                return (
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    aria-label={`Attach ${row.version.original_filename} version ${row.version.version}`}
                    checked={selected}
                    onChange={(event) => {
                      setDirty(true);
                      setAttachments((previous) =>
                        event.target.checked
                          ? [...previous.filter((a) => a.document_id !== row.doc.id), { document_id: row.doc.id, version: row.version.version }]
                          : previous.filter((a) => !(a.document_id === row.doc.id && a.version === row.version.version)),
                      );
                    }}
                  />
                );
              },
            },
            { key: 'file', header: 'File', render: (row) => row.version.original_filename },
            { key: 'kind', header: 'Type', render: (row) => row.doc.kind.replace(/_/g, ' ') },
            { key: 'version', header: 'Version', render: (row) => row.version.version },
            { key: 'hash', header: 'sha256', render: (row) => <span className="mono small">{row.version.sha256.slice(0, 12)}…</span> },
          ]}
        />
        <p className="small muted">
          Approval records the exact document versions above. Replacing a file changes its hash and returns this draft to
          review.
        </p>
      </Panel>

      <div className="split">
        <Panel title="Recipient's stated requirements">
          {data.content.contactRequirements.length === 0 ? (
            <p className="muted">No specific contact requirements were recorded for this recipient.</p>
          ) : (
            <ul>
              {data.content.contactRequirements.map((requirement) => (
                <li key={requirement.requirement}>
                  <Pill tone={requirement.satisfied === 'yes' ? 'ok' : requirement.satisfied === 'no' ? 'danger' : 'warn'}>
                    {requirement.satisfied}
                  </Pill>{' '}
                  {requirement.requirement}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Version history" hint="Compare the saved revisions of this package.">
          <div className="field">
            <label htmlFor="compare">Compare with revision</label>
            <select id="compare" value={compare} onChange={(event) => setCompare(event.target.value === '' ? '' : Number(event.target.value))}>
              <option value="">Current only</option>
              {data.revisions.map((revision) => (
                <option key={revision.revision} value={revision.revision}>
                  r{revision.revision} · {revision.source} · {revision.created_at.slice(0, 19)}Z
                </option>
              ))}
            </select>
          </div>
          {compareRevision ? (
            <dl className="meta-list">
              <dt>Recipient then</dt>
              <dd className={compareRevision.recipient === data.content.recipient ? '' : 'mono'}>
                {compareRevision.recipient}
                {compareRevision.recipient === data.content.recipient ? ' (unchanged)' : ' → ' + data.content.recipient}
              </dd>
              <dt>Subject then</dt>
              <dd>
                {compareRevision.subject}
                {compareRevision.subject === data.content.subject ? ' (unchanged)' : ' → ' + data.content.subject}
              </dd>
              <dt>Fingerprint</dt>
              <dd className="mono small">
                {compareRevision.fingerprint.slice(0, 16)}… {compareRevision.fingerprint === data.content.fingerprint ? '(same content)' : '(different content)'}
              </dd>
            </dl>
          ) : null}
          {compareRevision ? (
            revisionDetail.loading ? (
              <Loading what="revision body" />
            ) : revisionDetail.error ? (
              <p className="small muted">The body of r{compareRevision.revision} could not be loaded: {revisionDetail.error.message}</p>
            ) : revisionDetail.data ? (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <DiffView before={revisionDetail.data.body} after={data.content.body} beforeLabel={`r${compareRevision.revision}`} afterLabel="current" />
              </div>
            ) : null
          ) : null}
          <DataTable
            rows={data.approvals}
            rowKey={(approval) => approval.id}
            empty="Never approved."
            dense
            columns={[
              { key: 'revision', header: 'Revision', render: (approval) => approval.revision },
              { key: 'at', header: 'Approved', render: (approval) => approval.approved_at.slice(0, 19) + 'Z' },
              {
                key: 'status',
                header: 'Status',
                render: (approval) =>
                  approval.invalidated_at ? (
                    <Pill tone="warn" title={approval.invalidated_reason ?? ''}>
                      invalidated
                    </Pill>
                  ) : (
                    <Pill tone="ok">stands</Pill>
                  ),
              },
            ]}
          />
        </Panel>
      </div>

      <Panel title="Evidence brief" hint="Internal reasoning and citations. This is never part of the message.">
        {data.brief ? <Markdown text={data.brief} /> : <p className="muted">No brief recorded.</p>}
      </Panel>
    </>
  );
}
