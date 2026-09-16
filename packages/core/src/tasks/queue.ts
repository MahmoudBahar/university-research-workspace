import type { Workspace } from '../workspace.js';
import { AppError } from '../util/errors.js';
import { opaqueId } from '../util/ids.js';
import { isoPlusSeconds, isPast, nowIso } from '../util/time.js';
import { emitEvent } from '../util/events.js';
import { ensureDir, toPosix } from '../util/fsx.js';
import { join } from 'node:path';
import {
  JOBS,
  TASK_SCHEMA_VERSION,
  TERMINAL_STATES,
  inputFingerprint,
  taskDedupeKey,
  type JobKind,
  type TaskState,
} from './definitions.js';
import { currentScopeVersion, getScopeForUniversity, isPersonInScope, isUnitIncluded } from '../scope/scope.js';
import { evaluateEmailReadiness } from '../readiness.js';
import { commitArtifacts, type StagedFile } from '../commit/commit.js';
import type { DbOp } from '../commit/manifest.js';
import { bind, taskInUniversity } from '../util/universityFilter.js';

export interface TaskRow {
  id: string;
  job_kind: JobKind;
  target_kind: string;
  target_id: string;
  scope_id: string | null;
  scope_version: number | null;
  params_json: string;
  input_fingerprint: string;
  schema_version: number;
  dedupe_key: string;
  state: TaskState;
  priority: number;
  blocked_reason: string | null;
  attempts: number;
  fencing_token: number;
  owner_id: string | null;
  lease_expires_at: string | null;
  current_run_id: string | null;
  next_attempt_at: string | null;
  last_error: string | null;
  progress_json: string | null;
  requested_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface EnqueueInput {
  jobKind: JobKind;
  targetId: string;
  params?: Record<string, unknown>;
  inputRevisions?: Record<string, string | number>;
  priority?: number;
  requestedBy?: string;
  scopeId?: string | null;
  scopeVersion?: number | null;
}

/** Locate the scope that governs a task target, so scope-gated work is versioned. */
export function scopeForTarget(ws: Workspace, targetKind: string, targetId: string): { scopeId: string; version: number } | null {
  let universityId: string | undefined;
  if (targetKind === 'university') {
    universityId = targetId;
  } else if (targetKind === 'unit') {
    universityId = ws.db.get<{ university_id: string }>(
      'SELECT university_id FROM academic_units WHERE entity_id = ?',
      targetId,
    )?.university_id;
  } else if (targetKind === 'person') {
    universityId = ws.db.get<{ university_id: string }>(
      `SELECT au.university_id FROM relationships r
       JOIN academic_units au ON au.entity_id = r.to_id
       WHERE r.from_id = ? AND r.rel_type = 'affiliated_with' LIMIT 1`,
      targetId,
    )?.university_id;
  } else if (targetKind === 'lab') {
    universityId = ws.db.get<{ university_id: string | null }>(
      'SELECT university_id FROM labs WHERE entity_id = ?',
      targetId,
    )?.university_id ?? undefined;
  } else if (targetKind === 'program') {
    universityId = ws.db.get<{ university_id: string }>(
      'SELECT university_id FROM programs WHERE entity_id = ?',
      targetId,
    )?.university_id;
  }
  if (!universityId) return null;
  const scope = getScopeForUniversity(ws, universityId);
  if (!scope) return null;
  return { scopeId: scope.id, version: scope.current_version };
}

export function enqueueTask(ws: Workspace, input: EnqueueInput): { taskId: string; created: boolean; state: TaskState } {
  const definition = JOBS[input.jobKind];
  if (!definition) throw new AppError('invalid_input', `Unknown job kind: ${input.jobKind}`, { jobKind: input.jobKind });

  return ws.db.transaction(() => {
    let scopeId = input.scopeId ?? null;
    let scopeVersion = input.scopeVersion ?? null;
    if (scopeId === null && scopeVersion === null) {
      const resolved = scopeForTarget(ws, definition.targetKind, input.targetId);
      if (resolved) {
        scopeId = resolved.scopeId;
        scopeVersion = resolved.version;
      }
    }

    const identity = {
      jobKind: input.jobKind,
      targetKind: definition.targetKind,
      targetId: input.targetId,
      scopeId,
      scopeVersion,
      params: input.params ?? {},
      inputRevisions: input.inputRevisions ?? {},
      schemaVersion: TASK_SCHEMA_VERSION,
    };
    const dedupeKey = taskDedupeKey(identity);
    const existing = ws.db.get<TaskRow>('SELECT * FROM tasks WHERE dedupe_key = ?', dedupeKey);
    if (existing) {
      // Repeating a request for the same task never produces a second unit of work.
      if (existing.state === 'cancelled' || existing.state === 'failed') {
        ws.db.run("UPDATE tasks SET state = 'pending', blocked_reason = NULL, updated_at = ? WHERE id = ?", nowIso(), existing.id);
        return { taskId: existing.id, created: false, state: 'pending' as TaskState };
      }
      return { taskId: existing.id, created: false, state: existing.state };
    }

    const id = opaqueId('task');
    const now = nowIso();
    ws.db.run(
      `INSERT INTO tasks (id, job_kind, target_kind, target_id, scope_id, scope_version, params_json,
                          input_fingerprint, schema_version, dedupe_key, state, priority, requested_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      id,
      identity.jobKind,
      identity.targetKind,
      identity.targetId,
      scopeId,
      scopeVersion,
      JSON.stringify(identity.params),
      inputFingerprint(identity.inputRevisions),
      TASK_SCHEMA_VERSION,
      dedupeKey,
      input.priority ?? definition.defaultPriority,
      input.requestedBy ?? 'user',
      now,
      now,
    );
    const state = refreshTaskState(ws, id);
    emitEvent(ws.db, 'task:enqueued', input.targetId, { taskId: id, jobKind: input.jobKind, state });
    return { taskId: id, created: true, state };
  });
}

export interface Blocker {
  code: string;
  message: string;
}

/**
 * Prerequisites are evaluated per record. An unfinished university-wide job
 * never blocks a candidate whose own inputs are ready.
 */
export function computeBlockers(ws: Workspace, task: TaskRow): Blocker[] {
  const blockers: Blocker[] = [];
  const definition = JOBS[task.job_kind];

  if (definition.scopeGated) {
    if (!task.scope_id) {
      blockers.push({ code: 'scope_missing', message: 'No confirmed department selection governs this target yet.' });
    } else {
      const version = currentScopeVersion(ws, task.scope_id);
      if (version.version === 0) {
        blockers.push({ code: 'scope_unconfirmed', message: 'Confirm a department selection before scoped research runs.' });
      } else if (task.scope_version !== null && task.scope_version !== version.version) {
        blockers.push({
          code: 'scope_superseded',
          message: `This task targets scope version ${task.scope_version}; the confirmed version is ${version.version}.`,
        });
      } else if (task.target_kind === 'unit' && !isUnitIncluded(ws, version.id, task.target_id)) {
        blockers.push({ code: 'unit_excluded', message: 'The target unit is not included in the confirmed selection.' });
      } else if (task.target_kind === 'person' && !isPersonInScope(ws, version.id, task.target_id)) {
        blockers.push({ code: 'person_out_of_scope', message: 'This person has no affiliation inside the confirmed selection.' });
      }
    }
  }

  switch (task.job_kind) {
    case 'map_person_sources': {
      const affiliations = ws.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM relationships WHERE from_id = ? AND rel_type = 'affiliated_with'",
        task.target_id,
      );
      if ((affiliations?.n ?? 0) === 0) {
        blockers.push({
          code: 'person_identity_incomplete',
          message: 'This person has no recorded affiliation. Run /discover-people for the relevant unit, or supply the affiliation directly.',
        });
      }
      break;
    }
    case 'research_person': {
      const mapped = ws.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM tasks WHERE job_kind = 'map_person_sources' AND target_id = ? AND state = 'complete'",
        task.target_id,
      );
      if ((mapped?.n ?? 0) === 0) {
        const sources = ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM person_sources WHERE person_id = ?', task.target_id);
        if ((sources?.n ?? 0) === 0) {
          blockers.push({
            code: 'source_map_missing',
            message: '/map-person has not produced a source map for this person yet.',
          });
        }
      }
      break;
    }
    case 'verify_person': {
      const researched = ws.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM tasks WHERE job_kind = 'research_person' AND target_id = ? AND state IN ('complete','partial')",
        task.target_id,
      );
      if ((researched?.n ?? 0) === 0) {
        blockers.push({ code: 'research_missing', message: 'There is nothing to verify until /research-person has produced material.' });
      }
      break;
    }
    case 'draft_outreach': {
      const params = JSON.parse(task.params_json) as { programId?: string | null };
      const readiness = evaluateEmailReadiness(ws, task.target_id, { programId: params.programId ?? null });
      for (const issue of readiness.issues) {
        if (issue.severity === 'blocker') blockers.push({ code: issue.code, message: issue.message });
      }
      break;
    }
    case 'research_lab': {
      const lab = ws.db.get<{ entity_id: string }>('SELECT entity_id FROM labs WHERE entity_id = ?', task.target_id);
      if (!lab) {
        blockers.push({ code: 'lab_unknown', message: 'No lab record exists for this target. Supply a lab URL to create one.' });
      }
      break;
    }
    default:
      break;
  }

  if (task.next_attempt_at && !isPast(task.next_attempt_at)) {
    blockers.push({ code: 'cooldown', message: `Retry cooldown until ${task.next_attempt_at}.` });
  }
  return blockers;
}

export function getTask(ws: Workspace, taskId: string): TaskRow {
  const row = ws.db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!row) throw new AppError('not_found', `Unknown task: ${taskId}`, { taskId });
  return row;
}

/** Recompute pending/blocked for one task from its live prerequisites. */
export function refreshTaskState(ws: Workspace, taskId: string): TaskState {
  const task = getTask(ws, taskId);
  if (['running', 'complete', 'cancelled', 'failed'].includes(task.state)) return task.state;
  const blockers = computeBlockers(ws, task);
  const state: TaskState = blockers.length > 0 ? 'blocked' : task.state === 'blocked' ? 'pending' : task.state;
  const reason = blockers.length > 0 ? blockers.map((b) => b.message).join(' ') : null;
  ws.db.run('UPDATE tasks SET state = ?, blocked_reason = ?, updated_at = ? WHERE id = ?', state, reason, nowIso(), taskId);
  return state;
}

export function refreshAllTaskStates(ws: Workspace): { updated: number } {
  const rows = ws.db.all<{ id: string }>(
    "SELECT id FROM tasks WHERE state IN ('pending','blocked','partial','retryable_failed','stale')",
  );
  for (const row of rows) refreshTaskState(ws, row.id);
  return { updated: rows.length };
}

const READY_STATES: TaskState[] = ['pending', 'partial', 'retryable_failed'];

export interface TaskFilter {
  jobKind?: JobKind;
  jobNumber?: number;
  state?: TaskState;
  targetId?: string;
  ready?: boolean;
  limit?: number;
  /** Restrict to tasks governed by this university's scope, or targeting it directly. */
  universityId?: string;
}

export function listTasks(ws: Workspace, filter: TaskFilter = {}): (TaskRow & { blockers: Blocker[]; target_title: string | null })[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.jobKind) {
    clauses.push('t.job_kind = ?');
    params.push(filter.jobKind);
  }
  if (filter.state) {
    clauses.push('t.state = ?');
    params.push(filter.state);
  }
  if (filter.targetId) {
    clauses.push('t.target_id = ?');
    params.push(filter.targetId);
  }
  if (filter.universityId) {
    const fragment = taskInUniversity('t');
    clauses.push(fragment.sql);
    params.push(...bind(fragment, filter.universityId));
  }
  if (filter.ready) {
    clauses.push(`t.state IN (${READY_STATES.map(() => '?').join(', ')})`);
    params.push(...READY_STATES);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const query = `SELECT t.*, e.display_title AS target_title FROM tasks t
     LEFT JOIN entities e ON e.id = t.target_id
     ${where}
     ORDER BY t.priority ASC, t.created_at ASC`;
  if (filter.ready) {
    // Blockers are computed per row, so readiness is decided before any limit.
    // Limiting first would count only the ready tasks among the first N rows.
    const ready = ws.db
      .all<TaskRow & { target_title: string | null }>(query, ...params)
      .map((row) => ({ ...row, blockers: computeBlockers(ws, row) }))
      .filter((row) => row.blockers.length === 0);
    return filter.limit === undefined ? ready : ready.slice(0, filter.limit);
  }
  const rows = ws.db.all<TaskRow & { target_title: string | null }>(`${query}\n     LIMIT ?`, ...params, filter.limit ?? 200);
  return rows.map((row) => ({ ...row, blockers: computeBlockers(ws, row) }));
}

export interface ClaimInput {
  owner: string;
  taskId?: string;
  jobKind?: JobKind;
  targetId?: string;
  leaseSeconds?: number;
  /** Ignore concurrency limits; used by single-task CLI invocations. */
  force?: boolean;
}

export interface ClaimedTask {
  task: TaskRow;
  runId: string;
  fencingToken: number;
  runDir: string;
  leaseExpiresAt: string;
}

function runningCounts(ws: Workspace): { total: number; personTargets: Set<string> } {
  const rows = ws.db.all<{ target_kind: string; target_id: string }>(
    "SELECT target_kind, target_id FROM tasks WHERE state = 'running'",
  );
  return {
    total: rows.length,
    personTargets: new Set(rows.filter((r) => r.target_kind === 'person').map((r) => r.target_id)),
  };
}

/**
 * Claim in a short transaction: bump the fencing token, take a renewable lease,
 * and create the run directory the worker may write to.
 */
export function claimTask(ws: Workspace, input: ClaimInput): ClaimedTask | null {
  const leaseSeconds = input.leaseSeconds ?? ws.config.leases.defaultSeconds;
  const claimed = ws.db.transaction(() => {
    reclaimExpiredLeasesInternal(ws);

    let candidate: TaskRow | undefined;
    if (input.taskId) {
      candidate = getTask(ws, input.taskId);
      if (candidate.state === 'running') {
        throw new AppError('conflict', `Task ${input.taskId} is already running (owner ${candidate.owner_id})`, {
          taskId: input.taskId,
        });
      }
      if (TERMINAL_STATES.includes(candidate.state)) {
        throw new AppError('state_violation', `Task ${input.taskId} is ${candidate.state}`, { taskId: input.taskId });
      }
      const blockers = computeBlockers(ws, candidate);
      if (blockers.length > 0) {
        throw new AppError('dependency_blocked', blockers.map((b) => b.message).join(' '), { blockers });
      }
    } else {
      // Candidates are examined a page at a time; the scan stops at the first
      // unblocked task instead of loading and evaluating the whole queue.
      const filters = [input.jobKind, input.targetId].filter((v): v is string => typeof v === 'string');
      const pageSize = 50;
      for (let offset = 0; candidate === undefined; offset += pageSize) {
        const rows = ws.db.all<TaskRow>(
          `SELECT * FROM tasks
           WHERE state IN ('pending','partial','retryable_failed')
             ${input.jobKind ? 'AND job_kind = ?' : ''}
             ${input.targetId ? 'AND target_id = ?' : ''}
           ORDER BY priority ASC, created_at ASC
           LIMIT ? OFFSET ?`,
          ...filters,
          pageSize,
          offset,
        );
        candidate = rows.find((row) => computeBlockers(ws, row).length === 0);
        if (rows.length < pageSize) break;
      }
    }
    if (!candidate) return null;

    if (!input.force) {
      const counts = runningCounts(ws);
      if (counts.total >= ws.config.concurrency.totalWorkers) return null;
      if (
        candidate.target_kind === 'person' &&
        !counts.personTargets.has(candidate.target_id) &&
        counts.personTargets.size >= ws.config.concurrency.candidates
      ) {
        return null;
      }
    }

    const fencingToken = candidate.fencing_token + 1;
    const runId = opaqueId('run');
    const runDir = toPosix(join('data', 'runs', runId));
    const leaseExpiresAt = isoPlusSeconds(leaseSeconds);
    const now = nowIso();

    ws.db.run(
      `UPDATE tasks SET state = 'running', owner_id = ?, lease_expires_at = ?, fencing_token = ?, current_run_id = ?,
              attempts = attempts + 1, blocked_reason = NULL, next_attempt_at = NULL, updated_at = ?
       WHERE id = ?`,
      input.owner,
      leaseExpiresAt,
      fencingToken,
      runId,
      now,
      candidate.id,
    );
    ws.db.run(
      `INSERT INTO task_runs (id, task_id, owner_id, fencing_token, run_dir, state, lease_expires_at, started_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`,
      runId,
      candidate.id,
      input.owner,
      fencingToken,
      runDir,
      leaseExpiresAt,
      now,
    );
    emitEvent(ws.db, 'task:claimed', candidate.target_id, { taskId: candidate.id, runId, owner: input.owner });
    return {
      task: getTask(ws, candidate.id),
      runId,
      fencingToken,
      runDir,
      leaseExpiresAt,
    };
  });

  if (claimed) {
    ensureDir(join(ws.paths.root, 'data', 'runs', claimed.runId));
    ensureDir(join(ws.paths.root, 'data', 'runs', claimed.runId, 'checkpoints'));
    ensureDir(join(ws.paths.root, 'data', 'runs', claimed.runId, 'staged'));
  }
  return claimed;
}

function reclaimExpiredLeasesInternal(ws: Workspace): number {
  const expired = ws.db.all<{ id: string; current_run_id: string | null }>(
    "SELECT id, current_run_id FROM tasks WHERE state = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?",
    nowIso(),
  );
  for (const row of expired) {
    ws.db.run(
      `UPDATE tasks SET state = 'partial', owner_id = NULL, lease_expires_at = NULL,
              blocked_reason = 'Lease expired; work may resume from the last checkpoint.', updated_at = ?
       WHERE id = ?`,
      nowIso(),
      row.id,
    );
    if (row.current_run_id) {
      ws.db.run("UPDATE task_runs SET state = 'lease_expired', ended_at = ? WHERE id = ?", nowIso(), row.current_run_id);
    }
    emitEvent(ws.db, 'task:lease_expired', null, { taskId: row.id });
  }
  return expired.length;
}

export function reclaimExpiredLeases(ws: Workspace): { reclaimed: number } {
  return ws.db.transaction(() => ({ reclaimed: reclaimExpiredLeasesInternal(ws) }));
}

/**
 * Extend a running task's lease. Renewals are counted per run and capped by
 * `leases.maxRenewals`, so a worker that never finishes cannot hold a task
 * forever; past the cap the task must checkpoint and be re-claimed.
 */
export function renewLease(
  ws: Workspace,
  taskId: string,
  owner: string,
  fencingToken: number,
  seconds?: number,
): { leaseExpiresAt: string; renewals: number; maxRenewals: number } {
  return ws.db.transaction(() => {
    const task = getTask(ws, taskId);
    assertOwnership(task, owner, fencingToken);
    if (task.state !== 'running' || !task.current_run_id) {
      throw new AppError('state_violation', `Task ${taskId} is ${task.state}; only a running task holds a lease.`, { taskId });
    }
    const run = ws.db.get<{ renewals: number }>('SELECT renewals FROM task_runs WHERE id = ?', task.current_run_id);
    const renewals = run?.renewals ?? 0;
    const maxRenewals = ws.config.leases.maxRenewals;
    if (renewals >= maxRenewals) {
      throw new AppError(
        'state_violation',
        `Lease for ${taskId} has been renewed ${renewals} times, the configured maximum (leases.maxRenewals). Checkpoint, let the lease expire and re-claim the task.`,
        { taskId, renewals, maxRenewals },
      );
    }
    const leaseExpiresAt = isoPlusSeconds(seconds ?? ws.config.leases.defaultSeconds);
    ws.db.run('UPDATE tasks SET lease_expires_at = ?, updated_at = ? WHERE id = ?', leaseExpiresAt, nowIso(), taskId);
    ws.db.run('UPDATE task_runs SET lease_expires_at = ?, renewals = renewals + 1 WHERE id = ?', leaseExpiresAt, task.current_run_id);
    emitEvent(ws.db, 'task:lease_renewed', task.target_id, { taskId, renewals: renewals + 1, leaseExpiresAt });
    return { leaseExpiresAt, renewals: renewals + 1, maxRenewals };
  });
}

function assertOwnership(task: TaskRow, owner: string, fencingToken: number): void {
  if (task.fencing_token !== fencingToken) {
    throw new AppError(
      'fencing_rejected',
      `Task ${task.id} now carries fencing token ${task.fencing_token}; this owner holds ${fencingToken}.`,
      { taskId: task.id, currentToken: task.fencing_token, presentedToken: fencingToken },
    );
  }
  if (task.owner_id !== null && task.owner_id !== owner) {
    throw new AppError('fencing_rejected', `Task ${task.id} is owned by ${task.owner_id}, not ${owner}.`, {
      taskId: task.id,
      owner: task.owner_id,
    });
  }
}

export interface CheckpointInput {
  taskId: string;
  owner: string;
  fencingToken: number;
  kind: string;
  label?: string;
  payload?: Record<string, unknown>;
}

/** Checkpoints live in the claiming run's own directory and survive a crash. */
export function saveCheckpoint(ws: Workspace, input: CheckpointInput): { checkpointId: string; seq: number } {
  return ws.db.transaction(() => {
    const task = getTask(ws, input.taskId);
    assertOwnership(task, input.owner, input.fencingToken);
    if (!task.current_run_id) throw new AppError('state_violation', 'Task has no active run', { taskId: task.id });
    const seq =
      (ws.db.get<{ v: number }>('SELECT COALESCE(MAX(seq), 0) AS v FROM checkpoints WHERE run_id = ?', task.current_run_id)?.v ?? 0) + 1;
    const id = opaqueId('ckpt');
    ws.db.run(
      'INSERT INTO checkpoints (id, run_id, task_id, seq, kind, label, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      task.current_run_id,
      task.id,
      seq,
      input.kind,
      input.label ?? null,
      JSON.stringify(input.payload ?? {}),
      nowIso(),
    );
    ws.db.run(
      'UPDATE tasks SET progress_json = ?, updated_at = ? WHERE id = ?',
      JSON.stringify({ lastCheckpoint: input.kind, label: input.label ?? null, seq, at: nowIso() }),
      nowIso(),
      task.id,
    );
    emitEvent(ws.db, 'task:checkpoint', task.target_id, { taskId: task.id, seq, kind: input.kind });
    return { checkpointId: id, seq };
  });
}

export function listCheckpoints(ws: Workspace, taskId: string): Record<string, unknown>[] {
  return ws.db.all(
    `SELECT c.* FROM checkpoints c JOIN task_runs r ON r.id = c.run_id
     WHERE c.task_id = ? ORDER BY r.started_at ASC, c.seq ASC`,
    taskId,
  );
}

export interface CompleteInput {
  taskId: string;
  owner: string;
  fencingToken: number;
  state?: 'complete' | 'partial';
  files?: StagedFile[];
  dbOps?: DbOp[];
  progress?: Record<string, unknown>;
  description?: string;
}

/**
 * Completion installs the validated artifacts and flips task state inside one
 * recoverable commit, so a crash cannot leave a task complete without its files.
 */
export function completeTask(ws: Workspace, input: CompleteInput): { commitId: string; installed: string[] } {
  const task = getTask(ws, input.taskId);
  assertOwnership(task, input.owner, input.fencingToken);
  const state = input.state ?? 'complete';

  const dbOps: DbOp[] = [
    ...(input.dbOps ?? []),
    {
      kind: 'task.state',
      payload: { taskId: task.id, state, progress: input.progress ?? null },
    },
    { kind: 'event', payload: { kind: `task:${state}`, entityId: task.target_id, payload: { taskId: task.id } } },
  ];

  const result = commitArtifacts(ws, {
    lockKey: task.target_id || task.id,
    description: input.description ?? `${task.job_kind} -> ${state} for ${task.target_id}`,
    entityId: task.target_id || null,
    taskId: task.id,
    runId: task.current_run_id,
    fencingToken: task.fencing_token,
    scopeId: task.scope_id,
    scopeVersion: task.scope_version,
    files: input.files ?? [],
    dbOps,
    owner: input.owner,
  });

  ws.db.run("UPDATE task_runs SET state = ?, ended_at = ? WHERE id = ?", state === 'complete' ? 'complete' : 'partial', nowIso(), task.current_run_id ?? '');
  return { commitId: result.commitId, installed: result.installed };
}

export interface FailInput {
  taskId: string;
  owner: string;
  fencingToken: number;
  error: string;
  /** Transient categories get a saved cooldown; others fail outright. */
  category?: 'transient' | 'rate_limited' | 'access_denied' | 'unavailable_evidence' | 'invalid_input' | 'conflict';
  retryAfterSeconds?: number;
}

export function failTask(ws: Workspace, input: FailInput): { state: TaskState; nextAttemptAt: string | null } {
  return ws.db.transaction(() => {
    const task = getTask(ws, input.taskId);
    assertOwnership(task, input.owner, input.fencingToken);
    const category = input.category ?? 'transient';
    const retryable = category === 'transient' || category === 'rate_limited';
    let nextAttemptAt: string | null = null;
    let state: TaskState = 'failed';

    if (retryable && task.attempts < ws.config.retry.maxAttempts) {
      state = 'retryable_failed';
      const base = ws.config.retry.baseDelayMs * 2 ** Math.max(0, task.attempts - 1);
      const jitter = base * ws.config.retry.jitterRatio * Math.random();
      // The cap is applied after jitter, so maxDelayMs is a real ceiling.
      const capped = Math.min(base + jitter, ws.config.retry.maxDelayMs);
      const delayMs = input.retryAfterSeconds != null ? input.retryAfterSeconds * 1000 : capped;
      nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    }

    ws.db.run(
      `UPDATE tasks SET state = ?, owner_id = NULL, lease_expires_at = NULL, last_error = ?,
              next_attempt_at = ?, blocked_reason = ?, updated_at = ?
       WHERE id = ?`,
      state,
      JSON.stringify({ category, error: input.error, at: nowIso() }),
      nextAttemptAt,
      nextAttemptAt ? `Retry scheduled for ${nextAttemptAt}` : null,
      nowIso(),
      task.id,
    );
    if (task.current_run_id) {
      ws.db.run("UPDATE task_runs SET state = 'failed', ended_at = ?, error_json = ? WHERE id = ?", nowIso(), JSON.stringify({ category, error: input.error }), task.current_run_id);
    }
    emitEvent(ws.db, 'task:failed', task.target_id, { taskId: task.id, category, state });
    return { state, nextAttemptAt };
  });
}

export function cancelTask(ws: Workspace, taskId: string, reason: string): void {
  ws.db.run(
    "UPDATE tasks SET state = 'cancelled', blocked_reason = ?, completed_at = ?, owner_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
    reason,
    nowIso(),
    nowIso(),
    taskId,
  );
  emitEvent(ws.db, 'task:cancelled', null, { taskId, reason });
}

export function retryTask(ws: Workspace, taskId: string): TaskState {
  const task = getTask(ws, taskId);
  if (task.state === 'running') throw new AppError('conflict', 'Task is currently running', { taskId });
  ws.db.run(
    "UPDATE tasks SET state = 'pending', next_attempt_at = NULL, blocked_reason = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
    nowIso(),
    taskId,
  );
  return refreshTaskState(ws, taskId);
}

export function taskCounts(ws: Workspace): Record<string, Record<string, number>> {
  const rows = ws.db.all<{ job_kind: string; state: string; n: number }>(
    'SELECT job_kind, state, COUNT(*) AS n FROM tasks GROUP BY job_kind, state',
  );
  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    out[row.job_kind] ??= {};
    (out[row.job_kind] as Record<string, number>)[row.state] = row.n;
  }
  return out;
}
