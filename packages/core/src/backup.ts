import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Workspace } from './workspace.js';
import { AppError } from './util/errors.js';
import { ensureDir, writeFileAtomic, listFilesRecursive, toPosix } from './util/fsx.js';
import { sha256File } from './util/hash.js';
import { nowIso } from './util/time.js';
import { recordAudit } from './util/events.js';

export interface BackupManifest {
  createdAt: string;
  label: string;
  schemaVersion: number;
  driver: string;
  contents: string[];
  fileCount: number;
  databaseSha256: string;
  workspaceRoot: string;
}

const BACKUP_CONTENTS = ['vault', 'applicant', 'config', 'data/revisions', 'data/commits'];

/**
 * Consistent on-demand backup.
 *
 * The database is copied with VACUUM INTO, which produces a single coherent
 * file even while WAL is active, so no -wal/-shm files need to travel with it.
 */
export async function createBackup(ws: Workspace, options: { label?: string; target?: string } = {}): Promise<{ path: string; manifest: BackupManifest }> {
  const stamp = nowIso().replace(/[:.]/g, '-');
  const label = options.label ?? 'manual';
  const dir = options.target ?? join(ws.paths.backups, `${stamp}-${label}`);
  ensureDir(dir);

  const dbTarget = join(dir, 'research.sqlite');
  ws.db.backupTo(dbTarget);

  const copied: string[] = [];
  for (const relative of BACKUP_CONTENTS) {
    const source = join(ws.paths.root, ...relative.split('/'));
    if (!existsSync(source)) continue;
    cpSync(source, join(dir, ...relative.split('/')), { recursive: true });
    copied.push(relative);
  }

  const manifest: BackupManifest = {
    createdAt: nowIso(),
    label,
    schemaVersion: ws.db.get<{ v: number }>('SELECT COALESCE(MAX(id), 0) AS v FROM schema_migrations')?.v ?? 0,
    driver: ws.db.driverName,
    contents: copied,
    fileCount: copied.reduce((sum, relative) => sum + listFilesRecursive(join(dir, ...relative.split('/'))).length, 0),
    databaseSha256: await sha256File(dbTarget),
    workspaceRoot: toPosix(ws.paths.root),
  };
  writeFileAtomic(join(dir, 'backup.json'), JSON.stringify(manifest, null, 2));
  recordAudit(ws.db, 'user', 'backup.create', null, { path: dir, label });
  return { path: dir, manifest };
}

export interface RestoreReport {
  restored: string[];
  databaseRestored: boolean;
  warnings: string[];
}

/**
 * Restore a backup into a workspace directory. The caller must not hold an open
 * database handle on the target; the CLI closes it before restoring.
 */
export function restoreBackup(root: string, backupDir: string, options: { force?: boolean } = {}): RestoreReport {
  const manifestPath = join(backupDir, 'backup.json');
  if (!existsSync(manifestPath)) {
    throw new AppError('invalid_input', 'That directory does not contain backup.json', { backupDir });
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
  const warnings: string[] = [];
  const restored: string[] = [];

  const dbSource = join(backupDir, 'research.sqlite');
  const dbTarget = join(root, 'data', 'research.sqlite');
  let databaseRestored = false;
  if (existsSync(dbSource)) {
    if (existsSync(dbTarget) && !options.force) {
      throw new AppError('conflict', 'A database already exists. Re-run with force to overwrite it.', { dbTarget });
    }
    ensureDir(join(root, 'data'));
    for (const suffix of ['', '-wal', '-shm']) {
      const stale = `${dbTarget}${suffix}`;
      if (existsSync(stale)) rmSync(stale, { force: true });
    }
    cpSync(dbSource, dbTarget);
    databaseRestored = true;
  } else {
    warnings.push('The backup contains no database file.');
  }

  for (const relative of manifest.contents) {
    const source = join(backupDir, ...relative.split('/'));
    if (!existsSync(source)) continue;
    const target = join(root, ...relative.split('/'));
    if (existsSync(target) && !options.force) {
      warnings.push(`${relative} already exists and was left untouched. Re-run with force to replace it.`);
      continue;
    }
    cpSync(source, target, { recursive: true });
    restored.push(relative);
  }

  return { restored, databaseRestored, warnings };
}

export function listBackups(ws: Workspace): { path: string; manifest: BackupManifest | null }[] {
  if (!existsSync(ws.paths.backups)) return [];
  const entries = listFilesRecursive(ws.paths.backups, (p) => p.endsWith('backup.json'));
  return entries.map((file) => ({
    path: file.replace(/[\\/]backup\.json$/, ''),
    manifest: JSON.parse(readFileSync(file, 'utf8')) as BackupManifest,
  }));
}
