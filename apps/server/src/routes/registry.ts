import { Router } from 'express';
import { z } from 'zod';
import {
  checkLinks,
  createBackup,
  generateViews,
  getEntity,
  listBackups,
  listDuplicateCandidates,
  mergeEntities,
  nextActions,
  personSourceMap,
  readNoteFile,
  reconcileVault,
  scopeSummary,
  unitTree,
  workspaceStatus,
  confirmSelection,
  currentScopeVersion,
  enqueueScopedWork,
  getScope,
  getScopeForUniversity,
  updateSelection,
  applyUserEdit,
  noteHistory,
  openIssues,
  resolveIssue,
  evaluateEmailReadiness,
  unitProgress,
  bind,
  personInUniversity,
  labInUniversity,
  entityInUniversity,
  type Workspace,
} from '@urw/core';
import { parseBody, parseQuery, route } from '../http.js';

const University = z.string().min(1).max(200).optional();

export function registryRoutes(ws: Workspace): Router {
  const router = Router();

  router.get('/status', route(() => ({ status: workspaceStatus(ws), actions: nextActions(ws) })));

  router.get(
    '/universities',
    route(() => {
      const rows = ws.db.all<{ entity_id: string; official_name: string; domain: string | null; homepage_url: string | null }>(
        'SELECT entity_id, official_name, domain, homepage_url FROM universities ORDER BY official_name',
      );
      return rows.map((row) => {
        const scope = getScopeForUniversity(ws, row.entity_id);
        return {
          id: row.entity_id,
          name: row.official_name,
          domain: row.domain,
          homepage: row.homepage_url,
          notePath: getEntity(ws, row.entity_id)?.canonical_path ?? null,
          scope: scope ? scopeSummary(ws, scope.id) : null,
          unitCount: ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academic_units WHERE university_id = ?', row.entity_id)?.n ?? 0,
        };
      });
    }),
  );

  router.get(
    '/entities/:id',
    route((req) => {
      const id = String(req.params['id']);
      const entity = getEntity(ws, id);
      if (!entity) return { error: 'not_found' };
      return {
        entity,
        aliases: ws.db.all('SELECT anchor_kind, anchor_value, strength FROM entity_aliases WHERE entity_id = ?', id),
        relationships: ws.db.all(
          `SELECT r.*, a.display_title AS from_title, b.display_title AS to_title
           FROM relationships r
           LEFT JOIN entities a ON a.id = r.from_id
           LEFT JOIN entities b ON b.id = r.to_id
           WHERE r.from_id = ? OR r.to_id = ?`,
          id,
          id,
        ),
      };
    }),
  );

  router.get(
    '/relationships',
    route((req) => {
      const query = parseQuery(
        z.object({ entity: z.string().optional(), limit: z.coerce.number().int().max(2000).default(500), university: University }),
        req,
      );
      if (query.entity) {
        return ws.db.all(
          `SELECT r.*, a.display_title AS from_title, a.kind AS from_kind, b.display_title AS to_title, b.kind AS to_kind
           FROM relationships r
           LEFT JOIN entities a ON a.id = r.from_id
           LEFT JOIN entities b ON b.id = r.to_id
           WHERE r.from_id = ? OR r.to_id = ? LIMIT ?`,
          query.entity,
          query.entity,
          query.limit,
        );
      }
      const from = query.university ? entityInUniversity('r.from_id') : null;
      const to = query.university ? entityInUniversity('r.to_id') : null;
      return ws.db.all(
        `SELECT r.*, a.display_title AS from_title, a.kind AS from_kind, b.display_title AS to_title, b.kind AS to_kind
         FROM relationships r
         LEFT JOIN entities a ON a.id = r.from_id
         LEFT JOIN entities b ON b.id = r.to_id
         ${from && to ? `WHERE (${from.sql} OR ${to.sql})` : ''}
         ORDER BY r.updated_at DESC LIMIT ?`,
        ...(from && to && query.university ? [...bind(from, query.university), ...bind(to, query.university)] : []),
        query.limit,
      );
    }),
  );

  router.get(
    '/units/progress',
    route((req) => {
      const query = parseQuery(z.object({ university: z.string().min(1).max(200) }), req);
      return { units: unitProgress(ws, query.university) };
    }),
  );

  router.get(
    '/units',
    route((req) => {
      const query = parseQuery(z.object({ university: z.string() }), req);
      const scope = getScopeForUniversity(ws, query.university);
      const draft = scope
        ? ws.db.get<{ id: string; version: number }>(
            "SELECT id, version FROM scope_versions WHERE scope_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1",
            scope.id,
          )
        : undefined;
      const versionId = draft?.id ?? (scope ? currentScopeVersion(ws, scope.id).id : undefined);
      return {
        scope: scope ? scopeSummary(ws, scope.id) : null,
        draftVersion: draft?.version ?? null,
        tree: unitTree(ws, query.university, versionId),
      };
    }),
  );

  router.put(
    '/scopes/:id/selection',
    route((req) => {
      const body = parseBody(
        z.object({
          expectedVersion: z.number().int().min(0),
          decisions: z.array(z.object({ unitId: z.string(), decision: z.enum(['included', 'excluded', 'undecided']) })),
          personExceptions: z
            .array(z.object({ personId: z.string(), decision: z.enum(['included', 'excluded']), reason: z.string().optional() }))
            .optional(),
          note: z.string().optional(),
        }),
        req,
      );
      const draft = updateSelection(ws, { scopeId: String(req.params['id']), ...body });
      return { draftVersion: draft.version, status: draft.status };
    }),
  );

  router.post(
    '/scopes/:id/confirm',
    route((req) => {
      const body = parseBody(z.object({ expectedVersion: z.number().int().min(0), enqueue: z.boolean().default(true) }), req);
      const scopeId = String(req.params['id']);
      const report = confirmSelection(ws, scopeId, body.expectedVersion);
      const enqueued = body.enqueue ? enqueueScopedWork(ws, scopeId) : null;
      return { report, enqueued, scope: scopeSummary(ws, scopeId) };
    }),
  );

  router.post(
    '/scopes/:id/enqueue',
    route((req) => enqueueScopedWork(ws, String(req.params['id']))),
  );

  router.get(
    '/scopes/:id',
    route((req) => {
      const scope = getScope(ws, String(req.params['id']));
      return { scope: scopeSummary(ws, scope.id), version: currentScopeVersion(ws, scope.id) };
    }),
  );

  router.get(
    '/programs',
    route((req) => {
      const query = parseQuery(z.object({ university: University }), req);
      return ws.db.all(
        `SELECT p.entity_id AS id, p.university_id, p.official_title, p.award, p.degree_family, p.campus, e.canonical_path,
                n.frontmatter_json, n.checked_at
         FROM programs p
         JOIN entities e ON e.id = p.entity_id
         LEFT JOIN note_index n ON n.path = 'vault/' || e.canonical_path
         WHERE e.merged_into IS NULL ${query.university ? 'AND p.university_id = ?' : ''} ORDER BY p.official_title`,
        ...(query.university ? [query.university] : []),
      );
    }),
  );

  router.get(
    '/programs/:id',
    route((req) => {
      const id = String(req.params['id']);
      const entity = getEntity(ws, id);
      const note = entity?.canonical_path ? readNoteFile(ws, entity.canonical_path) : undefined;
      return {
        program: ws.db.get('SELECT * FROM programs WHERE entity_id = ?', id),
        note: note ? { path: note.vaultPath, sha256: note.sha256, text: note.text, frontmatter: note.parsed.frontmatter } : null,
        claims: ws.db.all('SELECT * FROM claim_index WHERE entity_id = ?', id),
        units: ws.db.all(
          `SELECT r.from_id AS unit_id, e.display_title FROM relationships r JOIN entities e ON e.id = r.from_id
           WHERE r.to_id = ? AND r.rel_type = 'administers_program'`,
          id,
        ),
      };
    }),
  );

  router.get(
    '/people',
    route((req) => {
      const query = parseQuery(
        z.object({ unit: z.string().optional(), ready: z.coerce.boolean().optional(), university: University }),
        req,
      );
      const clauses = ['e.merged_into IS NULL'];
      const params: string[] = [];
      if (query.unit) {
        clauses.push("EXISTS (SELECT 1 FROM relationships r WHERE r.from_id = p.entity_id AND r.rel_type = 'affiliated_with' AND r.to_id = ?)");
        params.push(query.unit);
      }
      if (query.university) {
        const fragment = personInUniversity('p.entity_id');
        clauses.push(fragment.sql);
        params.push(...bind(fragment, query.university));
      }
      const rows = ws.db.all<{ entity_id: string }>(
        `SELECT p.*, e.canonical_path FROM people p JOIN entities e ON e.id = p.entity_id
         WHERE ${clauses.join(' AND ')} ORDER BY p.full_name`,
        ...params,
      );
      const withDetail = rows.map((row) => ({
        ...row,
        affiliations: ws.db.all(
          `SELECT r.to_id AS unit_id, e.display_title FROM relationships r JOIN entities e ON e.id = r.to_id
           WHERE r.from_id = ? AND r.rel_type = 'affiliated_with'`,
          row.entity_id,
        ),
        labs: ws.db.all(
          `SELECT r.to_id AS lab_id, e.display_title, r.rel_type, r.status FROM relationships r JOIN entities e ON e.id = r.to_id
           WHERE r.from_id = ? AND r.rel_type IN ('member_of_lab','directs_lab')`,
          row.entity_id,
        ),
        readiness: evaluateEmailReadiness(ws, row.entity_id),
      }));
      return query.ready ? withDetail.filter((row) => row.readiness.emailReady) : withDetail;
    }),
  );

  router.get(
    '/people/:id',
    route((req) => {
      const id = String(req.params['id']);
      const entity = getEntity(ws, id);
      const profile = entity?.canonical_path ? readNoteFile(ws, entity.canonical_path) : undefined;
      const sourceMap = readNoteFile(ws, `people/${id}/source-map.md`);
      return {
        person: ws.db.get('SELECT * FROM people WHERE entity_id = ?', id),
        entity,
        readiness: evaluateEmailReadiness(ws, id),
        profileNote: profile?.exists ? { path: profile.vaultPath, sha256: profile.sha256, text: profile.text } : null,
        sourceMapNote: sourceMap.exists ? { path: sourceMap.vaultPath, sha256: sourceMap.sha256, text: sourceMap.text } : null,
        sources: personSourceMap(ws, id),
        publications: ws.db.all(
          `SELECT pub.*, e.canonical_path FROM publications pub
           JOIN entities e ON e.id = pub.entity_id
           JOIN relationships r ON r.to_id = pub.entity_id AND r.rel_type = 'authored'
           WHERE r.from_id = ? ORDER BY COALESCE(pub.published_date, pub.online_date, pub.preprint_date) DESC`,
          id,
        ),
        relationships: ws.db.all(
          `SELECT r.*, b.display_title AS to_title, b.kind AS to_kind FROM relationships r
           LEFT JOIN entities b ON b.id = r.to_id WHERE r.from_id = ?`,
          id,
        ),
        tasks: ws.db.all('SELECT id, job_kind, state, blocked_reason, updated_at FROM tasks WHERE target_id = ?', id),
      };
    }),
  );

  router.get(
    '/labs',
    route((req) => {
      const query = parseQuery(z.object({ university: University }), req);
      const fragment = query.university ? labInUniversity('l.entity_id') : null;
      return ws.db.all(
        `SELECT l.*, e.canonical_path,
                (SELECT COUNT(*) FROM relationships r WHERE r.to_id = l.entity_id AND r.rel_type IN ('member_of_lab','directs_lab')) AS member_count
         FROM labs l JOIN entities e ON e.id = l.entity_id
         WHERE e.merged_into IS NULL ${fragment ? `AND ${fragment.sql}` : ''} ORDER BY l.official_name`,
        ...(fragment && query.university ? bind(fragment, query.university) : []),
      );
    }),
  );

  router.get(
    '/labs/:id',
    route((req) => {
      const id = String(req.params['id']);
      const entity = getEntity(ws, id);
      const note = entity?.canonical_path ? readNoteFile(ws, entity.canonical_path) : undefined;
      return {
        lab: ws.db.get('SELECT * FROM labs WHERE entity_id = ?', id),
        note: note?.exists ? { path: note.vaultPath, sha256: note.sha256, text: note.text } : null,
        members: ws.db.all(
          `SELECT r.from_id AS person_id, e.display_title, r.role, r.status, r.rel_type, r.observed_at, r.evidence_status
           FROM relationships r JOIN entities e ON e.id = r.from_id
           WHERE r.to_id = ? AND r.rel_type IN ('member_of_lab','directs_lab')
           ORDER BY r.status, e.display_title`,
          id,
        ),
      };
    }),
  );

  router.get(
    '/notes',
    route((req) => {
      const query = parseQuery(z.object({ path: z.string() }), req);
      const note = readNoteFile(ws, query.path);
      return {
        path: note.vaultPath,
        exists: note.exists,
        sha256: note.sha256,
        text: note.text,
        frontmatter: note.parsed.frontmatter,
        history: noteHistory(ws, query.path),
      };
    }),
  );

  router.put(
    '/notes',
    route((req) => {
      const body = parseBody(z.object({ path: z.string(), text: z.string(), expectedSha: z.string() }), req);
      return applyUserEdit(ws, { vaultPath: body.path, text: body.text, expectedSha: body.expectedSha, actor: 'user' });
    }),
  );

  router.get('/issues', route(() => openIssues(ws)));
  router.post(
    '/issues/:id/resolve',
    route((req) => {
      resolveIssue(ws, String(req.params['id']));
      return { ok: true };
    }),
  );

  router.get(
    '/duplicates',
    route((req) => {
      const query = parseQuery(z.object({ university: University }), req);
      return listDuplicateCandidates(ws, { universityId: query.university });
    }),
  );
  router.post(
    '/duplicates/merge',
    route((req) => {
      const body = parseBody(z.object({ keep: z.string(), merge: z.string(), reason: z.string().min(3) }), req);
      return mergeEntities(ws, body.keep, body.merge, body.reason);
    }),
  );

  router.get('/discovery-queue', route(() =>
    ws.db.all(
      `SELECT d.*, e.display_title, e.kind FROM discovery_queue d LEFT JOIN entities e ON e.id = d.entity_id
       ORDER BY d.discovered_at DESC LIMIT 500`,
    ),
  ));

  router.post(
    '/maintenance/reconcile',
    route((req) => {
      const body = parseBody(z.object({ full: z.boolean().default(false) }), req);
      return reconcileVault(ws, { full: body.full });
    }),
  );
  router.post('/maintenance/check-links', route(() => checkLinks(ws)));
  router.post('/maintenance/views', route(() => generateViews(ws)));
  router.post(
    '/maintenance/backup',
    route(async (req) => {
      const body = parseBody(z.object({ label: z.string().max(60).optional() }), req);
      const result = await createBackup(ws, { label: body.label });
      return result;
    }),
  );
  router.get('/maintenance/backups', route(() => listBackups(ws)));

  return router;
}
