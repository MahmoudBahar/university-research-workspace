import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Workspace } from '../workspace.js';
import type { CommitManifest, CommitState, DbOp, FileOp } from './manifest.js';
import { applyDbOps } from './dbops.js';
import { acquireCommitLock, releaseCommitLock } from './locks.js';
import { AppError } from '../util/errors.js';
import { ensureDir, fileStats, writeFileAtomic, toPosix, fromPosix } from '../util/fsx.js';
import { sha256Bytes, sha256Text } from '../util/hash.js';
import { opaqueId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { emitEvent } from '../util/events.js';

export interface StagedFile {
  /** Workspace-root-relative posix path. */
  path: string;
  content: string | Uint8Array;
  /**
   * `undefined` captures the current on-disk hash at prepare time (optimistic).
   * `null` requires the file to be absent. `'*'` overwrites unconditionally.
   */
  expectedPrior?: string | null | '*';
  entityId?: string;
  noteType?: string;
  source?: 'worker' | 'core' | 'user';
}

export interface PrepareCommitInput {
  lockKey: string;
  description: string;
  entityId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  fencingToken?: number | null;
  scopeId?: string | null;
  scopeVersion?: number | null;
  files: StagedFile[];
  dbOps?: DbOp[];
  owner?: string;
}

export interface CommitResult {
  commitId: string;
  installed: string[];
  skipped: string[];
  state: CommitState;
}

function commitDir(ws: Workspace, commitId: string): string {
  return join(ws.paths.commits, commitId);
}

function manifestPath(ws: Workspace, commitId: string): string {
  return join(commitDir(ws, commitId), 'manifest.json');
}

function revisionStorePath(ws: Workspace, sha: string): string {
  return join(ws.paths.revisions, sha.slice(0, 2), `${sha}.bin`);
}

function currentHash(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  return sha256Bytes(readFileSync(absPath));
}

function retainRevision(ws: Workspace, absPath: string): void {
  if (!existsSync(absPath)) return;
  const bytes = readFileSync(absPath);
  const sha = sha256Bytes(bytes);
  const target = revisionStorePath(ws, sha);
  if (!existsSync(target)) {
    writeFileAtomic(target, bytes);
  }
}

/**
 * Stage file bytes and record a durable manifest before anything is installed.
 * Nothing in the vault or the database changes during this phase.
 */
export function prepareCommit(ws: Workspace, input: PrepareCommitInput): CommitManifest {
  const commitId = opaqueId('commit');
  const dir = commitDir(ws, commitId);
  ensureDir(join(dir, 'staged'));

  const files: FileOp[] = input.files.map((file, index) => {
    const bytes = typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : Buffer.from(file.content);
    const stagedName = `${String(index).padStart(4, '0')}.bin`;
    writeFileAtomic(join(dir, 'staged', stagedName), bytes);
    const abs = join(ws.paths.root, fromPosix(file.path));
    const prior =
      file.expectedPrior === undefined
        ? currentHash(abs)
        : file.expectedPrior === '*'
          ? '*'
          : file.expectedPrior;
    return {
      path: file.path,
      staged: stagedName,
      sha256: sha256Bytes(bytes),
      size: bytes.byteLength,
      expectedPriorSha256: prior,
      entityId: file.entityId,
      noteType: file.noteType,
      source: file.source ?? 'core',
    };
  });

  const manifest: CommitManifest = {
    id: commitId,
    createdAt: nowIso(),
    lockKey: input.lockKey,
    entityId: input.entityId ?? null,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    fencingToken: input.fencingToken ?? null,
    scopeId: input.scopeId ?? null,
    scopeVersion: input.scopeVersion ?? null,
    description: input.description,
    files,
    dbOps: input.dbOps ?? [],
  };

  const serialised = JSON.stringify(manifest, null, 2);
  writeFileAtomic(manifestPath(ws, commitId), serialised);
  ws.db.run(
    `INSERT INTO artifact_commits (id, entity_id, task_id, run_id, fencing_token, state, manifest_path,
                                   manifest_sha256, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)`,
    commitId,
    manifest.entityId,
    manifest.taskId,
    manifest.runId,
    manifest.fencingToken,
    toPosix(join('data', 'commits', commitId, 'manifest.json')),
    sha256Text(serialised),
    manifest.createdAt,
    manifest.createdAt,
  );
  return manifest;
}

function setCommitState(ws: Workspace, commitId: string, state: CommitState, conflict?: string): void {
  ws.db.run(
    'UPDATE artifact_commits SET state = ?, conflict_detail = ?, updated_at = ? WHERE id = ?',
    state,
    conflict ?? null,
    nowIso(),
    commitId,
  );
}

function validatePreconditions(ws: Workspace, manifest: CommitManifest): void {
  if (manifest.taskId && manifest.fencingToken != null) {
    const row = ws.db.get<{ fencing_token: number; state: string }>(
      'SELECT fencing_token, state FROM tasks WHERE id = ?',
      manifest.taskId,
    );
    if (!row) throw new AppError('not_found', `Task ${manifest.taskId} no longer exists`, { taskId: manifest.taskId });
    if (row.fencing_token !== manifest.fencingToken) {
      throw new AppError(
        'fencing_rejected',
        `Task ${manifest.taskId} was reclaimed (token ${row.fencing_token}); this result carries token ${manifest.fencingToken} and cannot commit`,
        { taskId: manifest.taskId, currentToken: row.fencing_token, resultToken: manifest.fencingToken },
      );
    }
  }
  if (manifest.scopeId && manifest.scopeVersion != null) {
    const scope = ws.db.get<{ current_version: number }>('SELECT current_version FROM scopes WHERE id = ?', manifest.scopeId);
    if (!scope) throw new AppError('not_found', `Scope ${manifest.scopeId} no longer exists`, {});
    if (scope.current_version !== manifest.scopeVersion) {
      throw new AppError(
        'scope_violation',
        `Result was produced against scope version ${manifest.scopeVersion}; the current version is ${scope.current_version}`,
        { scopeId: manifest.scopeId, resultVersion: manifest.scopeVersion, currentVersion: scope.current_version },
      );
    }
  }
}

export function readManifest(ws: Workspace, commitId: string): CommitManifest {
  const path = manifestPath(ws, commitId);
  if (!existsSync(path)) throw new AppError('not_found', `Commit manifest missing for ${commitId}`, { commitId });
  return JSON.parse(readFileSync(path, 'utf8')) as CommitManifest;
}

/**
 * Install staged files and finalise database state. Safe to call repeatedly:
 * files already carrying the target hash are skipped and every database
 * operation is an idempotent upsert.
 */
export function applyCommit(ws: Workspace, commitId: string, options: { owner?: string } = {}): CommitResult {
  const manifest = readManifest(ws, commitId);
  const owner = options.owner ?? `apply-${process.pid}`;
  acquireCommitLock(ws.db, manifest.lockKey, owner);
  try {
    validatePreconditions(ws, manifest);
    setCommitState(ws, commitId, 'applying');

    const installed: string[] = [];
    const skipped: string[] = [];

    // Phase 1: verify every file can be installed before touching any of them.
    const plan: { op: FileOp; abs: string; action: 'install' | 'skip' }[] = [];
    for (const op of manifest.files) {
      const abs = join(ws.paths.root, fromPosix(op.path));
      const current = currentHash(abs);
      if (current === op.sha256) {
        plan.push({ op, abs, action: 'skip' });
        continue;
      }
      const expected = op.expectedPriorSha256;
      if (expected === '*' || current === expected) {
        plan.push({ op, abs, action: 'install' });
        continue;
      }
      const detail = {
        path: op.path,
        expected,
        actual: current,
        reason: current === null ? 'file_missing' : 'file_changed_outside_commit',
      };
      setCommitState(ws, commitId, 'conflict', JSON.stringify(detail));
      throw new AppError(
        'revision_conflict',
        `Cannot install ${op.path}: it changed since this result was produced. Existing bytes were left untouched.`,
        detail,
      );
    }

    // Phase 2: install, retaining prior committed bytes first.
    for (const entry of plan) {
      if (entry.action === 'skip') {
        skipped.push(entry.op.path);
        continue;
      }
      retainRevision(ws, entry.abs);
      const bytes = readFileSync(join(commitDir(ws, commitId), 'staged', entry.op.staged));
      // Durable install: fsynced temp file, atomic rename, directory fsync.
      writeFileAtomic(entry.abs, bytes);
      const target = revisionStorePath(ws, entry.op.sha256);
      if (!existsSync(target)) {
        writeFileAtomic(target, bytes);
      }
      installed.push(entry.op.path);
    }

    // Phase 3: finalise database state in one short transaction.
    ws.db.transaction(() => {
      const enriched: DbOp[] = manifest.dbOps.map((op) => {
        if (op.kind !== 'note.revision') return op;
        const abs = join(ws.paths.root, fromPosix(String(op.payload['path'] ?? '')));
        const stats = fileStats(abs);
        return { ...op, payload: { ...op.payload, mtimeMs: stats?.mtimeMs ?? null } };
      });
      applyDbOps(ws.db, enriched, commitId);
      emitEvent(ws.db, 'commit:applied', manifest.entityId, {
        commitId,
        description: manifest.description,
        files: installed.length,
      });
      // The state flip is part of the same transaction, so a replay after a
      // crash never re-applies (and re-announces) a commit that already landed.
      setCommitState(ws, commitId, 'committed');
    });

    return { commitId, installed, skipped, state: 'committed' };
  } finally {
    releaseCommitLock(ws.db, manifest.lockKey, owner);
  }
}

export function commitArtifacts(ws: Workspace, input: PrepareCommitInput): CommitResult {
  const manifest = prepareCommit(ws, input);
  return applyCommit(ws, manifest.id, { owner: input.owner });
}

export interface RecoveryReport {
  scanned: number;
  recovered: string[];
  conflicts: { commitId: string; detail: string }[];
  rejected: { commitId: string; reason: string }[];
}

/**
 * Replay commits interrupted between file installation and database
 * finalisation. Called on CLI start, server start, and on demand.
 */
export function recoverCommits(ws: Workspace): RecoveryReport {
  const report: RecoveryReport = { scanned: 0, recovered: [], conflicts: [], rejected: [] };

  // Manifests written before their row was inserted still need recovery.
  if (existsSync(ws.paths.commits)) {
    for (const entry of readdirSync(ws.paths.commits, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const row = ws.db.get<{ id: string }>('SELECT id FROM artifact_commits WHERE id = ?', entry.name);
      if (row) continue;
      if (!existsSync(manifestPath(ws, entry.name))) continue;
      const serialised = readFileSync(manifestPath(ws, entry.name), 'utf8');
      const parsed = JSON.parse(serialised) as CommitManifest;
      ws.db.run(
        `INSERT INTO artifact_commits (id, entity_id, task_id, run_id, fencing_token, state, manifest_path,
                                       manifest_sha256, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        parsed.id,
        parsed.entityId,
        parsed.taskId,
        parsed.runId,
        parsed.fencingToken,
        toPosix(join('data', 'commits', parsed.id, 'manifest.json')),
        sha256Text(serialised),
        parsed.createdAt,
        nowIso(),
      );
    }
  }

  const pending = ws.db.all<{ id: string; state: string }>(
    "SELECT id, state FROM artifact_commits WHERE state IN ('prepared','applying') ORDER BY created_at ASC",
  );
  report.scanned = pending.length;

  for (const row of pending) {
    try {
      applyCommit(ws, row.id, { owner: `recovery-${process.pid}` });
      report.recovered.push(row.id);
    } catch (error) {
      if (error instanceof AppError && error.code === 'revision_conflict') {
        report.conflicts.push({ commitId: row.id, detail: error.message });
        continue;
      }
      if (
        error instanceof AppError &&
        (error.code === 'fencing_rejected' || error.code === 'scope_violation' || error.code === 'not_found')
      ) {
        setCommitState(ws, row.id, 'rolled_back', error.message);
        report.rejected.push({ commitId: row.id, reason: error.message });
        continue;
      }
      throw error;
    }
  }
  return report;
}

export function listCommits(ws: Workspace, limit = 50): Record<string, unknown>[] {
  return ws.db.all(
    `SELECT id, entity_id, task_id, state, conflict_detail, created_at, updated_at
     FROM artifact_commits ORDER BY created_at DESC LIMIT ?`,
    limit,
  );
}
