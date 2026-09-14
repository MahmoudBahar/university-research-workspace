import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Workspace } from '../workspace.js';
import { AppError } from '../util/errors.js';
import { nextEntityId, opaqueId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { sha256Bytes } from '../util/hash.js';
import { assertPortableFilename, ensureDir, resolveWithin, slugify, toPosix } from '../util/fsx.js';
import { recordAudit, emitEvent } from '../util/events.js';

export type DocumentKind = 'cv' | 'ielts' | 'transcript' | 'graduation_certificate' | 'publication' | 'other';

export interface DocumentRow {
  id: string;
  kind: string;
  display_name: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentVersionRow {
  id: string;
  document_id: string;
  version: number;
  original_filename: string;
  stored_path: string;
  media_type: string | null;
  size: number;
  sha256: string;
  review_state: string;
  imported_at: string;
  note: string | null;
}

const MEDIA_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export interface ImportInput {
  kind: DocumentKind;
  displayName?: string;
  originalFilename: string;
  /** Either raw bytes or a path to read them from. */
  content?: Uint8Array;
  sourcePath?: string;
  note?: string;
  documentId?: string;
  actor?: string;
}

/**
 * Import a private document as a versioned file. Bytes stay under
 * applicant/documents and are addressed by registered id, never by a path the
 * caller supplies later.
 */
export function importDocument(ws: Workspace, input: ImportInput): { documentId: string; version: number; sha256: string } {
  const original = basename(input.originalFilename);
  assertPortableFilename(original);
  const bytes = input.content ?? (input.sourcePath ? readFileSync(input.sourcePath) : undefined);
  if (!bytes) throw new AppError('invalid_input', 'Provide either content or sourcePath', {});
  if (bytes.byteLength === 0) throw new AppError('invalid_input', 'Refusing to import an empty document', { original });

  return ws.db.transaction(() => {
    const documentId = input.documentId ?? nextEntityId(ws.db, 'document');
    const existing = ws.db.get<DocumentRow>('SELECT * FROM documents WHERE id = ?', documentId);
    const now = nowIso();
    if (!existing) {
      ws.db.run(
        'INSERT INTO documents (id, kind, display_name, current_version, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
        documentId,
        input.kind,
        input.displayName ?? original,
        now,
        now,
      );
    }
    const version = (ws.db.get<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM document_versions WHERE document_id = ?', documentId)?.v ?? 0) + 1;
    const extension = extname(original).toLowerCase();
    const safeName = `${slugify(basename(original, extension))}${extension}`;
    const relative = toPosix(join('applicant', 'documents', documentId, `v${version}`, safeName));
    const absolute = join(ws.paths.root, 'applicant', 'documents', documentId, `v${version}`, safeName);
    ensureDir(join(ws.paths.root, 'applicant', 'documents', documentId, `v${version}`));
    writeFileSync(absolute, bytes);

    const sha = sha256Bytes(bytes);
    const versionId = opaqueId('docver');
    ws.db.run(
      `INSERT INTO document_versions (id, document_id, version, original_filename, stored_path, media_type, size, sha256, review_state, imported_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unreviewed', ?, ?)`,
      versionId,
      documentId,
      version,
      original,
      relative,
      MEDIA_TYPES[extension] ?? 'application/octet-stream',
      bytes.byteLength,
      sha,
      now,
      input.note ?? null,
    );
    ws.db.run('UPDATE documents SET current_version = ?, updated_at = ? WHERE id = ?', version, now, documentId);
    recordAudit(ws.db, input.actor ?? 'user', 'document.import', documentId, { version, sha256: sha, original });
    emitEvent(ws.db, 'document:version', documentId, { version });
    return { documentId, version, sha256: sha };
  });
}

export interface DocumentVersionWithExtraction extends DocumentVersionRow {
  extraction: { method: string; status: string; text_path: string | null; page_count: number | null; created_at: string } | null;
}

export function listDocuments(ws: Workspace): (DocumentRow & { versions: DocumentVersionWithExtraction[] })[] {
  const docs = ws.db.all<DocumentRow>('SELECT * FROM documents ORDER BY created_at ASC');
  return docs.map((doc) => ({
    ...doc,
    versions: ws.db
      .all<DocumentVersionRow>('SELECT * FROM document_versions WHERE document_id = ? ORDER BY version ASC', doc.id)
      .map((version) => ({
        ...version,
        extraction:
          ws.db.get<{ method: string; status: string; text_path: string | null; page_count: number | null; created_at: string }>(
            `SELECT method, status, text_path, page_count, created_at FROM document_extractions
             WHERE document_version_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
            version.id,
          ) ?? null,
      })),
  }));
}

export function getDocumentVersion(ws: Workspace, documentId: string, version?: number): DocumentVersionRow {
  const row = version
    ? ws.db.get<DocumentVersionRow>('SELECT * FROM document_versions WHERE document_id = ? AND version = ?', documentId, version)
    : ws.db.get<DocumentVersionRow>(
        'SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC LIMIT 1',
        documentId,
      );
  if (!row) throw new AppError('not_found', `No such document version: ${documentId} v${version ?? 'latest'}`, { documentId, version });
  return row;
}

/** Resolve a registered document version to bytes, refusing anything outside the private directory. */
export function documentBytes(ws: Workspace, documentId: string, version?: number): { row: DocumentVersionRow; bytes: Buffer } {
  const row = getDocumentVersion(ws, documentId, version);
  const absolute = resolveWithin(join(ws.paths.root, 'applicant', 'documents'), row.stored_path.replace(/^applicant\/documents\//, ''));
  if (!existsSync(absolute)) {
    throw new AppError('not_found', `Document bytes are missing for ${documentId} v${row.version}`, { path: row.stored_path });
  }
  return { row, bytes: readFileSync(absolute) };
}

export function setDocumentReviewState(ws: Workspace, documentId: string, version: number, state: 'unreviewed' | 'verified' | 'needs_correction', actor = 'user'): void {
  const row = getDocumentVersion(ws, documentId, version);
  ws.db.run('UPDATE document_versions SET review_state = ? WHERE id = ?', state, row.id);
  recordAudit(ws.db, actor, 'document.review', documentId, { version, state });
}

export interface ExtractionResult {
  status: 'extracted' | 'unavailable' | 'empty';
  method: string;
  textPath: string | null;
  characters: number;
  detail: string;
}

export const EXTRACTION_HINT = 'Run /import-document <id> so Claude reads it, or paste the text in the Applicant screen.';

/**
 * Deterministic text extraction covers plain text and Markdown only. A PDF or
 * any other binary is recorded as `unavailable`: the text for those comes from
 * a person or from Claude reading the file, through `recordExternalExtraction`,
 * with the method recorded as provenance. Nothing is ever invented.
 */
export function extractDocumentText(ws: Workspace, documentId: string, version?: number): ExtractionResult {
  const row = getDocumentVersion(ws, documentId, version);
  const absolute = join(ws.paths.root, ...row.stored_path.split('/'));
  const extension = extname(row.original_filename).toLowerCase();

  if (extension === '.txt' || extension === '.md') {
    const text = readFileSync(absolute, 'utf8');
    return storeExtraction(ws, row, documentId, { text, method: 'utf8_read', pageCount: null, detail: '' });
  }
  const detail = `No text extractor runs for ${extension || 'this file type'} on this machine. ${EXTRACTION_HINT.replace('<id>', documentId)}`;
  return storeExtraction(ws, row, documentId, { text: null, method: 'none', pageCount: null, detail });
}

export interface ExternalExtractionInput {
  documentId: string;
  version?: number;
  /** The verbatim text as read; it is stored as data and never interpreted. */
  text: string;
  method: 'claude_read' | 'manual_paste';
  pageCount?: number;
  detail?: string;
  actor?: string;
}

/**
 * Ingress for text produced outside this process: Claude reading the document
 * with its Read tool, or a person pasting it. The document version stays
 * `unreviewed` until someone verifies the text against the original.
 */
export function recordExternalExtraction(ws: Workspace, input: ExternalExtractionInput): ExtractionResult {
  if (input.text.trim().length === 0) {
    throw new AppError('invalid_input', 'Extracted text is empty; record the document as unreadable instead of storing nothing.', {
      documentId: input.documentId,
    });
  }
  if (input.method !== 'claude_read' && input.method !== 'manual_paste') {
    throw new AppError('invalid_input', `Unknown extraction method: ${String(input.method)}`, {});
  }
  const row = getDocumentVersion(ws, input.documentId, input.version);
  const result = storeExtraction(ws, row, input.documentId, {
    text: input.text,
    method: input.method,
    pageCount: input.pageCount ?? null,
    detail: input.detail ?? '',
  });
  recordAudit(ws.db, input.actor ?? 'user', 'document.extract_external', input.documentId, {
    version: row.version,
    method: input.method,
    characters: input.text.length,
    pageCount: input.pageCount ?? null,
  });
  emitEvent(ws.db, 'document:extracted', input.documentId, { version: row.version, method: input.method });
  return result;
}

export interface UnavailableExtractionInput {
  documentId: string;
  version?: number;
  method?: 'claude_read' | 'manual_paste' | 'none';
  /** Why the document could not be read, e.g. image-only scan. Stored verbatim. */
  detail: string;
  actor?: string;
}

/**
 * Record that a document could not be read (an image-only scan, a corrupt
 * file) without storing any text. The reason is the finding; nothing is
 * guessed in its place.
 */
export function recordUnavailableExtraction(ws: Workspace, input: UnavailableExtractionInput): ExtractionResult {
  if (input.detail.trim().length === 0) {
    throw new AppError('invalid_input', 'Say why the document could not be read.', { documentId: input.documentId });
  }
  const row = getDocumentVersion(ws, input.documentId, input.version);
  const method = input.method ?? 'none';
  const result = storeExtraction(ws, row, input.documentId, { text: null, method, pageCount: null, detail: input.detail });
  recordAudit(ws.db, input.actor ?? 'user', 'document.extract_unavailable', input.documentId, {
    version: row.version,
    method,
    detail: input.detail,
  });
  emitEvent(ws.db, 'document:extraction_unavailable', input.documentId, { version: row.version, method });
  return result;
}

function storeExtraction(
  ws: Workspace,
  row: DocumentVersionRow,
  documentId: string,
  input: { text: string | null; method: string; pageCount: number | null; detail: string },
): ExtractionResult {
  const outRelative = toPosix(join('applicant', 'extracted', `${documentId}-v${row.version}.txt`));
  const outAbsolute = join(ws.paths.root, 'applicant', 'extracted', `${documentId}-v${row.version}.txt`);
  ensureDir(join(ws.paths.root, 'applicant', 'extracted'));
  const text = input.text;
  const status: ExtractionResult['status'] = text === null ? 'unavailable' : text.trim().length === 0 ? 'empty' : 'extracted';
  if (text !== null) {
    writeFileSync(outAbsolute, text, 'utf8');
  }
  ws.db.run(
    `INSERT INTO document_extractions (id, document_version_id, method, status, text_path, page_count, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    opaqueId('extract'),
    row.id,
    input.method,
    status,
    text === null ? null : outRelative,
    input.pageCount,
    input.detail || null,
    nowIso(),
  );
  return {
    status,
    method: input.method,
    textPath: text === null ? null : outRelative,
    characters: text?.length ?? 0,
    detail:
      input.detail ||
      (status === 'extracted'
        ? 'Extracted text is unverified until a person confirms it against the original.'
        : 'No text was produced.'),
  };
}

export function listExtractions(ws: Workspace, documentId: string): Record<string, unknown>[] {
  return ws.db.all(
    `SELECT x.*, v.version FROM document_extractions x JOIN document_versions v ON v.id = x.document_version_id
     WHERE v.document_id = ? ORDER BY x.created_at DESC`,
    documentId,
  );
}

export interface FactInput {
  documentId?: string;
  version?: number;
  factKey: string;
  factValue: string;
  page?: number;
  entryMethod?: 'extracted' | 'manual';
  actor?: string;
}

export function recordExtractedFact(ws: Workspace, input: FactInput): { id: string } {
  const versionRow = input.documentId ? getDocumentVersion(ws, input.documentId, input.version) : undefined;
  const id = opaqueId('fact');
  ws.db.run(
    `INSERT INTO extracted_facts (id, document_version_id, fact_key, fact_value, page, verification_status, entry_method, created_at)
     VALUES (?, ?, ?, ?, ?, 'unverified', ?, ?)`,
    id,
    versionRow?.id ?? null,
    input.factKey,
    input.factValue,
    input.page ?? null,
    input.entryMethod ?? 'manual',
    nowIso(),
  );
  recordAudit(ws.db, input.actor ?? 'user', 'applicant.fact_recorded', input.documentId ?? null, {
    factKey: input.factKey,
    entryMethod: input.entryMethod ?? 'manual',
  });
  return { id };
}

export function listExtractedFacts(ws: Workspace): Record<string, unknown>[] {
  return ws.db.all(
    `SELECT f.*, v.document_id, v.version, v.original_filename
     FROM extracted_facts f LEFT JOIN document_versions v ON v.id = f.document_version_id
     ORDER BY f.created_at DESC`,
  );
}

export function verifyFact(ws: Workspace, factId: string, status: 'verified' | 'rejected' | 'unverified', actor = 'user'): void {
  ws.db.run('UPDATE extracted_facts SET verification_status = ? WHERE id = ?', status, factId);
  recordAudit(ws.db, actor, 'applicant.fact_verified', null, { factId, status });
}

export function documentSizeOnDisk(ws: Workspace, documentId: string, version: number): number {
  const row = getDocumentVersion(ws, documentId, version);
  const absolute = join(ws.paths.root, ...row.stored_path.split('/'));
  return existsSync(absolute) ? statSync(absolute).size : 0;
}
