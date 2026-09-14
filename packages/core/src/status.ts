import type { Workspace } from './workspace.js';
import { JOBS, type JobKind } from './tasks/definitions.js';
import { listTasks, taskCounts } from './tasks/queue.js';
import { sendPlanner } from './outreach/sending.js';
import { currentScopeVersion, getScopeForUniversity, scopeSummary } from './scope/scope.js';
import { evaluateEmailReadiness } from './readiness.js';
import { latestEventSeq } from './util/events.js';
import { openIssues } from './notes/reconcile.js';
import { listDuplicateCandidates } from './registry.js';

export interface JobProgress {
  jobKind: JobKind;
  jobNumber: number;
  label: string;
  counts: Record<string, number>;
  ready: number;
}

export interface WorkspaceStatus {
  driver: string;
  universities: { id: string; name: string; units: number; scope: Record<string, unknown> | null }[];
  jobs: JobProgress[];
  readyCandidates: { personId: string; name: string; emailReady: boolean; blockers: string[] }[];
  blocked: { taskId: string; jobKind: string; targetId: string; reasons: string[] }[];
  outreach: { total: number; byState: Record<string, number>; due: number; overdue: number; sent: number };
  discoveryQueue: number;
  duplicateCandidates: number;
  openNoteIssues: number;
  pendingCommits: number;
  lastActivity: string | null;
  eventSeq: number;
  activeRuns: { taskId: string; jobKind: string; owner: string | null; leaseExpiresAt: string | null; runId: string | null }[];
}

/** One place the CLI, the API and the skills all read progress from. */
export function workspaceStatus(ws: Workspace): WorkspaceStatus {
  const counts = taskCounts(ws);
  const jobs: JobProgress[] = (Object.keys(JOBS) as JobKind[]).map((kind) => ({
    jobKind: kind,
    jobNumber: JOBS[kind].jobNumber,
    label: JOBS[kind].label,
    counts: counts[kind] ?? {},
    ready: listTasks(ws, { jobKind: kind, ready: true }).length,
  }));

  const universities = ws.db
    .all<{ entity_id: string; official_name: string }>('SELECT entity_id, official_name FROM universities')
    .map((row) => {
      const scope = getScopeForUniversity(ws, row.entity_id);
      return {
        id: row.entity_id,
        name: row.official_name,
        units: ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academic_units WHERE university_id = ?', row.entity_id)?.n ?? 0,
        scope: scope ? scopeSummary(ws, scope.id) : null,
      };
    });

  const readyCandidates = ws.db
    .all<{ entity_id: string; full_name: string }>('SELECT entity_id, full_name FROM people WHERE research_complete = 1')
    .map((person) => {
      const readiness = evaluateEmailReadiness(ws, person.entity_id);
      return {
        personId: person.entity_id,
        name: person.full_name,
        emailReady: readiness.emailReady,
        blockers: readiness.issues.filter((issue) => issue.severity === 'blocker').map((issue) => issue.message),
      };
    });

  const blocked = listTasks(ws, { state: 'blocked' }).map((task) => ({
    taskId: task.id,
    jobKind: task.job_kind,
    targetId: task.target_id,
    reasons: task.blockers.map((b) => b.message),
  }));

  const planner = sendPlanner(ws);
  const outreachStates = ws.db.all<{ state: string; n: number }>('SELECT state, COUNT(*) AS n FROM outreach GROUP BY state');
  const byState: Record<string, number> = {};
  for (const row of outreachStates) byState[row.state] = row.n;

  const activeRuns = ws.db.all<{ id: string; job_kind: string; owner_id: string | null; lease_expires_at: string | null; current_run_id: string | null }>(
    "SELECT id, job_kind, owner_id, lease_expires_at, current_run_id FROM tasks WHERE state = 'running'",
  );

  return {
    driver: ws.db.driverName,
    universities,
    jobs,
    readyCandidates,
    blocked,
    outreach: {
      total: Object.values(byState).reduce((a, b) => a + b, 0),
      byState,
      due: planner.filter((row) => row.due === 'due').length,
      overdue: planner.filter((row) => row.due === 'overdue').length,
      sent: ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sent_events')?.n ?? 0,
    },
    discoveryQueue: ws.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM discovery_queue WHERE decision = 'undecided'")?.n ?? 0,
    duplicateCandidates: listDuplicateCandidates(ws).length,
    openNoteIssues: openIssues(ws).length,
    pendingCommits:
      ws.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM artifact_commits WHERE state IN ('prepared','applying')")?.n ?? 0,
    lastActivity: ws.db.get<{ at: string }>('SELECT at FROM event_log ORDER BY seq DESC LIMIT 1')?.at ?? null,
    eventSeq: latestEventSeq(ws.db),
    activeRuns: activeRuns.map((row) => ({
      taskId: row.id,
      jobKind: row.job_kind,
      owner: row.owner_id,
      leaseExpiresAt: row.lease_expires_at,
      runId: row.current_run_id,
    })),
  };
}

export function nextActions(ws: Workspace): string[] {
  const status = workspaceStatus(ws);
  const actions: string[] = [];

  if (status.universities.length === 0) {
    actions.push('Start a university: /research-university "University name"');
    return actions;
  }
  for (const university of status.universities) {
    const scope = university.scope as { currentVersion?: number; hasDraft?: boolean } | null;
    if (scope && (scope.currentVersion ?? 0) === 0) {
      actions.push(`Confirm a department selection for ${university.name} in the interface, or run: npm run research -- scope select --help`);
    } else if (scope?.hasDraft) {
      actions.push(`A draft selection for ${university.name} is waiting to be confirmed.`);
    }
  }
  const readyTasks = status.jobs.filter((job) => job.ready > 0);
  if (readyTasks.length > 0) {
    actions.push(
      `Ready work: ${readyTasks.map((job) => `job ${job.jobNumber} (${job.ready})`).join(', ')}. Run /research-university --resume or the focused skill.`,
    );
  }
  const readyDrafts = status.readyCandidates.filter((c) => c.emailReady);
  if (readyDrafts.length > 0) actions.push(`${readyDrafts.length} candidate(s) are ready for Job 7: /draft-outreach --ready`);
  if (status.outreach.byState['needs_review']) actions.push(`${status.outreach.byState['needs_review']} draft(s) need review: /review-outreach <draft-id>`);
  if (status.outreach.due + status.outreach.overdue > 0) {
    actions.push(`${status.outreach.due + status.outreach.overdue} planned send time(s) have passed. Send manually, then /mark-outreach-sent <draft-id>.`);
  }
  if (status.pendingCommits > 0) actions.push('Incomplete commits were found. Run: npm run research -- reconcile');
  if (status.openNoteIssues > 0) actions.push(`${status.openNoteIssues} note issue(s) need attention: npm run research -- notes issues`);
  if (actions.length === 0) actions.push('No ready work in the queue.');
  return actions;
}

export function scopeStatus(ws: Workspace, universityId: string): Record<string, unknown> | null {
  const scope = getScopeForUniversity(ws, universityId);
  if (!scope) return null;
  const version = currentScopeVersion(ws, scope.id);
  return { ...scopeSummary(ws, scope.id), versionId: version.id, status: version.status };
}
