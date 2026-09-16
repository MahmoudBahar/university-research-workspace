/**
 * Revert a finished job.
 *
 * A revert is itself a commit through the ordinary protocol: it is prepared,
 * durably recorded, locked per target, replayed by `reconcile` after a crash,
 * and audited. Files come back from the content-addressed revision store or
 * are removed; records the task created are deleted; records it merely touched
 * are kept and only this task's contributions are stripped. Sent or approved
 * outreach is never reverted.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Workspace } from '../workspace.js';
import { AppError } from '../util/errors.js';
import { nowIso } from '../util/time.js';
import { emitEvent, recordAudit } from '../util/events.js';
import { fromPosix } from '../util/fsx.js';
import { sha256Bytes } from '../util/hash.js';
import { commitArtifacts, readManifest, revisionStorePathFor, type StagedFile } from '../commit/commit.js';
import type { CommitManifest, DbOp } from '../commit/manifest.js';
import { JOBS, type JobKind } from './definitions.js';
import { getTask, refreshAllTaskStates, type TaskRow } from './queue.js';
import type { TaskState } from './definitions.js';
import { normaliseAnchorValue, type AnchorKind } from '../registry.js';
import { parseNote } from '../notes/frontmatter.js';
import { protectedBlockMap } from '../notes/protected.js';
import { NOTE_SCHEMA_VERSION } from '../schemas/notes.js';
import { refreshPersonReadiness } from '../readiness.js';
import { generateViews } from '../views.js';
import { checkLinks } from '../notes/linkCheck.js';
import { getScopeForUniversity } from '../scope/scope.js';

export interface RevertFileAction {
  path: string;
  action: 'remove' | 'restore';
  /** Hash the file returns to; null when it is removed. */
  restoreSha256: string | null;
  /** Hash the file is expected to carry now (after earlier reverts in the cascade). */
  expectedSha256: string | null;
}

export interface RevertBlocker {
  taskId: string;
  code: string;
  message: string;
}

export interface RevertConflict {
  taskId: string;
  path: string;
  reason: string;
}

export interface RevertTaskPlan {
  taskId: string;
  jobKind: JobKind;
  targetId: string;
  targetTitle: string | null;
  state: TaskState;
  commits: string[];
  windowStart: string;
  windowEnd: string;
  files: RevertFileAction[];
  entitiesDeleted: { id: string; kind: string; title: string }[];
  entitiesKept: { id: string; kind: string; title: string; reason: 'reused' | 'shared' }[];
  aliasesRemoved: { entityId: string; anchorKind: string; anchorValue: string }[];
  relationshipsRemoved: { fromId: string; toId: string; relType: string; role: string }[];
  relationshipsUpdatedNotRestored: { fromId: string; toId: string; relType: string; role: string }[];
  peopleReset: string[];
  personSourcesCleared: string[];
  outreachRemoved: string[];
  tasksDeleted: { id: string; jobKind: string; targetId: string }[];
  dependentsNeedingCascade: { id: string; jobKind: string; targetId: string }[];
  conflicts: RevertConflict[];
  blockers: RevertBlocker[];
  notes: string[];
  runDirs: string[];
  /** Set by a parent whose revert deletes this task's target: the task row goes too. */
  deleteAfter: boolean;
}

export interface RevertPlan {
  taskId: string;
  cascade: boolean;
  force: boolean;
  /** Execution order: dependents first, the requested task last. */
  order: RevertTaskPlan[];
  blockers: RevertBlocker[];
  conflicts: RevertConflict[];
  dependentsNeedingCascade: { id: string; jobKind: string; targetId: string }[];
  /** True when nothing stops `revertTask` from applying this plan. */
  applicable: boolean;
}

export interface RevertReport {
  plan: RevertPlan;
  applied: boolean;
  commits: { taskId: string; commitId: string }[];
  filesRemoved: string[];
  filesRestored: string[];
  entitiesDeleted: string[];
  tasksReset: string[];
  tasksDeleted: string[];
  danglingLinks: number;
  rerun: string | null;
}

/** Jobs that must be reverted before a job for the same target can be. */
const SAME_TARGET_DEPENDENTS: Partial<Record<JobKind, JobKind[]>> = {
  map_person_sources: ['research_person', 'verify_person', 'draft_outreach'],
  research_person: ['verify_person', 'draft_outreach'],
  verify_person: ['draft_outreach'],
};

const KIND_TABLE: Record<string, string> = {
  program: 'programs',
  person: 'people',
  lab: 'labs',
  publication: 'publications',
  unit: 'academic_units',
  university: 'universities',
};

interface PlanContext {
  cascade: boolean;
  force: boolean;
  /** Tasks already in the cascade, so their commits are not "outside" changes. */
  cascadeTasks: Set<string>;
  cascadeCommits: Set<string>;
  /** File hash each path will carry after the plans already ordered ran. */
  projected: Map<string, string | null>;
  /** entity id -> tasks whose committed manifests upsert it. */
  entityOwners: Map<string, Set<string>>;
  anyRunning: boolean;
  order: RevertTaskPlan[];
}

function manifestsFor(ws: Workspace, taskId: string): { id: string; createdAt: string; manifest: CommitManifest }[] {
  const rows = ws.db.all<{ id: string; created_at: string }>(
    "SELECT id, created_at FROM artifact_commits WHERE task_id = ? AND state = 'committed' ORDER BY created_at ASC",
    taskId,
  );
  return rows.map((row) => ({ id: row.id, createdAt: row.created_at, manifest: readManifest(ws, row.id) }));
}

function indexEntityOwners(ws: Workspace): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  const rows = ws.db.all<{ id: string; task_id: string | null }>(
    "SELECT id, task_id FROM artifact_commits WHERE state = 'committed' AND task_id IS NOT NULL",
  );
  for (const row of rows) {
    let manifest: CommitManifest;
    try {
      manifest = readManifest(ws, row.id);
    } catch {
      continue;
    }
    for (const op of manifest.dbOps) {
      if (op.kind !== 'entity.upsert') continue;
      const id = String(op.payload['id'] ?? '');
      if (!id) continue;
      owners.set(id, new Set([...(owners.get(id) ?? []), row.task_id as string]));
    }
  }
  return owners;
}

function diskHash(ws: Workspace, path: string): string | null {
  const abs = join(ws.paths.root, fromPosix(path));
  if (!existsSync(abs)) return null;
  return sha256Bytes(readFileSync(abs));
}

function revisionExists(ws: Workspace, sha: string): boolean {
  return existsSync(revisionStorePathFor(ws, sha));
}

function personAnchorsFromOps(task: TaskRow, ops: DbOp[], entityId: string): { kind: AnchorKind; value: string }[] {
  const out: { kind: AnchorKind; value: string }[] = [];
  for (const op of ops) {
    const p = op.payload;
    if (String(p['entityId'] ?? '') !== entityId) continue;
    const push = (kind: AnchorKind, raw: unknown) => {
      if (typeof raw === 'string' && raw.trim() !== '') out.push({ kind, value: normaliseAnchorValue(kind, raw) });
    };
    switch (op.kind) {
      case 'person.upsert':
        push('profile_url', p['profileUrl']);
        push('orcid', p['orcid']);
        push('email', p['email']);
        push('display_name', p['fullName']);
        if (task.target_kind === 'unit') push('name_in_unit', `${task.target_id}:${String(p['fullName'] ?? '')}`);
        break;
      case 'program.upsert':
        push('name_in_unit', `${String(p['universityId'] ?? '')}:${String(p['officialTitle'] ?? '')}`);
        push('display_name', p['officialTitle']);
        break;
      case 'lab.upsert':
        push('lab_url', p['url']);
        push('display_name', p['officialName']);
        break;
      case 'publication.upsert':
        push('doi', p['doi']);
        push('display_name', p['title']);
        break;
      case 'unit.upsert':
        push('unit_url', p['url']);
        push('name_in_unit', `${String(p['universityId'] ?? '')}:${String(p['officialName'] ?? '')}`);
        push('display_name', p['officialName']);
        break;
      default:
        break;
    }
  }
  return out.filter((a) => a.value !== '');
}

function outreachBlockers(ws: Workspace, taskId: string, personIds: string[]): RevertBlocker[] {
  const blockers: RevertBlocker[] = [];
  for (const personId of personIds) {
    const rows = ws.db.all<{ id: string; state: string; sent: number; approved: number }>(
      `SELECT o.id, o.state,
              (SELECT COUNT(*) FROM sent_events s WHERE s.outreach_id = o.id) AS sent,
              (SELECT COUNT(*) FROM approvals a WHERE a.outreach_id = o.id AND a.invalidated_at IS NULL) AS approved
       FROM outreach o WHERE o.person_id = ?`,
      personId,
    );
    for (const row of rows) {
      if (row.sent > 0 || row.approved > 0 || row.state === 'approved' || row.state === 'sent') {
        blockers.push({
          taskId,
          code: 'outreach_history',
          message: `Outreach ${row.id} for ${personId} is ${row.sent > 0 ? 'recorded as sent' : 'approved'}; sent and approved history is never reverted.`,
        });
      }
    }
  }
  return blockers;
}

function planOne(ws: Workspace, taskId: string, ctx: PlanContext): RevertTaskPlan {
  const task = getTask(ws, taskId);
  const definition = JOBS[task.job_kind];
  const targetTitle = ws.db.get<{ display_title: string }>('SELECT display_title FROM entities WHERE id = ?', task.target_id)?.display_title ?? null;
  const plan: RevertTaskPlan = {
    taskId: task.id,
    jobKind: task.job_kind,
    targetId: task.target_id,
    targetTitle,
    state: task.state,
    commits: [],
    windowStart: task.created_at,
    windowEnd: nowIso(),
    files: [],
    entitiesDeleted: [],
    entitiesKept: [],
    aliasesRemoved: [],
    relationshipsRemoved: [],
    relationshipsUpdatedNotRestored: [],
    peopleReset: [],
    personSourcesCleared: [],
    outreachRemoved: [],
    tasksDeleted: [],
    dependentsNeedingCascade: [],
    conflicts: [],
    blockers: [],
    notes: [],
    runDirs: [],
    deleteAfter: false,
  };
  ctx.cascadeTasks.add(task.id);

  if (task.state === 'running') {
    plan.blockers.push({ taskId: task.id, code: 'running', message: `Task ${task.id} is running (owner ${task.owner_id}); let it finish or reclaim its lease first.` });
    return plan;
  }
  if (task.job_kind === 'discover_university') {
    const scope = getScopeForUniversity(ws, task.target_id);
    if (scope && scope.current_version > 0) {
      plan.blockers.push({
        taskId: task.id,
        code: 'scope_confirmed',
        message: 'Reverting university discovery would delete every unit, and with them the confirmed department selection. Start a new university record instead.',
      });
      return plan;
    }
  }

  let commits: ReturnType<typeof manifestsFor>;
  try {
    commits = manifestsFor(ws, task.id);
  } catch (error) {
    plan.blockers.push({ taskId: task.id, code: 'manifest_missing', message: (error as Error).message });
    return plan;
  }
  plan.commits = commits.map((c) => c.id);
  for (const id of plan.commits) ctx.cascadeCommits.add(id);
  const runs = ws.db.all<{ id: string; run_dir: string; started_at: string }>(
    'SELECT id, run_dir, started_at FROM task_runs WHERE task_id = ? ORDER BY started_at ASC',
    task.id,
  );
  plan.runDirs = runs.map((r) => r.run_dir);
  plan.windowStart = runs[0]?.started_at ?? task.created_at;
  plan.windowEnd = commits.length > 0 ? (commits[commits.length - 1] as { createdAt: string }).createdAt : nowIso();
  const ops = commits.flatMap((c) => c.manifest.dbOps);

  /* ------------------------------------------------------------- entities */
  const touched = new Map<string, { kind: string; created: boolean | undefined }>();
  for (const op of ops) {
    if (op.kind !== 'entity.upsert') continue;
    const id = String(op.payload['id'] ?? '');
    const kind = String(op.payload['kind'] ?? '');
    if (!id || kind === 'source') continue;
    const marker = op.payload['created'];
    const previous = touched.get(id);
    touched.set(id, { kind, created: previous?.created === true || marker === true ? true : marker === undefined ? previous?.created : false });
  }
  const deleted = new Set<string>();
  const kept = new Set<string>();
  for (const [id, info] of touched) {
    const row = ws.db.get<{ kind: string; display_title: string; created_at: string; merged_into: string | null }>(
      'SELECT kind, display_title, created_at, merged_into FROM entities WHERE id = ?',
      id,
    );
    if (!row) continue;
    const inWindow = row.created_at >= plan.windowStart && row.created_at <= plan.windowEnd;
    const createdByTask = info.created === true || inWindow;
    if (!createdByTask) {
      kept.add(id);
      plan.entitiesKept.push({ id, kind: row.kind, title: row.display_title, reason: 'reused' });
      continue;
    }
    const others = [...(ctx.entityOwners.get(id) ?? [])].filter((t) => !ctx.cascadeTasks.has(t));
    if (others.length > 0) {
      kept.add(id);
      plan.entitiesKept.push({ id, kind: row.kind, title: row.display_title, reason: 'shared' });
      plan.notes.push(`${id} was created by this task but is also recorded by ${others.join(', ')}; it is kept.`);
      continue;
    }
    if (row.merged_into) {
      plan.blockers.push({ taskId: task.id, code: 'merged', message: `${id} was merged into ${row.merged_into}; resolve that first.` });
      continue;
    }
    const mergeTarget = ws.db.get<{ id: string }>('SELECT id FROM entities WHERE merged_into = ? LIMIT 1', id);
    if (mergeTarget) {
      plan.blockers.push({ taskId: task.id, code: 'merge_target', message: `${id} is the surviving record of a merge from ${mergeTarget.id}; it cannot be deleted.` });
      continue;
    }
    deleted.add(id);
    plan.entitiesDeleted.push({ id, kind: row.kind, title: row.display_title });
  }

  // Leftovers of an attempt that failed before committing: created in the
  // window, no kind row, referenced by no committed manifest at all.
  if (!ctx.anyRunning && definition.targetKind !== 'university') {
    const kinds = Object.keys(KIND_TABLE);
    const orphans = ws.db.all<{ id: string; kind: string; display_title: string }>(
      `SELECT id, kind, display_title FROM entities
       WHERE created_at >= ? AND created_at <= ? AND merged_into IS NULL AND kind IN (${kinds.map(() => '?').join(',')})`,
      plan.windowStart,
      plan.windowEnd,
      ...kinds,
    );
    for (const orphan of orphans) {
      if (touched.has(orphan.id) || ctx.entityOwners.has(orphan.id)) continue;
      const table = KIND_TABLE[orphan.kind] as string;
      const hasRow = ws.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE entity_id = ?`, orphan.id)?.n ?? 0;
      if (hasRow > 0) continue;
      deleted.add(orphan.id);
      plan.entitiesDeleted.push({ id: orphan.id, kind: orphan.kind, title: orphan.display_title });
      plan.notes.push(`${orphan.id} was left behind by an attempt that never committed; it is removed.`);
    }
  }

  /* ---------------------------------------------- aliases on kept records */
  for (const id of kept) {
    for (const anchor of personAnchorsFromOps(task, ops, id)) {
      const row = ws.db.get<{ created_at: string }>(
        'SELECT created_at FROM entity_aliases WHERE entity_id = ? AND anchor_kind = ? AND anchor_value = ?',
        id,
        anchor.kind,
        anchor.value,
      );
      if (row && row.created_at >= plan.windowStart) {
        plan.aliasesRemoved.push({ entityId: id, anchorKind: anchor.kind, anchorValue: anchor.value });
      }
    }
  }

  /* -------------------------------------------------------- relationships */
  const seenRel = new Set<string>();
  for (const op of ops) {
    if (op.kind !== 'relationship.upsert') continue;
    const rel = {
      fromId: String(op.payload['fromId'] ?? ''),
      toId: String(op.payload['toId'] ?? ''),
      relType: String(op.payload['relType'] ?? ''),
      role: String(op.payload['role'] ?? ''),
    };
    const key = `${rel.fromId}|${rel.toId}|${rel.relType}|${rel.role}`;
    if (seenRel.has(key)) continue;
    seenRel.add(key);
    if (deleted.has(rel.fromId) || deleted.has(rel.toId)) continue; // cascades with the record
    const row = ws.db.get<{ created_at: string }>(
      'SELECT created_at FROM relationships WHERE from_id = ? AND to_id = ? AND rel_type = ? AND role = ?',
      rel.fromId,
      rel.toId,
      rel.relType,
      rel.role,
    );
    if (!row) continue;
    if (row.created_at >= plan.windowStart) plan.relationshipsRemoved.push(rel);
    else plan.relationshipsUpdatedNotRestored.push(rel);
  }
  for (const id of deleted) {
    const inbound = ws.db.all<{ from_id: string; rel_type: string }>(
      'SELECT from_id, rel_type FROM relationships WHERE to_id = ? AND from_id NOT IN (' + [...deleted, "''"].map(() => '?').join(',') + ')',
      id,
      ...deleted,
      '',
    );
    for (const rel of inbound) plan.notes.push(`${rel.from_id} —${rel.rel_type}→ ${id} disappears with the record.`);
  }

  /* ------------------------------------------------- people, sources, drafts */
  const personIdsTouched = [...touched.entries()].filter(([, v]) => v.kind === 'person').map(([id]) => id);
  if ((task.job_kind === 'research_person' || task.job_kind === 'verify_person') && !deleted.has(task.target_id)) {
    // Job 5 and the verifier update the person they target without creating it.
    if (ws.db.get('SELECT entity_id FROM people WHERE entity_id = ?', task.target_id)) plan.peopleReset.push(task.target_id);
  }
  if (definition.targetKind === 'person') {
    plan.personSourcesCleared.push(task.target_id);
  }
  const peopleAffected = [...new Set([...personIdsTouched.filter((id) => deleted.has(id)), ...plan.peopleReset])];
  plan.blockers.push(...outreachBlockers(ws, task.id, peopleAffected));
  for (const op of ops) {
    if (op.kind === 'outreach.upsert') plan.outreachRemoved.push(String(op.payload['id'] ?? ''));
  }
  for (const personId of peopleAffected.filter((id) => deleted.has(id))) {
    for (const row of ws.db.all<{ id: string }>('SELECT id FROM outreach WHERE person_id = ?', personId)) {
      if (!plan.outreachRemoved.includes(row.id)) plan.outreachRemoved.push(row.id);
    }
  }
  for (const outreachId of plan.outreachRemoved) {
    const edited = ws.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM outreach_revisions WHERE outreach_id = ? AND source = 'user'", outreachId)?.n ?? 0;
    if (edited > 0) plan.conflicts.push({ taskId: task.id, path: outreachId, reason: 'draft_edited_by_user' });
  }
  for (const id of kept) {
    const kind = touched.get(id)?.kind;
    if (kind && kind !== 'person') plan.notes.push(`${id} (${kind}) was updated, not created, by this task; its row is kept as it is now.`);
  }

  /* ----------------------------------------------------------- dependents */
  const candidates = new Map<string, TaskRow>();
  const consider = (row: TaskRow | undefined) => {
    if (row && row.id !== task.id && !ctx.cascadeTasks.has(row.id) && !candidates.has(row.id)) candidates.set(row.id, row);
  };
  for (const id of deleted) {
    for (const row of ws.db.all<TaskRow>('SELECT * FROM tasks WHERE target_id = ?', id)) consider(row);
  }
  for (const kind of SAME_TARGET_DEPENDENTS[task.job_kind] ?? []) {
    for (const row of ws.db.all<TaskRow>('SELECT * FROM tasks WHERE target_id = ? AND job_kind = ?', task.target_id, kind)) consider(row);
  }
  for (const op of ops) {
    if (op.kind !== 'task.enqueue') continue;
    const row = ws.db.get<TaskRow>(
      'SELECT * FROM tasks WHERE job_kind = ? AND target_id = ? AND created_at >= ? AND requested_by = ? ORDER BY created_at ASC LIMIT 1',
      String(op.payload['jobKind'] ?? ''),
      String(op.payload['targetId'] ?? ''),
      plan.windowStart,
      String(op.payload['requestedBy'] ?? 'discovery'),
    );
    consider(row);
  }
  for (const dependent of candidates.values()) {
    const summary = { id: dependent.id, jobKind: dependent.job_kind, targetId: dependent.target_id };
    if (dependent.state === 'running') {
      plan.blockers.push({ taskId: task.id, code: 'dependent_running', message: `Dependent task ${dependent.id} (${dependent.job_kind}) is running.` });
      continue;
    }
    const committed = ws.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM artifact_commits WHERE task_id = ? AND state = 'committed'", dependent.id)?.n ?? 0;
    if (committed === 0) {
      plan.tasksDeleted.push(summary);
      continue;
    }
    if (!ctx.cascade) {
      plan.dependentsNeedingCascade.push(summary);
      continue;
    }
    const child = planOne(ws, dependent.id, ctx);
    if (deleted.has(dependent.target_id)) {
      child.deleteAfter = true;
      plan.tasksDeleted.push(summary);
    }
    ctx.order.push(child);
  }

  /* ---------------------------------------------------------------- files */
  // Planned last: dependents reverted earlier in the cascade change what each
  // path is expected to hold, and their commits are not "outside" edits.
  const sharedIds = new Set(plan.entitiesKept.filter((e) => e.reason === 'shared').map((e) => e.id));
  const perPath = new Map<string, { firstPrior: string | null; lastSha: string; firstCommit: string; entityId: string | undefined }>();
  for (const commit of commits) {
    for (const op of commit.manifest.files) {
      const entry = perPath.get(op.path);
      if (!entry) perPath.set(op.path, { firstPrior: op.expectedPriorSha256, lastSha: op.remove ? '' : op.sha256, firstCommit: commit.id, entityId: op.entityId });
      else entry.lastSha = op.remove ? '' : op.sha256;
    }
  }
  for (const [path, entry] of perPath) {
    if (entry.entityId && sharedIds.has(entry.entityId)) {
      // The note belongs to a record another task also recorded; its current
      // content is theirs as much as ours, so it stays.
      plan.notes.push(`${path} is left as it is: ${entry.entityId} is shared with another task.`);
      continue;
    }
    let restoreSha: string | null = entry.firstPrior;
    if (restoreSha === '*') {
      const before = ws.db.get<{ sha256: string }>(
        'SELECT sha256 FROM note_revisions WHERE path = ? AND created_at < (SELECT created_at FROM artifact_commits WHERE id = ?) ORDER BY revision DESC LIMIT 1',
        path,
        entry.firstCommit,
      );
      restoreSha = before?.sha256 ?? null;
    }
    if (restoreSha !== null && !revisionExists(ws, restoreSha)) {
      plan.blockers.push({ taskId: task.id, code: 'revision_missing', message: `Prior bytes for ${path} (${restoreSha.slice(0, 12)}…) are not in the revision store.` });
    }
    const current = ctx.projected.has(path) ? (ctx.projected.get(path) as string | null) : diskHash(ws, path);
    const expectedNow = entry.lastSha === '' ? null : entry.lastSha;
    if (current !== expectedNow && !(current === null && restoreSha === null)) {
      plan.conflicts.push({
        taskId: task.id,
        path,
        reason: current === null ? 'file_missing' : 'changed_since_task',
      });
    }
    const outside = ws.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM note_revisions
       WHERE path = ? AND created_at >= ? AND source != 'revert'
         AND (commit_id IS NULL OR commit_id NOT IN (${plan.commits.length ? plan.commits.map(() => '?').join(',') : "''"}))
         AND (commit_id IS NULL OR commit_id NOT IN (SELECT id FROM artifact_commits WHERE task_id IN (${[...ctx.cascadeTasks].map(() => '?').join(',')})))`,
      path,
      plan.windowStart,
      ...plan.commits,
      ...ctx.cascadeTasks,
    )?.n ?? 0;
    if (outside > 0 && !plan.conflicts.some((c) => c.path === path)) {
      plan.conflicts.push({ taskId: task.id, path, reason: 'edited_outside_task' });
    }
    plan.files.push({
      path,
      action: restoreSha === null ? 'remove' : 'restore',
      restoreSha256: restoreSha,
      expectedSha256: current,
    });
    ctx.projected.set(path, restoreSha);
  }

  return plan;
}

export function planTaskRevert(ws: Workspace, taskId: string, options: { cascade?: boolean; force?: boolean } = {}): RevertPlan {
  const anyRunning = (ws.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE state = 'running'")?.n ?? 0) > 0;
  const ctx: PlanContext = {
    cascade: options.cascade ?? false,
    force: options.force ?? false,
    cascadeTasks: new Set(),
    cascadeCommits: new Set(),
    projected: new Map(),
    entityOwners: indexEntityOwners(ws),
    anyRunning,
    order: [],
  };
  const root = planOne(ws, taskId, ctx);
  ctx.order.push(root);
  const blockers = ctx.order.flatMap((p) => p.blockers);
  const conflicts = ctx.order.flatMap((p) => p.conflicts);
  const dependentsNeedingCascade = ctx.order.flatMap((p) => p.dependentsNeedingCascade);
  return {
    taskId,
    cascade: ctx.cascade,
    force: ctx.force,
    order: ctx.order,
    blockers,
    conflicts,
    dependentsNeedingCascade,
    applicable: blockers.length === 0 && dependentsNeedingCascade.length === 0 && (conflicts.length === 0 || ctx.force),
  };
}

function noteRevisionFromText(path: string, text: string): DbOp {
  let frontmatter: Record<string, unknown> = {};
  let body = text;
  try {
    const parsed = parseNote(text);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
  } catch {
    /* reconcile reports unreadable frontmatter; the bytes are still restored */
  }
  return {
    kind: 'note.revision',
    payload: {
      path,
      entityId: frontmatter['id'] ?? null,
      noteType: frontmatter['type'] ?? null,
      title: frontmatter['title'] ?? null,
      schemaVersion: NOTE_SCHEMA_VERSION,
      sha256: sha256Bytes(Buffer.from(text, 'utf8')),
      size: Buffer.byteLength(text, 'utf8'),
      source: 'revert',
      frontmatter,
      bodyText: body,
      protectedBlocks: protectedBlockMap(body),
      checkedAt: frontmatter['checked_at'] ?? null,
    },
  };
}

function personUpsertFromNote(entityId: string, text: string): DbOp | null {
  try {
    const { frontmatter } = parseNote(text);
    if (String(frontmatter['type'] ?? '') !== 'person' || typeof frontmatter['full_name'] !== 'string') return null;
    const s = (key: string) => (typeof frontmatter[key] === 'string' ? (frontmatter[key] as string) : null);
    return {
      kind: 'person.upsert',
      payload: {
        entityId,
        fullName: frontmatter['full_name'],
        officialTitle: s('official_title'),
        roleCategory: s('role_category') ?? 'unknown',
        profileUrl: s('profile_url'),
        orcid: s('orcid'),
        email: s('email'),
        emailEvidence: s('email_evidence'),
      },
    };
  } catch {
    return null;
  }
}

function buildCommitInputs(ws: Workspace, plan: RevertTaskPlan, force: boolean, fencingToken: number): { files: StagedFile[]; dbOps: DbOp[] } {
  const files: StagedFile[] = [];
  const dbOps: DbOp[] = [];
  const restoredText = new Map<string, string>();

  for (const file of plan.files) {
    const expectedPrior = force ? ('*' as const) : file.expectedSha256;
    if (file.action === 'remove') {
      files.push({ path: file.path, content: '', remove: true, expectedPrior, source: 'revert' });
      dbOps.push({ kind: 'note.forget', payload: { path: file.path } });
    } else {
      const bytes = readFileSync(revisionStorePathFor(ws, file.restoreSha256 as string));
      const text = bytes.toString('utf8');
      restoredText.set(file.path, text);
      files.push({ path: file.path, content: bytes, expectedPrior, source: 'revert' });
      dbOps.push({ kind: 'note.forget', payload: { path: file.path } });
      dbOps.push(noteRevisionFromText(file.path, text));
    }
  }

  for (const outreachId of plan.outreachRemoved) dbOps.push({ kind: 'outreach.delete', payload: { outreachId } });
  for (const rel of plan.relationshipsRemoved) dbOps.push({ kind: 'relationship.delete', payload: { ...rel } });
  for (const alias of plan.aliasesRemoved) dbOps.push({ kind: 'alias.delete', payload: { ...alias } });
  for (const personId of plan.personSourcesCleared) {
    dbOps.push({ kind: 'person_source.delete', payload: { personId, sinceIso: plan.windowStart } });
  }
  for (const personId of plan.peopleReset) {
    dbOps.push({
      kind: 'person.reset',
      payload: { entityId: personId, nullFields: ['email', 'email_evidence', 'contact_rule', 'timezone', 'timezone_basis', 'timezone_observed_at'] },
    });
    const profilePath = `vault/people/${personId}/profile.md`;
    const text = restoredText.get(profilePath);
    const upsert = text ? personUpsertFromNote(personId, text) : null;
    if (upsert) dbOps.push(upsert);
  }
  dbOps.push({ kind: 'discovery.delete', payload: { taskId: plan.taskId } });
  for (const entity of plan.entitiesDeleted) dbOps.push({ kind: 'entity.delete', payload: { entityId: entity.id } });
  for (const t of plan.tasksDeleted) dbOps.push({ kind: 'task.delete', payload: { taskId: t.id } });
  if (!plan.deleteAfter) dbOps.push({ kind: 'task.reset', payload: { taskId: plan.taskId, fencingToken } });
  for (const commitId of plan.commits) {
    dbOps.push({ kind: 'commit.state', payload: { commitId, state: 'reverted', detail: JSON.stringify({ revertedAt: nowIso(), taskId: plan.taskId }) } });
  }
  dbOps.push({
    kind: 'event',
    payload: { kind: 'task:reverted', entityId: plan.targetId, payload: { taskId: plan.taskId, jobKind: plan.jobKind, commits: plan.commits } },
  });
  return { files, dbOps };
}

/** The skill command that re-runs a reverted job for its target. */
export function rerunCommandFor(jobKind: JobKind, targetId: string): string | null {
  const definition = JOBS[jobKind];
  switch (definition.targetKind) {
    case 'unit':
      return `/${definition.skill} --unit ${targetId}`;
    case 'person':
      return `/${definition.skill} ${targetId}`;
    case 'lab':
      return `/${definition.skill} ${targetId}`;
    case 'university':
      return `/${definition.skill} --resume`;
    default:
      return null;
  }
}

export function revertTask(
  ws: Workspace,
  taskId: string,
  options: { cascade?: boolean; force?: boolean; apply?: boolean; actor?: string } = {},
): RevertReport {
  const plan = planTaskRevert(ws, taskId, options);
  const root = plan.order[plan.order.length - 1] as RevertTaskPlan;
  const report: RevertReport = {
    plan,
    applied: false,
    commits: [],
    filesRemoved: [],
    filesRestored: [],
    entitiesDeleted: [],
    tasksReset: [],
    tasksDeleted: [],
    danglingLinks: 0,
    rerun: rerunCommandFor(root.jobKind, root.targetId),
  };
  if (!options.apply || !plan.applicable) return report;

  const keptPeople = new Set<string>();
  for (const step of plan.order) {
    const task = getTask(ws, step.taskId);
    const { files, dbOps } = buildCommitInputs(ws, step, plan.force, task.fencing_token + 1);
    const result = commitArtifacts(ws, {
      lockKey: step.targetId || step.taskId,
      description: `revert ${step.jobKind} for ${step.targetId} (task ${step.taskId})`,
      entityId: step.targetId || null,
      files,
      dbOps,
      owner: options.actor ?? 'revert',
    });
    report.commits.push({ taskId: step.taskId, commitId: result.commitId });
    for (const file of step.files) (file.action === 'remove' ? report.filesRemoved : report.filesRestored).push(file.path);
    report.entitiesDeleted.push(...step.entitiesDeleted.map((e) => e.id));
    report.tasksDeleted.push(...step.tasksDeleted.map((t) => t.id));
    if (!step.deleteAfter) report.tasksReset.push(step.taskId);
    for (const entity of step.entitiesKept) if (entity.kind === 'person') keptPeople.add(entity.id);
    for (const personId of step.peopleReset) keptPeople.add(personId);
    recordAudit(ws.db, options.actor ?? 'user', 'task.revert', step.targetId || null, {
      taskId: step.taskId,
      jobKind: step.jobKind,
      commitId: result.commitId,
      revertedCommits: step.commits,
      filesRemoved: step.files.filter((f) => f.action === 'remove').length,
      filesRestored: step.files.filter((f) => f.action === 'restore').length,
      entitiesDeleted: step.entitiesDeleted.map((e) => e.id),
    });
  }

  for (const personId of keptPeople) {
    if (ws.db.get('SELECT entity_id FROM people WHERE entity_id = ?', personId)) refreshPersonReadiness(ws, personId);
  }
  refreshAllTaskStates(ws);
  generateViews(ws);
  report.danglingLinks = checkLinks(ws).problems.length;
  emitEvent(ws.db, 'revert:applied', root.targetId || null, { taskId: root.taskId, steps: plan.order.length });
  report.applied = true;
  return report;
}

/** Locate the task(s) a `--job/--target` selector names; the newest non-running one wins. */
export function findTaskForRevert(ws: Workspace, jobKind: JobKind, targetId: string): TaskRow {
  const rows = ws.db.all<TaskRow>(
    'SELECT * FROM tasks WHERE job_kind = ? AND target_id = ? ORDER BY created_at DESC',
    jobKind,
    targetId,
  );
  if (rows.length === 0) throw new AppError('not_found', `No ${jobKind} task targets ${targetId}.`, { jobKind, targetId });
  const done = rows.find((row) => row.state !== 'running') ?? rows[0];
  return done as TaskRow;
}
