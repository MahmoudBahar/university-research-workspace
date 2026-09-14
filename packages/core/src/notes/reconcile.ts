import { existsSync, readFileSync } from 'node:fs';
import { relative, join } from 'node:path';
import type { Workspace } from '../workspace.js';
import { listFilesRecursive, toPosix, fileStats, fromPosix } from '../util/fsx.js';
import { sha256Text } from '../util/hash.js';
import { parseNote } from './frontmatter.js';
import { extractProtectedBlocks, protectedBlockMap } from './protected.js';
import { validateFrontmatter } from './noteStore.js';
import { vaultFilePath } from '../registry.js';
import { nowIso } from '../util/time.js';
import { opaqueId } from '../util/ids.js';
import { emitEvent, pruneEvents } from '../util/events.js';
import { AppError } from '../util/errors.js';
import { recoverCommits, type RecoveryReport } from '../commit/commit.js';
import { refreshPersonReadiness } from '../readiness.js';

export interface ReconcileIssue {
  path: string;
  kind: string;
  detail: string;
}

export interface ReconcileReport {
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  missingFiles: string[];
  issues: ReconcileIssue[];
  commitRecovery: RecoveryReport;
  /** Notes skipped without reading because size and mtime matched the index. */
  skippedByStat: number;
  prunedEvents: number;
  readinessRefreshed: number;
}

export interface ReconcileOptions {
  /** Hash every note even when its size and mtime match the index. */
  full?: boolean;
}

function recordIssue(ws: Workspace, path: string, kind: string, detail: Record<string, unknown>): void {
  const id = `issue-${sha256Text(`${path}:${kind}:${JSON.stringify(detail)}`).slice(0, 24)}`;
  ws.db.run(
    'INSERT INTO note_issues (id, path, kind, detail, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    id,
    path,
    kind,
    JSON.stringify(detail),
    nowIso(),
  );
}

function clearIssues(ws: Workspace, path: string, kinds: string[]): void {
  for (const kind of kinds) {
    ws.db.run('UPDATE note_issues SET resolved_at = ? WHERE path = ? AND kind = ? AND resolved_at IS NULL', nowIso(), path, kind);
  }
}

/**
 * Bring the derived index back in step with the files on disk.
 *
 * Manual edits are preserved and recorded as user revisions; unparsable
 * frontmatter and edited generated blocks are reported, never repaired by
 * overwriting the file.
 */
export function reconcileVault(ws: Workspace, options: ReconcileOptions = {}): ReconcileReport {
  const commitRecovery = recoverCommits(ws);
  const report: ReconcileReport = {
    scanned: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    missingFiles: [],
    issues: [],
    commitRecovery,
    skippedByStat: 0,
    prunedEvents: 0,
    readinessRefreshed: 0,
  };

  const files = listFilesRecursive(ws.paths.vault, (p) => p.endsWith('.md'));
  const seen = new Set<string>();

  for (const absolute of files) {
    const vaultRelative = toPosix(relative(ws.paths.vault, absolute));
    const indexPath = vaultFilePath(vaultRelative);
    seen.add(indexPath);
    report.scanned += 1;

    const stats = fileStats(absolute);
    const existing = ws.db.get<{ sha256: string; current_revision: number; entity_id: string | null; mtime_ms: number | null; size: number | null }>(
      'SELECT sha256, current_revision, entity_id, mtime_ms, size FROM note_index WHERE path = ?',
      indexPath,
    );

    // Steady state: an unchanged size and mtime means the bytes were not
    // rewritten, so the stored hash stands and the file is not re-read.
    if (
      !options.full &&
      existing &&
      stats &&
      existing.mtime_ms !== null &&
      existing.size !== null &&
      existing.mtime_ms === stats.mtimeMs &&
      existing.size === stats.size
    ) {
      report.unchanged += 1;
      report.skippedByStat += 1;
      continue;
    }

    const text = readFileSync(absolute, 'utf8');
    const sha = sha256Text(text);

    if (existing && existing.sha256 === sha) {
      report.unchanged += 1;
      if (stats && (existing.mtime_ms !== stats.mtimeMs || existing.size !== stats.size)) {
        ws.db.run('UPDATE note_index SET mtime_ms = ?, size = ? WHERE path = ?', stats.mtimeMs, stats.size, indexPath);
      }
      continue;
    }

    let parsed;
    try {
      parsed = parseNote(text);
    } catch (error) {
      const message = error instanceof AppError ? error.message : String(error);
      recordIssue(ws, indexPath, 'invalid_frontmatter', { message });
      report.issues.push({ path: indexPath, kind: 'invalid_frontmatter', detail: message });
      continue;
    }
    clearIssues(ws, indexPath, ['invalid_frontmatter']);

    const validation = validateFrontmatter(parsed.frontmatter);
    if (!validation.ok) {
      recordIssue(ws, indexPath, 'schema_validation', { issues: validation.issues });
      report.issues.push({ path: indexPath, kind: 'schema_validation', detail: JSON.stringify(validation.issues) });
    } else {
      clearIssues(ws, indexPath, ['schema_validation']);
    }

    const frontmatterId = typeof parsed.frontmatter['id'] === 'string' ? (parsed.frontmatter['id'] as string) : null;
    if (existing?.entity_id && frontmatterId && frontmatterId !== existing.entity_id) {
      recordIssue(ws, indexPath, 'identity_mismatch', { indexed: existing.entity_id, inFile: frontmatterId });
      report.issues.push({
        path: indexPath,
        kind: 'identity_mismatch',
        detail: `Note declares ${frontmatterId}; the registry has ${existing.entity_id}`,
      });
    }

    const editedBlocks = extractProtectedBlocks(parsed.body).filter((block) => block.edited);
    for (const block of editedBlocks) {
      recordIssue(ws, indexPath, 'protected_block_edited', { blockId: block.id });
      report.issues.push({
        path: indexPath,
        kind: 'protected_block_edited',
        detail: `Generated block "${block.id}" was edited by hand; the edit is preserved and needs review.`,
      });
    }

    ws.db.transaction(() => {
      const revision =
        (ws.db.get<{ v: number }>('SELECT COALESCE(MAX(revision), 0) AS v FROM note_revisions WHERE path = ?', indexPath)?.v ?? 0) + 1;
      ws.db.run(
        `INSERT INTO note_revisions (id, entity_id, path, revision, sha256, size, source, commit_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'user', NULL, ?)`,
        opaqueId('rev'),
        frontmatterId ?? existing?.entity_id ?? null,
        indexPath,
        revision,
        sha,
        Buffer.byteLength(text, 'utf8'),
        nowIso(),
      );
      ws.db.run(
        `INSERT INTO note_index (path, entity_id, note_type, title, schema_version, current_revision, sha256, mtime_ms,
                                 size, frontmatter_json, body_text, protected_blocks_json, checked_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           entity_id = COALESCE(note_index.entity_id, excluded.entity_id),
           note_type = excluded.note_type,
           title = excluded.title,
           schema_version = excluded.schema_version,
           current_revision = excluded.current_revision,
           sha256 = excluded.sha256,
           mtime_ms = excluded.mtime_ms,
           size = excluded.size,
           frontmatter_json = excluded.frontmatter_json,
           body_text = excluded.body_text,
           protected_blocks_json = excluded.protected_blocks_json,
           checked_at = excluded.checked_at,
           updated_at = excluded.updated_at`,
        indexPath,
        frontmatterId ?? existing?.entity_id ?? null,
        parsed.frontmatter['type'] == null ? null : String(parsed.frontmatter['type']),
        parsed.frontmatter['title'] == null ? null : String(parsed.frontmatter['title']),
        Number(parsed.frontmatter['schema_version'] ?? 1),
        revision,
        sha,
        stats?.mtimeMs ?? null,
        Buffer.byteLength(text, 'utf8'),
        JSON.stringify(parsed.frontmatter),
        parsed.body,
        JSON.stringify(protectedBlockMap(parsed.body)),
        (parsed.frontmatter['checked_at'] as string | undefined) ?? null,
        nowIso(),
      );
    });

    if (existing) report.updated += 1;
    else report.added += 1;
    emitEvent(ws.db, existing ? 'note:updated' : 'note:added', frontmatterId, { path: indexPath, source: 'user' });
  }

  const indexed = ws.db.all<{ path: string }>('SELECT path FROM note_index');
  for (const row of indexed) {
    if (seen.has(row.path)) continue;
    const absolute = join(ws.paths.root, fromPosix(row.path));
    if (existsSync(absolute)) continue;
    report.missingFiles.push(row.path);
    recordIssue(ws, row.path, 'file_missing', { path: row.path });
  }

  // Derived readiness flags are recomputed from the live claim index so the
  // queue and the interface never show a stale email_ready.
  const people = ws.db.all<{ entity_id: string }>(
    'SELECT p.entity_id FROM people p JOIN entities e ON e.id = p.entity_id WHERE e.merged_into IS NULL',
  );
  ws.db.transaction(() => {
    for (const person of people) refreshPersonReadiness(ws, person.entity_id);
  });
  report.readinessRefreshed = people.length;

  report.prunedEvents = pruneEvents(ws.db, ws.config.events.retentionDays).pruned;

  return report;
}

export function openIssues(ws: Workspace): Record<string, unknown>[] {
  return ws.db.all('SELECT * FROM note_issues WHERE resolved_at IS NULL ORDER BY created_at DESC');
}

export function resolveIssue(ws: Workspace, issueId: string): void {
  ws.db.run('UPDATE note_issues SET resolved_at = ? WHERE id = ?', nowIso(), issueId);
}
