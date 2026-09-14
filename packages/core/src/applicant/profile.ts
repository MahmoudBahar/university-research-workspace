import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Workspace } from '../workspace.js';
import { AppError } from '../util/errors.js';
import { sha256Text } from '../util/hash.js';
import { ensureDir, listFilesRecursive, toPosix, writeFileAtomic } from '../util/fsx.js';
import { opaqueId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { recordAudit, emitEvent } from '../util/events.js';

export type ApplicantDocKind = 'profile' | 'style' | 'override';

export interface ApplicantRevisionRow {
  id: string;
  kind: string;
  path: string;
  revision: number;
  sha256: string;
  approved_at: string | null;
  created_at: string;
}

export function applicantFilePath(ws: Workspace, kind: ApplicantDocKind, name?: string): string {
  if (kind === 'profile') return join(ws.paths.applicant, 'profile.md');
  if (kind === 'style') return join(ws.paths.applicant, 'email-style.md');
  if (!name) throw new AppError('invalid_input', 'Override documents need a name', {});
  return join(ws.paths.applicant, 'overrides', name.endsWith('.md') ? name : `${name}.md`);
}

function relativePath(ws: Workspace, absolute: string): string {
  return toPosix(absolute.slice(ws.paths.root.length + 1));
}

/**
 * Record the current file bytes as a revision. Revisions are content-addressed,
 * so calling this repeatedly without an edit does not create new versions.
 */
export function snapshotApplicantRevision(ws: Workspace, kind: ApplicantDocKind, name?: string): ApplicantRevisionRow {
  const absolute = applicantFilePath(ws, kind, name);
  if (!existsSync(absolute)) {
    throw new AppError('not_found', `Applicant file not found: ${relativePath(ws, absolute)}`, { path: absolute });
  }
  const text = readFileSync(absolute, 'utf8');
  const sha = sha256Text(text);
  const path = relativePath(ws, absolute);

  return ws.db.transaction(() => {
    const latest = ws.db.get<ApplicantRevisionRow>(
      'SELECT * FROM applicant_revisions WHERE path = ? ORDER BY revision DESC LIMIT 1',
      path,
    );
    if (latest && latest.sha256 === sha) return latest;
    const revision = (latest?.revision ?? 0) + 1;
    const id = opaqueId('apprev');
    // Keep the exact bytes so an approved revision can be loaded later even
    // after the working file has moved on.
    const stored = join(ws.paths.revisions, sha.slice(0, 2), `${sha}.bin`);
    if (!existsSync(stored)) {
      ensureDir(join(ws.paths.revisions, sha.slice(0, 2)));
      writeFileAtomic(stored, text);
    }
    ws.db.run(
      'INSERT INTO applicant_revisions (id, kind, path, revision, sha256, approved_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
      id,
      kind,
      path,
      revision,
      sha,
      nowIso(),
    );
    emitEvent(ws.db, 'applicant:revision', null, { kind, path, revision });
    return ws.db.get<ApplicantRevisionRow>('SELECT * FROM applicant_revisions WHERE id = ?', id) as ApplicantRevisionRow;
  });
}

/**
 * Approving binds an exact revision. Email drafting may only assert applicant
 * facts that come from an approved revision.
 */
export function approveApplicantRevision(
  ws: Workspace,
  kind: ApplicantDocKind,
  expectedSha: string,
  options: { name?: string; actor?: string } = {},
): ApplicantRevisionRow {
  const revision = snapshotApplicantRevision(ws, kind, options.name);
  if (revision.sha256 !== expectedSha) {
    throw new AppError('revision_conflict', 'The applicant file changed since it was reviewed. Reload and approve the current text.', {
      expected: expectedSha,
      actual: revision.sha256,
    });
  }
  ws.db.run('UPDATE applicant_revisions SET approved_at = ? WHERE id = ?', nowIso(), revision.id);
  recordAudit(ws.db, options.actor ?? 'user', 'applicant.approve', null, {
    kind,
    revision: revision.revision,
    sha256: revision.sha256,
  });
  return ws.db.get<ApplicantRevisionRow>('SELECT * FROM applicant_revisions WHERE id = ?', revision.id) as ApplicantRevisionRow;
}

export function latestApplicantRevision(ws: Workspace, kind: ApplicantDocKind, name?: string): ApplicantRevisionRow | undefined {
  const path = relativePath(ws, applicantFilePath(ws, kind, name));
  return ws.db.get<ApplicantRevisionRow>('SELECT * FROM applicant_revisions WHERE path = ? ORDER BY revision DESC LIMIT 1', path);
}

export function readApplicantFile(ws: Workspace, kind: ApplicantDocKind, name?: string): { path: string; text: string; sha256: string } {
  const absolute = applicantFilePath(ws, kind, name);
  const text = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
  return { path: relativePath(ws, absolute), text, sha256: sha256Text(text) };
}

export function writeApplicantFile(
  ws: Workspace,
  kind: ApplicantDocKind,
  text: string,
  options: { name?: string; expectedSha?: string; actor?: string } = {},
): { path: string; sha256: string; revision: number } {
  const absolute = applicantFilePath(ws, kind, options.name);
  if (options.expectedSha !== undefined) {
    const current = existsSync(absolute) ? sha256Text(readFileSync(absolute, 'utf8')) : '';
    if (current !== options.expectedSha) {
      throw new AppError('revision_conflict', 'The applicant file changed on disk. Reload before saving.', {
        expected: options.expectedSha,
        actual: current,
      });
    }
  }
  ensureDir(join(ws.paths.applicant, 'overrides'));
  writeFileAtomic(absolute, text);
  const revision = snapshotApplicantRevision(ws, kind, options.name);
  recordAudit(ws.db, options.actor ?? 'user', 'applicant.write', null, { kind, revision: revision.revision });
  return { path: relativePath(ws, absolute), sha256: revision.sha256, revision: revision.revision };
}

export function listOverrides(ws: Workspace): { name: string; path: string; sha256: string }[] {
  const dir = join(ws.paths.applicant, 'overrides');
  return listFilesRecursive(dir, (p) => p.endsWith('.md')).map((absolute) => ({
    name: absolute.slice(dir.length + 1).split(/[\\/]/).join('/'),
    path: relativePath(ws, absolute),
    sha256: sha256Text(readFileSync(absolute, 'utf8')),
  }));
}

export interface WritingGuidance {
  general: string;
  universityOverride: string | null;
  personOverride: string | null;
  approvedProfile: { revisionId: string; revision: number; text: string } | null;
  warnings: string[];
}

/**
 * Three levels of drafting guidance: general preferences, a university or
 * program override, and person-specific instructions. Specific instructions win.
 */
export function resolveWritingGuidance(
  ws: Workspace,
  options: { universityId?: string | null; programId?: string | null; personId?: string | null } = {},
): WritingGuidance {
  const warnings: string[] = [];
  const general = readApplicantFile(ws, 'style').text;

  const overrideNames: string[] = [];
  if (options.universityId) overrideNames.push(`${options.universityId}.md`);
  if (options.programId) overrideNames.push(`${options.programId}.md`);
  const universityOverride = overrideNames
    .map((name) => {
      const absolute = join(ws.paths.applicant, 'overrides', name);
      return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
    })
    .filter((value): value is string => value !== null)
    .join('\n\n') || null;

  const personOverridePath = options.personId ? join(ws.paths.applicant, 'overrides', `${options.personId}.md`) : null;
  const personOverride = personOverridePath && existsSync(personOverridePath) ? readFileSync(personOverridePath, 'utf8') : null;

  const approvedRow = ws.db.get<ApplicantRevisionRow>(
    "SELECT * FROM applicant_revisions WHERE kind = 'profile' AND approved_at IS NOT NULL ORDER BY revision DESC LIMIT 1",
  );
  let approvedProfile: WritingGuidance['approvedProfile'] = null;
  if (approvedRow) {
    const currentText = readApplicantFile(ws, 'profile');
    if (currentText.sha256 !== approvedRow.sha256) {
      warnings.push(
        'applicant/profile.md has unapproved edits. Drafting uses the approved revision; approve the new text to use it.',
      );
    }
    const stored = join(ws.paths.revisions, approvedRow.sha256.slice(0, 2), `${approvedRow.sha256}.bin`);
    const text = existsSync(stored)
      ? readFileSync(stored, 'utf8')
      : currentText.sha256 === approvedRow.sha256
        ? currentText.text
        : '';
    if (text === '') {
      warnings.push('The approved applicant revision bytes are not available locally; re-approve the profile.');
    }
    approvedProfile = { revisionId: approvedRow.id, revision: approvedRow.revision, text };
  } else {
    warnings.push('No approved applicant profile revision. Email drafts may not assert applicant facts.');
  }

  return { general, universityOverride, personOverride, approvedProfile, warnings };
}
