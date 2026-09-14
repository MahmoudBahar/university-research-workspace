import { Router } from 'express';
import { z } from 'zod';
import {
  activeSendPlan,
  approvalHistory,
  approveDraft,
  archiveDraft,
  correctSentRecord,
  currentApproval,
  getOutreach,
  listOutreach,
  markSent,
  readDraft,
  readNoteFile,
  reconcileDraft,
  returnToDraft,
  sendPlanner,
  sentHistory,
  sentSnapshotText,
  setSendPlan,
  suggestPlan,
  unarchiveDraft,
  updateDraft,
  validateDraftPackage,
  displayZone,
  AppError,
  type Workspace,
} from '@urw/core';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBody, parseQuery, route } from '../http.js';

export function outreachRoutes(ws: Workspace): Router {
  const router = Router();

  router.get(
    '/outreach',
    route((req) => {
      const query = parseQuery(
        z.object({ state: z.string().optional(), person: z.string().optional(), university: z.string().min(1).max(200).optional() }),
        req,
      );
      return listOutreach(ws, { state: query.state, personId: query.person, universityId: query.university });
    }),
  );

  router.get(
    '/outreach/:id',
    route((req) => {
      const id = String(req.params['id']);
      reconcileDraft(ws, id);
      const row = getOutreach(ws, id);
      const content = readDraft(ws, id);
      const note = readNoteFile(ws, content.vaultPath);
      const brief = readNoteFile(ws, row.brief_path.replace(/^vault\//, ''));
      return {
        outreach: row,
        content,
        noteSha256: note.sha256,
        noteText: note.text,
        brief: brief.exists ? brief.text : null,
        approval: currentApproval(ws, id) ?? null,
        approvals: approvalHistory(ws, id),
        plan: activeSendPlan(ws, id) ?? null,
        sent: sentHistory(ws, id),
        revisions: ws.db.all(
          'SELECT revision, recipient, subject, fingerprint, source, created_at FROM outreach_revisions WHERE outreach_id = ? ORDER BY revision DESC',
          id,
        ),
      };
    }),
  );

  router.get(
    '/outreach/:id/revisions/:revision',
    route((req) => {
      const id = String(req.params['id']);
      const revision = z.coerce.number().int().min(1).parse(req.params['revision']);
      const row = ws.db.get<{
        revision: number;
        recipient: string;
        subject: string;
        body_path: string;
        fingerprint: string;
        source: string;
        created_at: string;
      }>('SELECT revision, recipient, subject, body_path, fingerprint, source, created_at FROM outreach_revisions WHERE outreach_id = ? AND revision = ?', id, revision);
      if (!row) throw new AppError('not_found', `No revision ${revision} for ${id}`, { outreachId: id, revision });
      const absolute = join(ws.paths.root, ...row.body_path.split('/'));
      const body = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
      return {
        revision: row.revision,
        recipient: row.recipient,
        subject: row.subject,
        body,
        fingerprint: row.fingerprint,
        source: row.source,
        created_at: row.created_at,
      };
    }),
  );

  router.put(
    '/outreach/:id',
    route((req) => {
      const body = parseBody(
        z.object({
          expectedSha: z.string().min(16),
          recipient: z.string().max(320).optional(),
          subject: z.string().max(500).optional(),
          body: z.string().max(100_000).optional(),
          attachments: z.array(z.object({ document_id: z.string(), version: z.number().int().optional() })).optional(),
        }),
        req,
      );
      return updateDraft(ws, { outreachId: String(req.params['id']), ...body, actor: 'user' });
    }),
  );

  router.post('/outreach/:id/validate', route((req) => validateDraftPackage(ws, String(req.params['id']))));

  router.post(
    '/outreach/:id/approve',
    route((req) => {
      const body = parseBody(z.object({ fingerprint: z.string().length(64), note: z.string().max(500).optional() }), req);
      return approveDraft(ws, {
        outreachId: String(req.params['id']),
        expectedFingerprint: body.fingerprint,
        note: body.note,
        actor: 'user',
      });
    }),
  );

  router.post(
    '/outreach/:id/return',
    route((req) => {
      const body = parseBody(z.object({ reason: z.string().min(3).max(500) }), req);
      returnToDraft(ws, String(req.params['id']), body.reason);
      return { ok: true };
    }),
  );

  router.post(
    '/outreach/:id/archive',
    route((req) => {
      const body = parseBody(z.object({ reason: z.string().min(3).max(500), undo: z.boolean().default(false) }), req);
      if (body.undo) unarchiveDraft(ws, String(req.params['id']));
      else archiveDraft(ws, String(req.params['id']), body.reason);
      return { ok: true };
    }),
  );

  router.get('/outreach/:id/suggest-time', route((req) => suggestPlan(ws, String(req.params['id']))));

  router.put(
    '/outreach/:id/send-plan',
    route((req) => {
      const body = parseBody(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          zone: z.string().optional(),
          occurrence: z.enum(['earlier', 'later']).optional(),
          note: z.string().max(500).optional(),
        }),
        req,
      );
      return setSendPlan(ws, {
        outreachId: String(req.params['id']),
        date: body.date,
        time: body.time,
        zone: body.zone,
        disambiguation: body.occurrence,
        note: body.note,
        actor: 'user',
      });
    }),
  );

  router.get(
    '/send-plans',
    route((req) => {
      const query = parseQuery(z.object({ university: z.string().min(1).max(200).optional() }), req);
      return { displayZone: displayZone(ws), rows: sendPlanner(ws, new Date(), { universityId: query.university }) };
    }),
  );

  router.post(
    '/outreach/:id/mark-sent',
    route((req) => {
      const body = parseBody(
        z.object({
          idempotencyKey: z.string().min(8).max(200),
          sentAt: z.string().optional(),
          messageReference: z.string().max(500).optional(),
          note: z.string().max(1000).optional(),
          allowUnapproved: z.boolean().default(false),
        }),
        req,
      );
      return markSent(ws, { outreachId: String(req.params['id']), ...body, actor: 'user' });
    }),
  );

  router.get(
    '/sent',
    route((req) => {
      const query = parseQuery(z.object({ university: z.string().min(1).max(200).optional() }), req);
      return sentHistory(ws, undefined, { universityId: query.university });
    }),
  );

  router.get(
    '/sent/:id/snapshot',
    route((req) => ({ text: sentSnapshotText(ws, String(req.params['id'])) })),
  );

  router.post(
    '/sent/:id/correct',
    route((req) => {
      const body = parseBody(
        z.object({ field: z.string().min(1).max(80), value: z.string().max(1000), reason: z.string().min(3).max(500) }),
        req,
      );
      return correctSentRecord(ws, String(req.params['id']), { ...body, actor: 'user' });
    }),
  );

  return router;
}
