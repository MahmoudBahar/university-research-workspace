import { Router } from 'express';
import { z } from 'zod';
import {
  approveApplicantRevision,
  documentBytes,
  extractDocumentText,
  importDocument,
  latestApplicantRevision,
  listDocuments,
  listExtractedFacts,
  listOverrides,
  readApplicantFile,
  recordExtractedFact,
  recordExternalExtraction,
  recordUnavailableExtraction,
  setDocumentReviewState,
  verifyFact,
  writeApplicantFile,
  type Workspace,
} from '@urw/core';
import { parseBody, parseQuery, route } from '../http.js';

const KindSchema = z.enum(['profile', 'style', 'override']);

export function applicantRoutes(ws: Workspace): Router {
  const router = Router();

  router.get(
    '/applicant',
    route(() => {
      const files = (['profile', 'style'] as const).map((kind) => {
        const file = readApplicantFile(ws, kind);
        const revision = latestApplicantRevision(ws, kind);
        return {
          kind,
          path: file.path,
          text: file.text,
          sha256: file.sha256,
          revision: revision?.revision ?? 0,
          approvedAt: revision?.approved_at ?? null,
          approvedMatchesFile: Boolean(revision?.approved_at) && revision?.sha256 === file.sha256,
        };
      });
      return { files, overrides: listOverrides(ws) };
    }),
  );

  router.get(
    '/applicant/override',
    route((req) => {
      const query = parseQuery(z.object({ name: z.string().min(1).max(120) }), req);
      const file = readApplicantFile(ws, 'override', query.name);
      return { ...file, name: query.name };
    }),
  );

  router.put(
    '/applicant/:kind',
    route((req) => {
      const kind = KindSchema.parse(req.params['kind']);
      const body = parseBody(
        z.object({ text: z.string().max(500_000), expectedSha: z.string().optional(), name: z.string().max(120).optional() }),
        req,
      );
      return writeApplicantFile(ws, kind, body.text, { name: body.name, expectedSha: body.expectedSha, actor: 'user' });
    }),
  );

  router.post(
    '/applicant/:kind/approve',
    route((req) => {
      const kind = z.enum(['profile', 'style']).parse(req.params['kind']);
      const body = parseBody(z.object({ sha256: z.string().length(64) }), req);
      return approveApplicantRevision(ws, kind, body.sha256, { actor: 'user' });
    }),
  );

  router.get('/documents', route(() => ({ documents: listDocuments(ws), facts: listExtractedFacts(ws) })));

  router.post(
    '/documents',
    route((req) => {
      const body = parseBody(
        z.object({
          kind: z.enum(['cv', 'ielts', 'transcript', 'graduation_certificate', 'publication', 'other']),
          originalFilename: z.string().min(1).max(120),
          displayName: z.string().max(200).optional(),
          note: z.string().max(1000).optional(),
          documentId: z.string().optional(),
          /** Base64 payload. The API never reads an arbitrary path from the caller. */
          contentBase64: z.string().min(4).max(40_000_000),
        }),
        req,
      );
      const content = Buffer.from(body.contentBase64, 'base64');
      return importDocument(ws, {
        kind: body.kind,
        originalFilename: body.originalFilename,
        displayName: body.displayName,
        note: body.note,
        documentId: body.documentId,
        content,
        actor: 'user',
      });
    }),
  );

  router.get(
    '/documents/:id/content',
    route((req, res) => {
      const query = parseQuery(z.object({ version: z.coerce.number().int().optional() }), req);
      const { row, bytes } = documentBytes(ws, String(req.params['id']), query.version);
      res.setHeader('Content-Type', row.media_type ?? 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${row.original_filename.replace(/["\\]/g, '')}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    }),
  );

  router.post(
    '/documents/:id/extract',
    route((req) => {
      const body = parseBody(
        z.object({
          version: z.number().int().optional(),
          /** Text produced outside the server: a person pasting it, or Claude reading the file. */
          text: z.string().max(2_000_000).optional(),
          method: z.enum(['manual_paste', 'claude_read']).optional(),
          pageCount: z.number().int().min(0).optional(),
          /** `unavailable` records that the document could not be read, with the reason in `detail`. */
          status: z.enum(['unavailable']).optional(),
          detail: z.string().max(2000).optional(),
        }),
        req,
      );
      const documentId = String(req.params['id']);
      if (body.status === 'unavailable') {
        return recordUnavailableExtraction(ws, {
          documentId,
          version: body.version,
          method: body.method ?? 'none',
          detail: body.detail ?? '',
          actor: 'user',
        });
      }
      if (body.text !== undefined) {
        return recordExternalExtraction(ws, {
          documentId,
          version: body.version,
          text: body.text,
          method: body.method ?? 'manual_paste',
          pageCount: body.pageCount,
          detail: body.detail,
          actor: 'user',
        });
      }
      return extractDocumentText(ws, documentId, body.version);
    }),
  );

  router.post(
    '/documents/:id/review',
    route((req) => {
      const body = parseBody(
        z.object({ version: z.number().int(), state: z.enum(['unreviewed', 'verified', 'needs_correction']) }),
        req,
      );
      setDocumentReviewState(ws, String(req.params['id']), body.version, body.state, 'user');
      return { ok: true };
    }),
  );

  router.post(
    '/facts',
    route((req) => {
      const body = parseBody(
        z.object({
          factKey: z.string().min(1).max(120),
          factValue: z.string().max(2000),
          documentId: z.string().optional(),
          version: z.number().int().optional(),
          page: z.number().int().optional(),
          entryMethod: z.enum(['extracted', 'manual']).default('manual'),
        }),
        req,
      );
      return recordExtractedFact(ws, { ...body, actor: 'user' });
    }),
  );

  router.post(
    '/facts/:id/verify',
    route((req) => {
      const body = parseBody(z.object({ status: z.enum(['verified', 'rejected', 'unverified']) }), req);
      verifyFact(ws, String(req.params['id']), body.status, 'user');
      return { ok: true };
    }),
  );

  return router;
}
