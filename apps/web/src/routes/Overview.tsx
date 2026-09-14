import { useOutletContext } from 'react-router-dom';
import { Activity, AlertTriangle, Building2, CheckCircle2, Clock, ListChecks, Mail, Users } from 'lucide-react';
import type { Bootstrap, UnitProgressResponse } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { DataTable, Loading, Notice, Panel, Pill, Stat, StateBadge } from '../components/ui';
import { AppLink } from '../components/AppLink';
import { ActivityFeed } from '../components/ActivityFeed';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState } from '../components/EmptyState';

interface QueueCommands {
  readyCount: number;
  byJob: { jobKind: string; count: number; skill: string; command: string }[];
  resumeCommand: string;
  note: string;
}

export default function Overview() {
  const boot = useOutletContext<Bootstrap>();
  const { selection, university, withUniversity } = useUniversity();
  const status = boot.status;
  const commands = useResource<QueueCommands>('/api/queue/commands');
  const progress = useResource<UnitProgressResponse>(selection === 'all' ? null : withUniversity('/api/units/progress'), [selection, status.eventSeq], {
    keepPrevious: true,
  });
  const ready = status.readyCandidates.filter((row) => row.emailReady);
  const universities = selection === 'all' ? status.universities : status.universities.filter((row) => row.id === selection);

  return (
    <>
      <header>
        <h2>Overview</h2>
        <p className="lede">
          Progress by job, what is ready, and what is waiting for you. Research runs in your Claude Code session; this
          interface queues work and handles review.
        </p>
      </header>

      <div className="grid cols-4" style={{ marginBottom: 'var(--space-4)' }}>
        <Stat value={status.jobs.reduce((sum, job) => sum + job.ready, 0)} label="Ready tasks" tone="ok" icon={ListChecks} to="/queue" />
        <Stat value={status.blocked.length} label="Blocked tasks" tone={status.blocked.length ? 'warn' : undefined} icon={AlertTriangle} to="/queue?state=blocked" />
        <Stat value={ready.length} label="Candidates ready for email" tone="ok" icon={Users} to="/people?ready=true" />
        <Stat
          value={status.outreach.due + status.outreach.overdue}
          label="Planned times passed"
          tone={status.outreach.due + status.outreach.overdue ? 'danger' : undefined}
          icon={Clock}
          to="/planner"
        />
      </div>

      <Panel title="What to do next" icon={CheckCircle2}>
        <ul>
          {boot.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
        {status.activeRuns.length > 0 ? (
          <Notice kind="warn" title="A Claude assignment is running.">
            {status.activeRuns.map((run) => `${run.jobKind} (owner ${run.owner ?? 'unknown'}, lease to ${run.leaseExpiresAt ?? '—'})`).join('; ')}
          </Notice>
        ) : (
          <Notice kind="info" title="No Claude assignment is executing.">
            Queued work waits until you start or resume a Claude Code session. Nothing runs on its own.
          </Notice>
        )}
        {commands.loading ? <Loading what="queue commands" /> : null}
        {commands.data && commands.data.readyCount > 0 ? (
          <>
            <p className="small muted">{commands.data.note}</p>
            <ul>
              {commands.data.byJob.map((entry) => (
                <li key={entry.jobKind}>
                  <code>{entry.command}</code> — {entry.count} ready
                </li>
              ))}
              <li>
                <code>{commands.data.resumeCommand}</code> — resume everything that is ready
              </li>
            </ul>
          </>
        ) : null}
      </Panel>

      {selection !== 'all' ? (
        <Panel title="Progress by unit" icon={Building2} hint={`Included units of ${university?.name ?? selection}: tasks complete against tasks queued.`}>
          {progress.loading && !progress.data ? <Loading what="unit progress" variant="table" columns={3} /> : null}
          {progress.data ? (
            <DataTable
              rows={progress.data.units.filter((unit) => unit.decision === 'included').slice(0, 12)}
              rowKey={(unit) => unit.unitId}
              empty="No included unit has queued work yet."
              dense
              columns={[
                { key: 'unit', header: 'Unit', render: (unit) => unit.name, sortValue: (unit) => unit.name },
                {
                  key: 'progress',
                  header: 'Tasks',
                  sortValue: (unit) => (unit.tasks.total ? unit.tasks.complete / unit.tasks.total : -1),
                  render: (unit) => <ProgressBar value={unit.tasks.complete} max={unit.tasks.total} label={`Progress for ${unit.name}`} />,
                },
                { key: 'people', header: 'People researched', render: (unit) => `${unit.people.researchComplete}/${unit.people.total}`, sortValue: (unit) => unit.people.researchComplete },
                { key: 'ready', header: 'Email ready', render: (unit) => unit.people.emailReady, sortValue: (unit) => unit.people.emailReady },
                { key: 'programs', header: 'Programs', render: (unit) => unit.programs, sortValue: (unit) => unit.programs },
              ]}
            />
          ) : null}
          {progress.data && progress.data.units.length > 12 ? (
            <p className="small muted">
              Showing the first twelve. <AppLink to="/scope">See all departments</AppLink>.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Jobs" hint="Every job can be invoked independently for records whose own inputs are ready.">
        <DataTable
          rows={status.jobs}
          rowKey={(job) => job.jobKind}
          empty="No jobs yet."
          dense
          columns={[
            { key: 'job', header: 'Job', render: (job) => (job.jobNumber ? String(job.jobNumber) : '—') },
            { key: 'label', header: 'Name', render: (job) => job.label },
            {
              key: 'states',
              header: 'States',
              render: (job) =>
                Object.keys(job.counts).length === 0 ? (
                  <span className="muted">none</span>
                ) : (
                  <span className="inline-gap">
                    {Object.entries(job.counts).map(([state, count]) => (
                      <span key={state}>
                        <StateBadge state={state} /> {count}
                      </span>
                    ))}
                  </span>
                ),
            },
            { key: 'ready', header: 'Ready', render: (job) => <Pill tone={job.ready ? 'ok' : 'default'}>{job.ready}</Pill> },
          ]}
        />
      </Panel>

      <div className="split">
        <Panel title="Universities" icon={Building2}>
          <DataTable
            rows={universities}
            rowKey={(row) => row.id}
            empty="No university yet. Start one with /research-university “University name”."
            emptyState={
              <EmptyState icon={Building2} title="No university yet." command={'/research-university "University name"'}>
                No university yet. Start one with /research-university “University name”.
              </EmptyState>
            }
            columns={[
              { key: 'name', header: 'University', render: (row) => row.name },
              { key: 'units', header: 'Units', render: (row) => row.units },
              {
                key: 'scope',
                header: 'Selection',
                render: (row) =>
                  row.scope ? (
                    <span className="inline-gap">
                      <Pill tone={row.scope.currentVersion > 0 ? 'ok' : 'warn'}>v{row.scope.currentVersion}</Pill>
                      {row.scope.hasDraft ? <Pill tone="warn">draft v{row.scope.draftVersion}</Pill> : null}
                      <AppLink to="/scope">review</AppLink>
                    </span>
                  ) : (
                    <span className="muted">none</span>
                  ),
              },
            ]}
          />
        </Panel>

        <Panel title="Ready for outreach" icon={Mail} hint={selection !== 'all' ? 'Workspace-wide; readiness is not filtered by university.' : undefined}>
          <DataTable
            rows={status.readyCandidates}
            rowKey={(row) => row.personId}
            empty="No profile has reached research_complete yet."
            columns={[
              {
                key: 'name',
                header: 'Person',
                render: (row) => <AppLink to={`/people/${row.personId}`}>{row.name}</AppLink>,
                sortValue: (row) => row.name,
              },
              {
                key: 'ready',
                header: 'Email ready',
                render: (row) => (row.emailReady ? <Pill tone="ok">yes</Pill> : <Pill tone="warn">no</Pill>),
                sortValue: (row) => (row.emailReady ? 1 : 0),
              },
              {
                key: 'blockers',
                header: 'Blockers',
                render: (row) => (row.blockers.length === 0 ? <span className="muted">—</span> : row.blockers.join(' ')),
              },
            ]}
          />
        </Panel>
      </div>

      <div className="split">
        <Panel title="Recent activity" icon={Activity} hint="The newest events across the whole workspace.">
          <ActivityFeed sinceSeq={status.eventSeq} limit={30} />
        </Panel>

        <Panel title="Housekeeping">
          <div className="grid cols-2">
            <Stat value={status.discoveryQueue} label="Undecided discoveries" />
            <Stat value={status.duplicateCandidates} label="Duplicate candidates" to="/connections" />
            <Stat value={status.openNoteIssues} label="Open note issues" to="/settings" />
            <Stat value={status.pendingCommits} label="Incomplete commits" tone={status.pendingCommits ? 'danger' : undefined} />
          </div>
          <p className="small muted">
            Last activity: {status.lastActivity ?? 'none recorded'} · database driver {status.driver}
          </p>
        </Panel>
      </div>
    </>
  );
}
