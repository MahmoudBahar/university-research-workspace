import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useToast } from '../lib/toast';
import { DataTable, ErrorBanner, Loading, Panel, Pill } from '../components/ui';

interface SettingsResponse {
  config: Record<string, unknown>;
  configPath: string;
  displayZone: string;
  paths: { root: string; vault: string; data: string; applicant: string };
  runtime: { node: string; platform: string; driver: string; driverProbe: unknown; temporal: string };
  note: string;
}

interface BackupRow {
  path: string;
  manifest: { createdAt: string; label: string; fileCount: number; databaseSha256: string; contents: string[] } | null;
}

interface IssueRow {
  id: string;
  path: string;
  kind: string;
  detail: string | null;
  created_at: string;
}

export default function Settings() {
  const settings = useResource<SettingsResponse>('/api/settings');
  const backups = useResource<BackupRow[]>('/api/maintenance/backups');
  const issues = useResource<IssueRow[]>('/api/issues');
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    if (settings.data && draft === '') setDraft(JSON.stringify(settings.data.config, null, 2));
  }, [settings.data, draft]);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const parsed = JSON.parse(draft) as unknown;
      await api.put('/api/settings', { config: parsed });
      toast({ kind: 'ok', message: 'Saved to config/research.json. Restart the server so every process picks it up.' });
      settings.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const run = async (path: string, label: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.post<Record<string, unknown>>(path, {});
      toast({ kind: 'ok', title: label, message: JSON.stringify(result).slice(0, 400) });
      backups.reload();
      issues.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header>
        <h2>Settings</h2>
        <p className="lede">
          Research depth, degree scope, freshness windows, concurrency and time-zone display. Everything lives in a file
          you can also edit by hand.
        </p>
      </header>

      <ErrorBanner error={error} />
      {settings.loading ? <Loading what="settings" variant="panel" /> : null}

      {settings.data ? (
        <>
          <Panel icon={SettingsIcon} title="Runtime">
            <dl className="meta-list">
              <dt>Workspace root</dt>
              <dd className="mono small">{settings.data.paths.root}</dd>
              <dt>Node</dt>
              <dd>
                {settings.data.runtime.node} on {settings.data.runtime.platform}
              </dd>
              <dt>SQLite driver</dt>
              <dd>
                <Pill tone="ok">{settings.data.runtime.driver}</Pill>
              </dd>
              <dt>Temporal implementation</dt>
              <dd>{settings.data.runtime.temporal}</dd>
              <dt>Your display zone</dt>
              <dd>{settings.data.displayZone}</dd>
            </dl>
          </Panel>

          <Panel title={`Configuration (${settings.data.configPath})`}>
            <div className="field">
              <label htmlFor="config">JSON</label>
              <textarea id="config" rows={22} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
            </div>
            <div className="button-row">
              <button type="button" className="primary" onClick={save} disabled={busy}>
                Save configuration
              </button>
              <button type="button" onClick={() => setDraft(JSON.stringify(settings.data?.config, null, 2))} disabled={busy}>
                Reset
              </button>
            </div>
            <p className="small muted">{settings.data.note}</p>
          </Panel>
        </>
      ) : null}

      <Panel icon={Wrench} title="Maintenance">
        <div className="button-row">
          <button type="button" onClick={() => run('/api/maintenance/reconcile', 'Reconciled')} disabled={busy}>
            Reconcile vault
          </button>
          <button type="button" onClick={() => run('/api/maintenance/check-links', 'Link check')} disabled={busy}>
            Check links
          </button>
          <button type="button" onClick={() => run('/api/maintenance/views', 'Views rebuilt')} disabled={busy}>
            Rebuild views
          </button>
          <button type="button" className="primary" onClick={() => run('/api/maintenance/backup', 'Backup created')} disabled={busy}>
            Create backup
          </button>
        </div>
        <p className="small muted">
          Restoring a backup uses the CLI so the database can be closed first:{' '}
          <code>npm run research -- backup restore --from &lt;dir&gt; --force</code>
        </p>
      </Panel>

      <Panel title="Backups">
        <DataTable
          rows={backups.data ?? []}
          rowKey={(row) => row.path}
          empty="No backups yet."
          columns={[
            { key: 'created', header: 'Created', render: (row) => row.manifest?.createdAt.slice(0, 19).replace('T', ' ') ?? '—' },
            { key: 'label', header: 'Label', render: (row) => row.manifest?.label ?? '—' },
            { key: 'files', header: 'Files', render: (row) => row.manifest?.fileCount ?? 0 },
            { key: 'contents', header: 'Contents', render: (row) => (row.manifest?.contents ?? []).join(', ') },
            { key: 'path', header: 'Path', render: (row) => <span className="mono small">{row.path}</span> },
          ]}
        />
      </Panel>

      <Panel title="Open note issues" hint="Invalid frontmatter, hand-edited generated blocks, identity mismatches and missing files.">
        <DataTable
          rows={issues.data ?? []}
          rowKey={(row) => row.id}
          empty="No open issues."
          columns={[
            { key: 'kind', header: 'Issue', render: (row) => row.kind.replace(/_/g, ' ') },
            { key: 'path', header: 'Note', render: (row) => <span className="mono small">{row.path}</span> },
            { key: 'detail', header: 'Detail', render: (row) => <span className="small">{row.detail ?? '—'}</span> },
            {
              key: 'resolve',
              header: '',
              render: (row) => (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await api.post(`/api/issues/${row.id}/resolve`, {});
                      toast({ kind: 'ok', message: `Issue ${row.id} marked resolved.` });
                      issues.reload();
                    } catch (cause) {
                      setError(cause instanceof Error ? cause : new Error(String(cause)));
                    }
                  }}
                >
                  Mark resolved
                </button>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
