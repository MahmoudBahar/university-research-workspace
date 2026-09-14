import type { Workspace } from '../workspace.js';
import { AppError } from '../util/errors.js';
import { opaqueId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { emitEvent, recordAudit } from '../util/events.js';
import { inputFingerprint, taskDedupeKey, TASK_SCHEMA_VERSION, type JobKind } from '../tasks/definitions.js';

export type ScopeDecision = 'included' | 'excluded' | 'undecided';

export interface ScopeRow {
  id: string;
  university_id: string;
  current_version: number;
  created_at: string;
}

export interface ScopeVersionRow {
  id: string;
  scope_id: string;
  version: number;
  status: 'draft' | 'confirmed' | 'superseded';
  note: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export function ensureScope(ws: Workspace, universityId: string): ScopeRow {
  return ws.db.transaction(() => {
    const existing = ws.db.get<ScopeRow>('SELECT * FROM scopes WHERE university_id = ?', universityId);
    if (existing) return existing;
    const id = `scope-${universityId}`;
    const now = nowIso();
    ws.db.run('INSERT INTO scopes (id, university_id, current_version, created_at) VALUES (?, ?, 0, ?)', id, universityId, now);
    const versionId = opaqueId('scopever');
    ws.db.run(
      `INSERT INTO scope_versions (id, scope_id, version, status, note, created_at, confirmed_at)
       VALUES (?, ?, 0, 'confirmed', 'Initial empty scope', ?, ?)`,
      versionId,
      id,
      now,
      now,
    );
    return ws.db.get<ScopeRow>('SELECT * FROM scopes WHERE id = ?', id) as ScopeRow;
  });
}

export function getScope(ws: Workspace, scopeId: string): ScopeRow {
  const row = ws.db.get<ScopeRow>('SELECT * FROM scopes WHERE id = ?', scopeId);
  if (!row) throw new AppError('not_found', `Unknown scope: ${scopeId}`, { scopeId });
  return row;
}

export function getScopeForUniversity(ws: Workspace, universityId: string): ScopeRow | undefined {
  return ws.db.get<ScopeRow>('SELECT * FROM scopes WHERE university_id = ?', universityId);
}

export function getScopeVersion(ws: Workspace, scopeId: string, version: number): ScopeVersionRow {
  const row = ws.db.get<ScopeVersionRow>('SELECT * FROM scope_versions WHERE scope_id = ? AND version = ?', scopeId, version);
  if (!row) throw new AppError('not_found', `Scope ${scopeId} has no version ${version}`, { scopeId, version });
  return row;
}

export function currentScopeVersion(ws: Workspace, scopeId: string): ScopeVersionRow {
  const scope = getScope(ws, scopeId);
  return getScopeVersion(ws, scopeId, scope.current_version);
}

function draftVersion(ws: Workspace, scopeId: string): ScopeVersionRow | undefined {
  const scope = getScope(ws, scopeId);
  return ws.db.get<ScopeVersionRow>(
    "SELECT * FROM scope_versions WHERE scope_id = ? AND version = ? AND status = 'draft'",
    scopeId,
    scope.current_version + 1,
  );
}

/** Create or reuse the draft version that edits are written into. */
function ensureDraftVersion(ws: Workspace, scopeId: string, expectedVersion: number): ScopeVersionRow {
  const scope = getScope(ws, scopeId);
  if (scope.current_version !== expectedVersion) {
    throw new AppError('revision_conflict', `Scope is at version ${scope.current_version}, not ${expectedVersion}`, {
      scopeId,
      currentVersion: scope.current_version,
      expectedVersion,
    });
  }
  const existing = draftVersion(ws, scopeId);
  if (existing) return existing;
  const id = opaqueId('scopever');
  const version = scope.current_version + 1;
  ws.db.run(
    `INSERT INTO scope_versions (id, scope_id, version, status, created_at) VALUES (?, ?, ?, 'draft', ?)`,
    id,
    scopeId,
    version,
    nowIso(),
  );
  // Carry forward the decisions already made so an edit is a delta, not a reset.
  const current = getScopeVersion(ws, scopeId, scope.current_version);
  const rows = ws.db.all<{ unit_id: string; decision: string; explicit: number }>(
    'SELECT unit_id, decision, explicit FROM scope_units WHERE scope_version_id = ?',
    current.id,
  );
  for (const row of rows) {
    ws.db.run(
      'INSERT INTO scope_units (scope_version_id, unit_id, decision, explicit, decided_at) VALUES (?, ?, ?, ?, ?)',
      id,
      row.unit_id,
      row.decision,
      row.explicit,
      nowIso(),
    );
  }
  const exceptions = ws.db.all<{ person_id: string; decision: string; reason: string | null }>(
    'SELECT person_id, decision, reason FROM scope_person_exceptions WHERE scope_version_id = ?',
    current.id,
  );
  for (const row of exceptions) {
    ws.db.run(
      'INSERT INTO scope_person_exceptions (scope_version_id, person_id, decision, reason, decided_at) VALUES (?, ?, ?, ?, ?)',
      id,
      row.person_id,
      row.decision,
      row.reason,
      nowIso(),
    );
  }
  return ws.db.get<ScopeVersionRow>('SELECT * FROM scope_versions WHERE id = ?', id) as ScopeVersionRow;
}

export interface SelectionInput {
  scopeId: string;
  expectedVersion: number;
  decisions: { unitId: string; decision: ScopeDecision }[];
  personExceptions?: { personId: string; decision: 'included' | 'excluded'; reason?: string }[];
  note?: string;
}

export function updateSelection(ws: Workspace, input: SelectionInput): ScopeVersionRow {
  return ws.db.transaction(() => {
    const draft = ensureDraftVersion(ws, input.scopeId, input.expectedVersion);
    for (const decision of input.decisions) {
      if (decision.decision === 'undecided') {
        ws.db.run('DELETE FROM scope_units WHERE scope_version_id = ? AND unit_id = ?', draft.id, decision.unitId);
        continue;
      }
      ws.db.run(
        `INSERT INTO scope_units (scope_version_id, unit_id, decision, explicit, decided_at) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(scope_version_id, unit_id) DO UPDATE SET decision = excluded.decision, explicit = 1, decided_at = excluded.decided_at`,
        draft.id,
        decision.unitId,
        decision.decision,
        nowIso(),
      );
    }
    for (const exception of input.personExceptions ?? []) {
      ws.db.run(
        `INSERT INTO scope_person_exceptions (scope_version_id, person_id, decision, reason, decided_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(scope_version_id, person_id) DO UPDATE SET decision = excluded.decision, reason = excluded.reason, decided_at = excluded.decided_at`,
        draft.id,
        exception.personId,
        exception.decision,
        exception.reason ?? null,
        nowIso(),
      );
    }
    if (input.note !== undefined) {
      ws.db.run('UPDATE scope_versions SET note = ? WHERE id = ?', input.note, draft.id);
    }
    emitEvent(ws.db, 'scope:draft_updated', input.scopeId, { version: draft.version });
    return ws.db.get<ScopeVersionRow>('SELECT * FROM scope_versions WHERE id = ?', draft.id) as ScopeVersionRow;
  });
}

export interface ScopeChangeReport {
  scopeId: string;
  newVersion: number;
  cancelledTasks: number;
  requeuedTasks: number;
  staleRunningTasks: number;
}

/**
 * Promote the draft to the confirmed selection.
 *
 * Historical notes are never touched. Queued work that referenced the previous
 * version is cancelled, and any target still in scope is re-enqueued against the
 * new version so task identity keeps including the scope version it ran under.
 */
export function confirmSelection(ws: Workspace, scopeId: string, expectedVersion: number, actor = 'user'): ScopeChangeReport {
  return ws.db.transaction(() => {
    const scope = getScope(ws, scopeId);
    if (scope.current_version !== expectedVersion) {
      throw new AppError('revision_conflict', `Scope is at version ${scope.current_version}, not ${expectedVersion}`, {
        currentVersion: scope.current_version,
        expectedVersion,
      });
    }
    const draft = draftVersion(ws, scopeId);
    if (!draft) throw new AppError('state_violation', 'There is no draft selection to confirm', { scopeId });

    ws.db.run("UPDATE scope_versions SET status = 'superseded' WHERE scope_id = ? AND version = ?", scopeId, scope.current_version);
    ws.db.run("UPDATE scope_versions SET status = 'confirmed', confirmed_at = ? WHERE id = ?", nowIso(), draft.id);
    ws.db.run('UPDATE scopes SET current_version = ? WHERE id = ?', draft.version, scopeId);

    const report = applyScopeChangeToTasks(ws, scopeId, draft.version);
    recordAudit(ws.db, actor, 'scope.confirm', scopeId, { version: draft.version, ...report });
    emitEvent(ws.db, 'scope:confirmed', scopeId, { version: draft.version });
    return { scopeId, newVersion: draft.version, ...report };
  });
}

function applyScopeChangeToTasks(
  ws: Workspace,
  scopeId: string,
  newVersion: number,
): { cancelledTasks: number; requeuedTasks: number; staleRunningTasks: number } {
  const outdated = ws.db.all<{
    id: string;
    job_kind: string;
    target_kind: string;
    target_id: string;
    params_json: string;
    state: string;
    priority: number;
  }>(
    `SELECT id, job_kind, target_kind, target_id, params_json, state, priority
     FROM tasks WHERE scope_id = ? AND scope_version IS NOT NULL AND scope_version < ?
       AND state IN ('pending','blocked','retryable_failed','partial','running')`,
    scopeId,
    newVersion,
  );

  let cancelled = 0;
  let requeued = 0;
  let staleRunning = 0;
  const versionId = getScopeVersion(ws, scopeId, newVersion).id;

  for (const task of outdated) {
    if (task.state === 'running') {
      ws.db.run(
        "UPDATE tasks SET state = 'stale', blocked_reason = ?, updated_at = ? WHERE id = ?",
        'Scope version changed while this task was running; its result cannot be committed as current.',
        nowIso(),
        task.id,
      );
      staleRunning += 1;
      continue;
    }
    ws.db.run(
      "UPDATE tasks SET state = 'cancelled', blocked_reason = ?, updated_at = ?, completed_at = ? WHERE id = ?",
      `Superseded by scope version ${newVersion}`,
      nowIso(),
      nowIso(),
      task.id,
    );
    cancelled += 1;

    const stillEligible =
      task.target_kind === 'unit'
        ? effectiveUnitDecision(ws, versionId, task.target_id) === 'included'
        : task.target_kind === 'person'
          ? isPersonInScope(ws, versionId, task.target_id)
          : true;
    if (!stillEligible) continue;

    const params = JSON.parse(task.params_json) as Record<string, unknown>;
    const identity = {
      jobKind: task.job_kind as JobKind,
      targetKind: task.target_kind,
      targetId: task.target_id,
      scopeId,
      scopeVersion: newVersion,
      params,
      inputRevisions: {} as Record<string, string | number>,
      schemaVersion: TASK_SCHEMA_VERSION,
    };
    ws.db.run(
      `INSERT INTO tasks (id, job_kind, target_kind, target_id, scope_id, scope_version, params_json,
                          input_fingerprint, schema_version, dedupe_key, state, priority, requested_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'scope_change', ?, ?)
       ON CONFLICT(dedupe_key) DO NOTHING`,
      opaqueId('task'),
      identity.jobKind,
      identity.targetKind,
      identity.targetId,
      scopeId,
      newVersion,
      JSON.stringify(params),
      inputFingerprint(identity.inputRevisions),
      TASK_SCHEMA_VERSION,
      taskDedupeKey(identity),
      task.priority,
      nowIso(),
      nowIso(),
    );
    requeued += 1;
  }
  return { cancelledTasks: cancelled, requeuedTasks: requeued, staleRunningTasks: staleRunning };
}

/**
 * Effective decision for a unit: an explicit decision on the unit wins, then
 * the nearest explicit ancestor. When a unit has several parents and they
 * disagree, inclusion wins, mirroring the cross-appointment rule for people.
 */
export function effectiveUnitDecision(ws: Workspace, scopeVersionId: string, unitId: string, seen = new Set<string>()): ScopeDecision {
  if (seen.has(unitId)) return 'undecided';
  seen.add(unitId);
  const explicit = ws.db.get<{ decision: ScopeDecision }>(
    'SELECT decision FROM scope_units WHERE scope_version_id = ? AND unit_id = ?',
    scopeVersionId,
    unitId,
  );
  if (explicit) return explicit.decision;
  const parents = ws.db.all<{ parent_id: string; parent_kind: string }>(
    'SELECT parent_id, parent_kind FROM unit_parents WHERE unit_id = ?',
    unitId,
  );
  let result: ScopeDecision = 'undecided';
  for (const parent of parents) {
    if (parent.parent_kind === 'university') continue;
    const inherited = effectiveUnitDecision(ws, scopeVersionId, parent.parent_id, seen);
    if (inherited === 'included') return 'included';
    if (inherited === 'excluded') result = 'excluded';
  }
  return result;
}

export function isUnitIncluded(ws: Workspace, scopeVersionId: string, unitId: string): boolean {
  return effectiveUnitDecision(ws, scopeVersionId, unitId) === 'included';
}

/** A person is in scope when any affiliated unit is included, unless explicitly excluded. */
export function isPersonInScope(ws: Workspace, scopeVersionId: string, personId: string): boolean {
  const exception = ws.db.get<{ decision: string }>(
    'SELECT decision FROM scope_person_exceptions WHERE scope_version_id = ? AND person_id = ?',
    scopeVersionId,
    personId,
  );
  if (exception) return exception.decision === 'included';
  const units = ws.db.all<{ to_id: string }>(
    "SELECT to_id FROM relationships WHERE from_id = ? AND rel_type = 'affiliated_with'",
    personId,
  );
  return units.some((unit) => isUnitIncluded(ws, scopeVersionId, unit.to_id));
}

export interface UnitTreeNode {
  id: string;
  officialName: string;
  unitType: string;
  campus: string | null;
  url: string | null;
  decision: ScopeDecision;
  explicit: boolean;
  notePath: string | null;
  children: UnitTreeNode[];
}

export function unitTree(ws: Workspace, universityId: string, scopeVersionId?: string): UnitTreeNode[] {
  const units = ws.db.all<{
    entity_id: string;
    official_name: string;
    unit_type: string;
    campus: string | null;
    url: string | null;
    canonical_path: string | null;
  }>(
    `SELECT u.entity_id, u.official_name, u.unit_type, u.campus, u.url, e.canonical_path
     FROM academic_units u JOIN entities e ON e.id = u.entity_id
     WHERE u.university_id = ? AND e.merged_into IS NULL
     ORDER BY u.unit_type, u.official_name`,
    universityId,
  );
  const parents = ws.db.all<{ unit_id: string; parent_id: string; parent_kind: string }>(
    'SELECT unit_id, parent_id, parent_kind FROM unit_parents',
  );
  const explicitRows = scopeVersionId
    ? ws.db.all<{ unit_id: string; decision: ScopeDecision }>(
        'SELECT unit_id, decision FROM scope_units WHERE scope_version_id = ?',
        scopeVersionId,
      )
    : [];
  const explicitMap = new Map(explicitRows.map((r) => [r.unit_id, r.decision]));

  const nodes = new Map<string, UnitTreeNode>();
  for (const unit of units) {
    nodes.set(unit.entity_id, {
      id: unit.entity_id,
      officialName: unit.official_name,
      unitType: unit.unit_type,
      campus: unit.campus,
      url: unit.url,
      decision: scopeVersionId ? effectiveUnitDecision(ws, scopeVersionId, unit.entity_id) : 'undecided',
      explicit: explicitMap.has(unit.entity_id),
      notePath: unit.canonical_path,
      children: [],
    });
  }
  const roots: UnitTreeNode[] = [];
  for (const unit of units) {
    const node = nodes.get(unit.entity_id) as UnitTreeNode;
    const unitParents = parents.filter((p) => p.unit_id === unit.entity_id && p.parent_kind === 'unit');
    const attached = unitParents
      .map((p) => nodes.get(p.parent_id))
      .filter((parent): parent is UnitTreeNode => parent !== undefined);
    if (attached.length === 0) roots.push(node);
    else for (const parent of attached) parent.children.push(node);
  }
  return roots;
}

export function scopeSummary(ws: Workspace, scopeId: string): Record<string, unknown> {
  const scope = getScope(ws, scopeId);
  const version = currentScopeVersion(ws, scopeId);
  const draft = draftVersion(ws, scopeId);
  const counts = ws.db.get<{ included: number; excluded: number }>(
    `SELECT
       SUM(CASE WHEN decision = 'included' THEN 1 ELSE 0 END) AS included,
       SUM(CASE WHEN decision = 'excluded' THEN 1 ELSE 0 END) AS excluded
     FROM scope_units WHERE scope_version_id = ?`,
    version.id,
  );
  const totalUnits = ws.db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM academic_units WHERE university_id = ?',
    scope.university_id,
  );
  return {
    scopeId,
    universityId: scope.university_id,
    currentVersion: scope.current_version,
    confirmedAt: version.confirmed_at,
    hasDraft: Boolean(draft),
    draftVersion: draft?.version ?? null,
    explicitIncluded: counts?.included ?? 0,
    explicitExcluded: counts?.excluded ?? 0,
    totalUnits: totalUnits?.n ?? 0,
  };
}
