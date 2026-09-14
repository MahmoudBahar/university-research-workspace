import { basename } from 'node:path';
import {
  approveApplicantRevision,
  createBackup,
  extractDocumentText,
  importDocument,
  latestApplicantRevision,
  listBackups,
  listDocuments,
  listExtractedFacts,
  listOverrides,
  readApplicantFile,
  recordExtractedFact,
  recordExternalExtraction,
  recordUnavailableExtraction,
  restoreBackup,
  setDocumentReviewState,
  snapshotApplicantRevision,
  verifyFact,
  writeApplicantFile,
  listDuplicateCandidates,
  mergeEntities,
  openIssues,
  resolveIssue,
  applyUserEdit,
  readNoteFile,
  noteHistory,
  findWorkspaceRoot,
} from '@urw/core';
import { readFileSync } from 'node:fs';
import type { CommandSpec } from '../context.js';
import { emit, table, truncate } from '../output.js';
import { flagBool, flagNumber, flagString, requireFlag } from '../args.js';

export const applicantCommands: Record<string, CommandSpec> = {
  'applicant show': {
    summary: 'Show applicant profile and style files with their revision state.',
    usage: 'applicant show [--kind profile|style] [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const kinds = flagString(ctx.args, 'kind') ? [flagString(ctx.args, 'kind') as 'profile' | 'style'] : (['profile', 'style'] as const);
      const data = kinds.map((kind) => {
        const file = readApplicantFile(ws, kind);
        const revision = latestApplicantRevision(ws, kind);
        return {
          kind,
          path: file.path,
          sha256: file.sha256,
          revision: revision?.revision ?? 0,
          approved: revision?.approved_at ?? null,
          approvedMatchesFile: revision ? revision.sha256 === file.sha256 && Boolean(revision.approved_at) : false,
          characters: file.text.length,
        };
      });
      emit(
        ctx.out,
        table(
          data.map((d) => ({ kind: d.kind, path: d.path, revision: d.revision, approved: d.approved ?? 'no', sha: truncate(d.sha256, 12) })),
          ['kind', 'path', 'revision', 'approved', 'sha'],
        ),
        { files: data, overrides: listOverrides(ws) },
      );
    },
  },

  'applicant write': {
    summary: 'Replace an applicant file from a local file and snapshot a revision.',
    usage: 'applicant write --kind profile|style|override [--name <override>] --file <path> [--expect-sha <sha>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const text = readFileSync(requireFlag(ctx.args, 'file'), 'utf8');
      const result = writeApplicantFile(ws, requireFlag(ctx.args, 'kind') as 'profile' | 'style' | 'override', text, {
        name: flagString(ctx.args, 'name'),
        expectedSha: flagString(ctx.args, 'expectSha'),
        actor: 'user',
      });
      emit(ctx.out, `Wrote ${result.path} as revision ${result.revision} (${result.sha256}).`, result);
    },
  },

  'applicant approve': {
    summary: 'Approve the exact applicant revision that email drafting may cite.',
    usage: 'applicant approve --kind profile|style --sha <sha256>',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const revision = approveApplicantRevision(ws, requireFlag(ctx.args, 'kind') as 'profile' | 'style', requireFlag(ctx.args, 'sha'), {
        name: flagString(ctx.args, 'name'),
        actor: 'user',
      });
      emit(ctx.out, `Approved revision ${revision.revision} at ${revision.approved_at}.`, revision);
    },
  },

  'applicant snapshot': {
    summary: 'Record the current applicant file bytes as an unapproved revision.',
    usage: 'applicant snapshot --kind profile|style [--name <override>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const revision = snapshotApplicantRevision(ws, requireFlag(ctx.args, 'kind') as 'profile' | 'style', flagString(ctx.args, 'name'));
      emit(ctx.out, `Revision ${revision.revision} (${revision.sha256}).`, revision);
    },
  },

  'documents import': {
    summary: 'Import a private document as a versioned file with an id and hash.',
    usage: 'documents import --kind cv|ielts|transcript|graduation_certificate|other --file <path> [--name <display>] [--document <existing-id>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const file = requireFlag(ctx.args, 'file');
      const result = importDocument(ws, {
        kind: requireFlag(ctx.args, 'kind') as never,
        originalFilename: basename(file),
        sourcePath: file,
        displayName: flagString(ctx.args, 'name'),
        documentId: flagString(ctx.args, 'document'),
        note: flagString(ctx.args, 'note'),
        actor: 'user',
      });
      emit(ctx.out, `Imported ${result.documentId} version ${result.version} (sha256 ${result.sha256}).`, result);
    },
  },

  'documents list': {
    summary: 'List imported documents and their versions.',
    usage: 'documents list [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const docs = listDocuments(ws);
      emit(
        ctx.out,
        table(
          docs.flatMap((doc) =>
            doc.versions.map((version) => ({
              id: doc.id,
              kind: doc.kind,
              name: truncate(doc.display_name, 26),
              version: version.version,
              review: version.review_state,
              sha: truncate(version.sha256, 12),
            })),
          ),
          ['id', 'kind', 'name', 'version', 'review', 'sha'],
        ),
        docs,
      );
    },
  },

  'documents extract': {
    summary:
      'Record extracted text for a document version: built-in for .txt/.md, or text supplied with --text-file (Claude reading it, or a paste), or --status unavailable with the reason.',
    usage:
      'documents extract --document <id> [--version <n>] [--text-file <path> --method claude_read|manual_paste [--pages <n>]] [--status unavailable --detail "<reason>" [--method claude_read]]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const documentId = requireFlag(ctx.args, 'document');
      const version = flagNumber(ctx.args, 'version');
      const textFile = flagString(ctx.args, 'textFile');
      const status = flagString(ctx.args, 'status');
      const method = flagString(ctx.args, 'method');
      let result;
      if (status === 'unavailable') {
        result = recordUnavailableExtraction(ws, {
          documentId,
          version,
          method: (method as 'claude_read' | 'manual_paste' | 'none' | undefined) ?? 'none',
          detail: flagString(ctx.args, 'detail') ?? '',
          actor: 'user',
        });
      } else if (textFile) {
        if (method !== 'claude_read' && method !== 'manual_paste') {
          throw new Error('--text-file needs --method claude_read or manual_paste so the provenance is recorded.');
        }
        result = recordExternalExtraction(ws, {
          documentId,
          version,
          text: readFileSync(textFile, 'utf8'),
          method,
          pageCount: flagNumber(ctx.args, 'pages'),
          detail: flagString(ctx.args, 'detail'),
          actor: 'user',
        });
      } else {
        result = extractDocumentText(ws, documentId, version);
      }
      emit(
        ctx.out,
        [`Status: ${result.status} via ${result.method}`, result.textPath ? `Text: ${result.textPath} (${result.characters} characters)` : 'No text file produced.', result.detail],
        result,
      );
    },
  },

  'documents review': {
    summary: 'Set the review state of a document version.',
    usage: 'documents review --document <id> --version <n> --state unreviewed|verified|needs_correction',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      setDocumentReviewState(
        ws,
        requireFlag(ctx.args, 'document'),
        Number(requireFlag(ctx.args, 'version')),
        requireFlag(ctx.args, 'state') as never,
      );
      emit(ctx.out, 'Review state updated.', { ok: true });
    },
  },

  'facts add': {
    summary: 'Record an applicant fact with its source reference and verification status.',
    usage: 'facts add --key <name> --value <text> [--document <id>] [--version <n>] [--page <n>] [--method extracted|manual]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = recordExtractedFact(ws, {
        factKey: requireFlag(ctx.args, 'key'),
        factValue: requireFlag(ctx.args, 'value'),
        documentId: flagString(ctx.args, 'document'),
        version: flagNumber(ctx.args, 'version'),
        page: flagNumber(ctx.args, 'page'),
        entryMethod: (flagString(ctx.args, 'method') as 'extracted' | 'manual') ?? 'manual',
        actor: 'user',
      });
      emit(ctx.out, `Recorded fact ${result.id} as unverified.`, result);
    },
  },

  'facts list': {
    summary: 'List recorded applicant facts and their verification status.',
    usage: 'facts list [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = listExtractedFacts(ws);
      emit(ctx.out, table(rows, ['id', 'fact_key', 'fact_value', 'document_id', 'version', 'page', 'verification_status', 'entry_method']), rows);
    },
  },

  'facts verify': {
    summary: 'Mark a recorded fact verified, rejected or unverified.',
    usage: 'facts verify --fact <id> --status verified|rejected|unverified',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      verifyFact(ws, requireFlag(ctx.args, 'fact'), requireFlag(ctx.args, 'status') as never);
      emit(ctx.out, 'Fact status updated.', { ok: true });
    },
  },

  'notes issues': {
    summary: 'List open note issues such as invalid frontmatter or edited generated sections.',
    usage: 'notes issues [--resolve <id>] [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const resolve = flagString(ctx.args, 'resolve');
      if (resolve) {
        resolveIssue(ws, resolve);
        emit(ctx.out, 'Issue resolved.', { ok: true });
        return;
      }
      const rows = openIssues(ws);
      emit(ctx.out, table(rows, ['id', 'path', 'kind', 'created_at']), rows);
    },
  },

  'notes show': {
    summary: 'Print a note with its current hash so an edit can be submitted safely.',
    usage: 'notes show --path <vault-relative path> [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const note = readNoteFile(ws, requireFlag(ctx.args, 'path'));
      emit(ctx.out, [`sha256: ${note.sha256}`, '', note.text], {
        path: note.vaultPath,
        sha256: note.sha256,
        exists: note.exists,
        frontmatter: note.parsed.frontmatter,
        text: note.text,
      });
    },
  },

  'notes write': {
    summary: 'Apply a hand-edited note through the core, with an optimistic hash check.',
    usage: 'notes write --path <vault path> --file <local file> --expect-sha <sha>',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = applyUserEdit(ws, {
        vaultPath: requireFlag(ctx.args, 'path'),
        text: readFileSync(requireFlag(ctx.args, 'file'), 'utf8'),
        expectedSha: requireFlag(ctx.args, 'expectSha'),
        actor: 'user',
      });
      emit(ctx.out, `Saved. New hash ${result.sha256} (commit ${result.commitId}).`, result);
    },
  },

  'notes history': {
    summary: 'Show committed revisions of a note.',
    usage: 'notes history --path <vault path> [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = noteHistory(ws, requireFlag(ctx.args, 'path'));
      emit(ctx.out, table(rows, ['revision', 'sha256', 'size', 'source', 'created_at']), rows);
    },
  },

  'entities duplicates': {
    summary: 'List unresolved duplicate candidates.',
    usage: 'entities duplicates [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = listDuplicateCandidates(ws);
      emit(ctx.out, table(rows, ['id', 'entity_id', 'entity_title', 'other_entity_id', 'other_title', 'reason', 'confidence']), rows);
    },
  },

  'entities merge': {
    summary: 'Merge one entity into another, moving aliases and relationships.',
    usage: 'entities merge --keep <id> --merge <id> --reason <text>',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = mergeEntities(ws, requireFlag(ctx.args, 'keep'), requireFlag(ctx.args, 'merge'), requireFlag(ctx.args, 'reason'));
      emit(ctx.out, `Merged ${result.mergedId} into ${result.keptId}; moved ${result.movedRelationships} relationship(s).`, result);
    },
  },

  'backup create': {
    summary: 'Create a consistent backup of the database, notes, applicant files and revisions.',
    usage: 'backup create [--label <text>] [--target <dir>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = await createBackup(ws, { label: flagString(ctx.args, 'label'), target: flagString(ctx.args, 'target') });
      emit(
        ctx.out,
        [`Backup written to ${result.path}`, `Contents: ${result.manifest.contents.join(', ')}`, `Database sha256: ${result.manifest.databaseSha256}`],
        result,
      );
    },
  },

  'backup list': {
    summary: 'List available backups.',
    usage: 'backup list [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = listBackups(ws).map((entry) => ({
        path: entry.path,
        createdAt: entry.manifest?.createdAt ?? '',
        label: entry.manifest?.label ?? '',
        files: entry.manifest?.fileCount ?? 0,
      }));
      emit(ctx.out, table(rows, ['path', 'createdAt', 'label', 'files']), rows);
    },
  },

  'backup restore': {
    summary: 'Restore a backup into this workspace. Closes the database first.',
    usage: 'backup restore --from <backup dir> [--force]',
    handler: async (ctx) => {
      const root = flagString(ctx.args, 'root') ?? findWorkspaceRoot();
      ctx.close();
      const report = restoreBackup(root, requireFlag(ctx.args, 'from'), { force: flagBool(ctx.args, 'force') });
      emit(
        ctx.out,
        [
          `Database restored: ${report.databaseRestored ? 'yes' : 'no'}`,
          `Restored: ${report.restored.join(', ') || 'nothing'}`,
          ...report.warnings.map((warning) => `Warning: ${warning}`),
        ],
        report,
      );
    },
  },
};
