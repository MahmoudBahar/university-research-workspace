import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Workspace } from '../workspace.js';
import { AppError } from '../util/errors.js';
import { sha256Text } from '../util/hash.js';
import { fileStats, fromPosix } from '../util/fsx.js';
import { parseNote, serializeNote, type ParsedNote } from './frontmatter.js';
import { protectedBlockMap, extractProtectedBlocks, findProtectedBlock, renderProtectedBlock, replaceProtectedBlock } from './protected.js';
import { schemaForType, NOTE_SCHEMA_VERSION } from '../schemas/notes.js';
import { commitArtifacts } from '../commit/commit.js';
import type { DbOp } from '../commit/manifest.js';
import { vaultFilePath } from '../registry.js';
import { nowIso, todayIso } from '../util/time.js';
import { recordAudit } from '../util/events.js';

export interface NoteFile {
  vaultPath: string;
  absolutePath: string;
  text: string;
  sha256: string;
  parsed: ParsedNote;
  size: number;
  mtimeMs: number | null;
  exists: boolean;
}

export function readNoteFile(ws: Workspace, vaultPath: string): NoteFile {
  const absolutePath = join(ws.paths.vault, fromPosix(vaultPath));
  if (!existsSync(absolutePath)) {
    return {
      vaultPath,
      absolutePath,
      text: '',
      sha256: '',
      parsed: { frontmatter: {}, body: '', frontmatterText: '', hasFrontmatter: false },
      size: 0,
      mtimeMs: null,
      exists: false,
    };
  }
  const text = readFileSync(absolutePath, 'utf8');
  const stats = fileStats(absolutePath);
  return {
    vaultPath,
    absolutePath,
    text,
    sha256: sha256Text(text),
    parsed: parseNote(text),
    size: stats?.size ?? text.length,
    mtimeMs: stats?.mtimeMs ?? null,
    exists: true,
  };
}

export interface ValidationResult {
  ok: boolean;
  issues: { path: string[]; message: string }[];
}

export function validateFrontmatter(frontmatter: Record<string, unknown>): ValidationResult {
  const type = String(frontmatter['type'] ?? '');
  const schema = schemaForType(type);
  if (!schema) {
    return { ok: false, issues: [{ path: ['type'], message: `Unknown note type: ${type || '(missing)'}` }] };
  }
  const result = schema.safeParse(frontmatter);
  if (result.success) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })),
  };
}

export interface WriteNoteInput {
  vaultPath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  entityId?: string;
  /** Optimistic guard: the hash the caller believes is on disk. */
  expectedSha?: string | null | '*';
  source?: 'worker' | 'core' | 'user';
  taskId?: string | null;
  runId?: string | null;
  fencingToken?: number | null;
  scopeId?: string | null;
  scopeVersion?: number | null;
  extraDbOps?: DbOp[];
  extraFiles?: { path: string; content: string; expectedPrior?: string | null | '*' }[];
  description?: string;
  actor?: string;
  claims?: { claimKey: string; claimValue?: string | null; evidenceStatus?: string; sourceId?: string; checkedAt?: string; freshnessClass?: string }[];
}

/** Compose the note text, validate it, and commit it with its index updates. */
export function writeNote(ws: Workspace, input: WriteNoteInput): { commitId: string; sha256: string; vaultPath: string } {
  const frontmatter: Record<string, unknown> = {
    schema_version: NOTE_SCHEMA_VERSION,
    ...input.frontmatter,
  };
  const validation = validateFrontmatter(frontmatter);
  if (!validation.ok) {
    throw new AppError('invalid_input', `Note frontmatter failed validation for ${input.vaultPath}`, {
      issues: validation.issues,
    });
  }
  const text = serializeNote(frontmatter, input.body);
  const sha = sha256Text(text);
  const noteType = String(frontmatter['type']);

  const dbOps: DbOp[] = [
    {
      kind: 'note.revision',
      payload: {
        path: vaultFilePath(input.vaultPath),
        entityId: input.entityId ?? frontmatter['id'] ?? null,
        noteType,
        title: frontmatter['title'] ?? null,
        schemaVersion: NOTE_SCHEMA_VERSION,
        sha256: sha,
        size: Buffer.byteLength(text, 'utf8'),
        source: input.source ?? 'core',
        frontmatter,
        bodyText: input.body,
        protectedBlocks: protectedBlockMap(input.body),
        checkedAt: frontmatter['checked_at'] ?? todayIso(),
      },
    },
    ...(input.claims ?? []).map((claim) => ({
      kind: 'claim.upsert' as const,
      payload: {
        entityId: input.entityId ?? frontmatter['id'] ?? null,
        path: vaultFilePath(input.vaultPath),
        claimKey: claim.claimKey,
        claimValue: claim.claimValue ?? null,
        evidenceStatus: claim.evidenceStatus ?? 'unverified',
        sourceId: claim.sourceId ?? null,
        checkedAt: claim.checkedAt ?? todayIso(),
        freshnessClass: claim.freshnessClass ?? 'standard',
      },
    })),
    ...(input.extraDbOps ?? []),
  ];

  const result = commitArtifacts(ws, {
    lockKey: input.entityId ?? input.vaultPath,
    description: input.description ?? `write ${input.vaultPath}`,
    entityId: input.entityId ?? null,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    fencingToken: input.fencingToken ?? null,
    scopeId: input.scopeId ?? null,
    scopeVersion: input.scopeVersion ?? null,
    files: [
      {
        path: vaultFilePath(input.vaultPath),
        content: text,
        expectedPrior: input.expectedSha,
        entityId: input.entityId,
        noteType,
        source: input.source ?? 'core',
      },
      ...(input.extraFiles ?? []).map((file) => ({
        path: file.path,
        content: file.content,
        expectedPrior: file.expectedPrior,
        source: input.source ?? ('core' as const),
      })),
    ],
    dbOps,
  });

  if (input.actor) {
    recordAudit(ws.db, input.actor, 'note.write', input.entityId ?? null, { path: input.vaultPath, commitId: result.commitId });
  }
  return { commitId: result.commitId, sha256: sha, vaultPath: input.vaultPath };
}

export interface UserEditInput {
  vaultPath: string;
  text: string;
  expectedSha: string;
  actor?: string;
}

/**
 * Commit a hand-edited note. Identity fields and generated relationship blocks
 * are protected: a change to them surfaces a conflict rather than silently
 * rewriting the registry or discarding the user's file.
 */
export function applyUserEdit(ws: Workspace, input: UserEditInput): { commitId: string; sha256: string } {
  const current = readNoteFile(ws, input.vaultPath);
  if (!current.exists) throw new AppError('not_found', `No note at ${input.vaultPath}`, { path: input.vaultPath });
  if (current.sha256 !== input.expectedSha) {
    throw new AppError('revision_conflict', 'The note changed on disk since it was loaded. Reload and merge before saving.', {
      path: input.vaultPath,
      expected: input.expectedSha,
      actual: current.sha256,
    });
  }

  const parsed = parseNote(input.text);
  const validation = validateFrontmatter(parsed.frontmatter);
  if (!validation.ok) {
    throw new AppError('invalid_input', 'Edited note failed frontmatter validation', { issues: validation.issues });
  }
  const previousId = current.parsed.frontmatter['id'];
  const nextId = parsed.frontmatter['id'];
  if (previousId && nextId !== previousId) {
    throw new AppError('conflict', 'The note id is a protected identity field and cannot be changed by editing the file.', {
      path: input.vaultPath,
      previousId,
      attemptedId: nextId,
    });
  }

  const editedBlocks = extractProtectedBlocks(parsed.body).filter((block) => block.edited);
  const entityId = typeof previousId === 'string' ? previousId : undefined;
  const dbOps: DbOp[] = [
    {
      kind: 'note.revision',
      payload: {
        path: vaultFilePath(input.vaultPath),
        entityId: entityId ?? null,
        noteType: parsed.frontmatter['type'] ?? null,
        title: parsed.frontmatter['title'] ?? null,
        schemaVersion: parsed.frontmatter['schema_version'] ?? NOTE_SCHEMA_VERSION,
        sha256: sha256Text(input.text),
        size: Buffer.byteLength(input.text, 'utf8'),
        source: 'user',
        frontmatter: parsed.frontmatter,
        bodyText: parsed.body,
        protectedBlocks: protectedBlockMap(parsed.body),
        checkedAt: parsed.frontmatter['checked_at'] ?? null,
      },
    },
  ];

  const result = commitArtifacts(ws, {
    lockKey: entityId ?? input.vaultPath,
    description: `user edit ${input.vaultPath}`,
    entityId: entityId ?? null,
    files: [
      {
        path: vaultFilePath(input.vaultPath),
        content: input.text,
        expectedPrior: input.expectedSha,
        entityId,
        source: 'user',
      },
    ],
    dbOps,
  });

  if (editedBlocks.length > 0) {
    // The edit is kept; the divergence is recorded as a proposal for review.
    for (const block of editedBlocks) {
      ws.db.run(
        'INSERT INTO note_issues (id, path, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)',
        `issue-${sha256Text(`${input.vaultPath}:${block.id}:${block.actualHash}`).slice(0, 24)}`,
        vaultFilePath(input.vaultPath),
        'protected_block_edited',
        JSON.stringify({ blockId: block.id, declaredHash: block.declaredHash, actualHash: block.actualHash }),
        nowIso(),
      );
    }
  }

  recordAudit(ws.db, input.actor ?? 'user', 'note.user_edit', entityId ?? null, {
    path: input.vaultPath,
    editedProtectedBlocks: editedBlocks.map((b) => b.id),
  });
  return { commitId: result.commitId, sha256: sha256Text(input.text) };
}

export function noteHistory(ws: Workspace, vaultPath: string): Record<string, unknown>[] {
  return ws.db.all(
    'SELECT id, revision, sha256, size, source, commit_id, created_at FROM note_revisions WHERE path = ? ORDER BY revision DESC',
    vaultFilePath(vaultPath),
  );
}

export function revisionContent(ws: Workspace, sha256: string): string | undefined {
  const path = join(ws.paths.revisions, sha256.slice(0, 2), `${sha256}.bin`);
  if (!existsSync(path)) return undefined;
  return readFileSync(path, 'utf8');
}

export interface GeneratedSection {
  id: string;
  heading: string;
  content: string;
}

export interface GeneratedNoteInput extends Omit<WriteNoteInput, 'body'> {
  sections: GeneratedSection[];
  /** Heading for the freely editable area kept below the generated sections. */
  userSectionHeading?: string;
  userSectionPlaceholder?: string;
}

export interface ComposedNote {
  vaultPath: string;
  filePath: string;
  text: string;
  sha256: string;
  expectedPrior: string | null;
  dbOps: DbOp[];
  preservedSections: string[];
  frontmatter: Record<string, unknown>;
}

/**
 * Compose a note whose machine-authored parts live in protected blocks, without
 * writing anything.
 *
 * Content the user wrote outside those blocks is carried over untouched, and a
 * block the user edited by hand is preserved and reported rather than replaced.
 * Callers either commit this on its own or fold it into a larger task commit.
 */
export function composeGeneratedNote(ws: Workspace, input: GeneratedNoteInput): ComposedNote {
  const existing = readNoteFile(ws, input.vaultPath);
  const preserved: string[] = [];
  let body: string;

  if (!existing.exists) {
    const parts = input.sections.map(
      (section) => `## ${section.heading}\n\n${renderProtectedBlock(section.id, section.content)}`,
    );
    parts.push(
      `## ${input.userSectionHeading ?? 'User notes'}\n\n${
        input.userSectionPlaceholder ?? 'Manual notes belong here. They are preserved when this note is regenerated.'
      }`,
    );
    body = `${parts.join('\n\n')}\n`;
  } else {
    body = existing.parsed.body;
    for (const section of input.sections) {
      const block = findProtectedBlock(body, section.id);
      if (block?.edited) {
        preserved.push(section.id);
        continue;
      }
      if (!block) {
        body = `${body.replace(/\s*$/, '')}\n\n## ${section.heading}\n\n${renderProtectedBlock(section.id, section.content)}\n`;
      } else {
        body = replaceProtectedBlock(body, section.id, section.content);
      }
    }
  }

  const existingFrontmatter = existing.exists ? (existing.parsed.frontmatter as Record<string, unknown>) : {};
  const revision = Number(existingFrontmatter['revision'] ?? 0) + 1;
  const frontmatter: Record<string, unknown> = {
    schema_version: NOTE_SCHEMA_VERSION,
    ...existingFrontmatter,
    ...input.frontmatter,
    revision,
  };

  const validation = validateFrontmatter(frontmatter);
  if (!validation.ok) {
    throw new AppError('invalid_input', `Note frontmatter failed validation for ${input.vaultPath}`, {
      issues: validation.issues,
    });
  }

  const text = serializeNote(frontmatter, body);
  const sha = sha256Text(text);
  const filePath = vaultFilePath(input.vaultPath);
  const noteType = String(frontmatter['type']);

  const dbOps: DbOp[] = [
    {
      kind: 'note.revision',
      payload: {
        path: filePath,
        entityId: input.entityId ?? frontmatter['id'] ?? null,
        noteType,
        title: frontmatter['title'] ?? null,
        schemaVersion: NOTE_SCHEMA_VERSION,
        sha256: sha,
        size: Buffer.byteLength(text, 'utf8'),
        source: input.source ?? 'worker',
        frontmatter,
        bodyText: body,
        protectedBlocks: protectedBlockMap(body),
        checkedAt: frontmatter['checked_at'] ?? todayIso(),
      },
    },
    ...(input.claims ?? []).map((claim) => ({
      kind: 'claim.upsert' as const,
      payload: {
        entityId: input.entityId ?? frontmatter['id'] ?? null,
        path: filePath,
        claimKey: claim.claimKey,
        claimValue: claim.claimValue ?? null,
        evidenceStatus: claim.evidenceStatus ?? 'unverified',
        sourceId: claim.sourceId ?? null,
        checkedAt: claim.checkedAt ?? todayIso(),
        freshnessClass: claim.freshnessClass ?? 'standard',
      },
    })),
    ...(input.extraDbOps ?? []),
  ];

  return {
    vaultPath: input.vaultPath,
    filePath,
    text,
    sha256: sha,
    expectedPrior: existing.exists ? existing.sha256 : null,
    dbOps,
    preservedSections: preserved,
    frontmatter,
  };
}

export function recordPreservedSections(ws: Workspace, vaultPath: string, sections: string[]): void {
  for (const sectionId of sections) {
    ws.db.run(
      'INSERT INTO note_issues (id, path, kind, detail, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      `issue-${sha256Text(`${vaultPath}:preserved:${sectionId}`).slice(0, 24)}`,
      vaultFilePath(vaultPath),
      'generated_section_preserved',
      JSON.stringify({
        sectionId,
        message: 'A hand-edited generated section was preserved; the new machine output was not applied.',
      }),
      nowIso(),
    );
  }
}

/** Compose and commit a generated note on its own. */
export function writeGeneratedNote(
  ws: Workspace,
  input: GeneratedNoteInput,
): { commitId: string; sha256: string; vaultPath: string; preservedSections: string[] } {
  const composed = composeGeneratedNote(ws, input);
  const result = commitArtifacts(ws, {
    lockKey: input.entityId ?? input.vaultPath,
    description: input.description ?? `write ${input.vaultPath}`,
    entityId: input.entityId ?? null,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    fencingToken: input.fencingToken ?? null,
    scopeId: input.scopeId ?? null,
    scopeVersion: input.scopeVersion ?? null,
    files: [
      {
        path: composed.filePath,
        content: composed.text,
        expectedPrior: input.expectedSha === undefined ? composed.expectedPrior : input.expectedSha,
        entityId: input.entityId,
        noteType: String(composed.frontmatter['type']),
        source: input.source ?? 'worker',
      },
      ...(input.extraFiles ?? []).map((file) => ({
        path: file.path,
        content: file.content,
        expectedPrior: file.expectedPrior,
        source: input.source ?? ('core' as const),
      })),
    ],
    dbOps: composed.dbOps,
  });
  recordPreservedSections(ws, input.vaultPath, composed.preservedSections);
  return {
    commitId: result.commitId,
    sha256: composed.sha256,
    vaultPath: input.vaultPath,
    preservedSections: composed.preservedSections,
  };
}
