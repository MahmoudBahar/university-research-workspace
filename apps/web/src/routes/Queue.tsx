import { useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { ListChecks, X } from 'lucide-react';
import { api, type Bootstrap, type TaskRow } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { useToast } from '../lib/toast';
import { DataTable, ErrorBanner, Notice, Panel, Pill, StateBadge } from '../components/ui';
import { AppLink } from '../components/AppLink';

interface TasksResponse {
  tasks: TaskRow[];
  counts: Record<string, Record<string, number>>;
  jobs: { kind: string; number: number; label: string; skill: string; agent: string; atomicUnit: string }[];
  concurrency: { candidates: number; totalWorkers: number };
  execution: { mode: string; note: string };
}

interface QueueCommands {
  readyCount: number;
  byJob: { jobKind: string; count: number; command: string }[];
  resumeCommand: string;
  note: string;
}

export default function Queue() {
  const boot = useOutletContext<Bootstrap>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { withUniversity, selection } = useUniversity();
  const { toast } = useToast();
  const [job, setJob] = useState('');
  const [state, setState] = useState(searchParams.get('state') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const target = searchParams.get('target');

  const query = new URLSearchParams();
  if (job) query.set('job', job);
  if (state) query.set('state', state);
  if (target) query.set('target', target);
  const tasks = useResource<TasksResponse>(withUniversity(`/api/tasks?${query.toString()}`), [job, state, target, selection], { keepPrevious: true });
  const commands = useResource<QueueCommands>('/api/queue/commands');

  const clearTarget = () =>
    setSearchParams(
      (previous) => {
        previous.delete('target');
        return previous;
      },
      { replace: true },
    );

  const act = async (path: string, body: unknown, description: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.post(path, body);
      toast({ kind: 'ok', message: description });
      tasks.reload();
      commands.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const running = boot.status.activeRuns;

  return (
    <>
      <header>
        <h2>Queue</h2>
        <p className="lede">
          Prerequisites are evaluated per record, so an unfinished university-wide job never blocks a candidate whose own
          inputs are ready.
        </p>
      </header>

      <ErrorBanner error={error} />

      <Panel title="Execution">
        {running.length > 0 ? (
          <Notice kind="warn" title={`${running.length} assignment(s) executing now.`}>
            <ul>
              {running.map((run) => (
                <li key={run.taskId}>
                  {run.jobKind} · owner {run.owner ?? 'unknown'} · lease to {run.leaseExpiresAt ?? '—'} · run{' '}
                  <span className="mono">{run.runId ?? '—'}</span>
                </li>
              ))}
            </ul>
          </Notice>
        ) : (
          <Notice kind="info" title="Queued — start or resume Claude Code.">
            {tasks.data?.execution.note ?? 'Nothing is executing right now.'}
          </Notice>
        )}
        {commands.data && commands.data.readyCount > 0 ? (
          <ul>
            {commands.data.byJob.map((entry) => (
              <li key={entry.jobKind}>
                <code>{entry.command}</code> — {entry.count} ready
              </li>
            ))}
            <li>
              <code>{commands.data.resumeCommand}</code> — resume all ready work
            </li>
          </ul>
        ) : (
          <p className="small muted">No task is ready right now.</p>
        )}
        <p className="small muted">
          Concurrency: {tasks.data?.concurrency.candidates ?? '—'} candidate(s) at a time, {tasks.data?.concurrency.totalWorkers ?? '—'} workers
          overall. Change these in <AppLink to="/settings">Settings</AppLink>.
        </p>
        <div className="button-row">
          <button type="button" onClick={() => act('/api/tasks/reclaim', {}, 'Expired leases reclaimed.')} disabled={busy}>
            Reclaim expired leases
          </button>
          <button type="button" onClick={() => act('/api/maintenance/reconcile', {}, 'Reconciled with disk.')} disabled={busy}>
            Reconcile now
          </button>
        </div>
      </Panel>

      <Panel icon={ListChecks} title="Tasks">
        <div className="field-row">
          <div className="field">
            <label htmlFor="filter-job">Job</label>
            <select id="filter-job" value={job} onChange={(event) => setJob(event.target.value)}>
              <option value="">All jobs</option>
              {(tasks.data?.jobs ?? []).map((definition) => (
                <option key={definition.kind} value={definition.kind}>
                  {definition.number ? `${definition.number}. ` : ''}
                  {definition.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-state">State</label>
            <select id="filter-state" value={state} onChange={(event) => setState(event.target.value)}>
              <option value="">All states</option>
              {['pending', 'blocked', 'running', 'partial', 'complete', 'retryable_failed', 'failed', 'cancelled', 'stale'].map((name) => (
                <option key={name} value={name}>
                  {name.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
        {target ? (
          <p className="inline-gap small">
            <span className="chip">
              Showing tasks for {target}
              <button type="button" aria-label="Show all targets" onClick={clearTarget}>
                <X aria-hidden="true" />
              </button>
            </span>
          </p>
        ) : null}

        {tasks.loading && tasks.data ? <div className="loading-bar" aria-hidden="true" /> : null}
        <ErrorBanner error={tasks.error} />
        <DataTable
          rows={tasks.data?.tasks ?? []}
          rowKey={(task) => task.id}
          empty="No tasks match this filter."
          loading={tasks.loading}
          columns={[
            { key: 'job', header: 'Job', sortValue: (task) => task.job_kind, render: (task) => task.job_kind.replace(/_/g, ' ') },
            {
              key: 'target',
              header: 'Target',
              sortValue: (task) => task.target_title ?? task.target_id,
              render: (task) => (
                <>
                  <div>{task.target_title ?? task.target_id}</div>
                  <span className="mono small muted">{task.target_id}</span>
                </>
              ),
            },
            { key: 'state', header: 'State', sortValue: (task) => task.state, render: (task) => <StateBadge state={task.state} /> },
            {
              key: 'blockers',
              header: 'Blocked by',
              sortValue: (task) => task.blockers.length,
              render: (task) =>
                task.blockers.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                    {task.blockers.map((blocker) => (
                      <li key={blocker.code} className="small">
                        {blocker.message}
                      </li>
                    ))}
                  </ul>
                ),
            },
            { key: 'attempts', header: 'Attempts', sortValue: (task) => task.attempts, render: (task) => task.attempts },
            {
              key: 'retry',
              header: 'Cooldown',
              render: (task) => (task.next_attempt_at ? <Pill tone="warn">{task.next_attempt_at.slice(0, 19)}Z</Pill> : <span className="muted">—</span>),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (task) => (
                <div className="button-row">
                  <button
                    type="button"
                    disabled={busy || task.state === 'running'}
                    onClick={() => act(`/api/tasks/${task.id}/retry`, {}, `Task ${task.id} returned to the ready queue.`)}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || task.state === 'cancelled'}
                    onClick={() => act(`/api/tasks/${task.id}/cancel`, { reason: 'Cancelled from the queue screen.' }, `Task ${task.id} cancelled.`)}
                  >
                    Cancel
                  </button>
                </div>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
