import { Router } from 'express';
import { z } from 'zod';
import { bind, labInUniversity, outreachInUniversity, personInUniversity, taskInUniversity, type Workspace } from '@urw/core';
import { parseQuery, route } from '../http.js';

export type SearchKind = 'person' | 'draft' | 'program' | 'unit' | 'lab' | 'task' | 'note' | 'university';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

const KIND_ORDER: SearchKind[] = ['person', 'draft', 'program', 'unit', 'lab', 'task', 'note', 'university'];

/** LIKE patterns with the wildcard characters escaped, so `%` in a query is literal. */
function likePatterns(q: string): { contains: string; prefix: string } {
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  return { contains: `%${escaped}%`, prefix: `${escaped}%` };
}

function hrefForEntity(kind: string, id: string): string | null {
  switch (kind) {
    case 'person':
      return `/people/${id}`;
    case 'lab':
      return `/labs/${id}`;
    case 'program':
      return `/programs?open=${id}`;
    case 'academic_unit':
    case 'unit':
      return `/scope?unit=${id}`;
    case 'university':
      return `/?university=${id}`;
    default:
      return null;
  }
}

export function searchRoutes(ws: Workspace): Router {
  const router = Router();

  router.get(
    '/search',
    route((req) => {
      const query = parseQuery(
        z.object({
          q: z.string().trim().min(1).max(100),
          limit: z.coerce.number().int().min(1).max(50).default(20),
          university: z.string().min(1).max(200).optional(),
        }),
        req,
      );
      const { contains, prefix } = likePatterns(query.q);
      const limit = query.limit;
      const uni = query.university;
      const fetch = limit + 1;
      const hits: (SearchResult & { rank: number })[] = [];
      const seen = new Set<string>();
      const push = (result: SearchResult, isPrefix: boolean): void => {
        const key = `${result.kind}:${result.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push({ ...result, rank: (isPrefix ? 0 : 1) * 100 + KIND_ORDER.indexOf(result.kind) });
      };

      // People
      {
        const filter = uni ? personInUniversity('p.entity_id') : null;
        const rows = ws.db.all<{ id: string; full_name: string; official_title: string | null; prefix_hit: number }>(
          `SELECT p.entity_id AS id, p.full_name, p.official_title,
                  (p.full_name LIKE ? ESCAPE '\\') AS prefix_hit
           FROM people p JOIN entities e ON e.id = p.entity_id
           WHERE e.merged_into IS NULL
             AND (p.full_name LIKE ? ESCAPE '\\' OR COALESCE(p.official_title,'') LIKE ? ESCAPE '\\' OR COALESCE(p.email,'') LIKE ? ESCAPE '\\')
             ${filter ? `AND ${filter.sql}` : ''}
           ORDER BY prefix_hit DESC, p.full_name LIMIT ?`,
          prefix,
          contains,
          contains,
          contains,
          ...(filter ? bind(filter, uni as string) : []),
          fetch,
        );
        for (const row of rows) push({ kind: 'person', id: row.id, title: row.full_name, subtitle: row.official_title, href: `/people/${row.id}` }, row.prefix_hit === 1);
      }
      // Drafts
      {
        const filter = uni ? outreachInUniversity('o') : null;
        const rows = ws.db.all<{ id: string; person_title: string | null; subject: string | null; state: string; prefix_hit: number }>(
          `SELECT o.id, e.display_title AS person_title, rv.subject, o.state,
                  (o.id LIKE ? ESCAPE '\\' OR COALESCE(e.display_title,'') LIKE ? ESCAPE '\\') AS prefix_hit
           FROM outreach o
           LEFT JOIN entities e ON e.id = o.person_id
           LEFT JOIN outreach_revisions rv ON rv.outreach_id = o.id AND rv.revision = o.current_revision
           WHERE (o.id LIKE ? ESCAPE '\\' OR COALESCE(e.display_title,'') LIKE ? ESCAPE '\\' OR COALESCE(rv.subject,'') LIKE ? ESCAPE '\\')
             ${filter ? `AND ${filter.sql}` : ''}
           ORDER BY prefix_hit DESC, o.updated_at DESC LIMIT ?`,
          prefix,
          prefix,
          contains,
          contains,
          contains,
          ...(filter ? bind(filter, uni as string) : []),
          fetch,
        );
        for (const row of rows)
          push(
            { kind: 'draft', id: row.id, title: row.subject || row.id, subtitle: [row.person_title, row.state].filter(Boolean).join(' · ') || null, href: `/outreach/${row.id}` },
            row.prefix_hit === 1,
          );
      }
      // Programs
      {
        const rows = ws.db.all<{ id: string; official_title: string; award: string | null; prefix_hit: number }>(
          `SELECT pg.entity_id AS id, pg.official_title, pg.award, (pg.official_title LIKE ? ESCAPE '\\') AS prefix_hit
           FROM programs pg JOIN entities e ON e.id = pg.entity_id
           WHERE e.merged_into IS NULL
             AND (pg.official_title LIKE ? ESCAPE '\\' OR COALESCE(pg.award,'') LIKE ? ESCAPE '\\')
             ${uni ? 'AND pg.university_id = ?' : ''}
           ORDER BY prefix_hit DESC, pg.official_title LIMIT ?`,
          prefix,
          contains,
          contains,
          ...(uni ? [uni] : []),
          fetch,
        );
        for (const row of rows) push({ kind: 'program', id: row.id, title: row.official_title, subtitle: row.award, href: `/programs?open=${row.id}` }, row.prefix_hit === 1);
      }
      // Units
      {
        const rows = ws.db.all<{ id: string; official_name: string; unit_type: string; prefix_hit: number }>(
          `SELECT au.entity_id AS id, au.official_name, au.unit_type, (au.official_name LIKE ? ESCAPE '\\') AS prefix_hit
           FROM academic_units au JOIN entities e ON e.id = au.entity_id
           WHERE e.merged_into IS NULL
             AND (au.official_name LIKE ? ESCAPE '\\' OR au.unit_type LIKE ? ESCAPE '\\')
             ${uni ? 'AND au.university_id = ?' : ''}
           ORDER BY prefix_hit DESC, au.official_name LIMIT ?`,
          prefix,
          contains,
          contains,
          ...(uni ? [uni] : []),
          fetch,
        );
        for (const row of rows) push({ kind: 'unit', id: row.id, title: row.official_name, subtitle: row.unit_type, href: `/scope?unit=${row.id}` }, row.prefix_hit === 1);
      }
      // Labs
      {
        const filter = uni ? labInUniversity('l.entity_id') : null;
        const rows = ws.db.all<{ id: string; official_name: string; prefix_hit: number }>(
          `SELECT l.entity_id AS id, l.official_name, (l.official_name LIKE ? ESCAPE '\\') AS prefix_hit
           FROM labs l JOIN entities e ON e.id = l.entity_id
           WHERE e.merged_into IS NULL AND l.official_name LIKE ? ESCAPE '\\'
             ${filter ? `AND ${filter.sql}` : ''}
           ORDER BY prefix_hit DESC, l.official_name LIMIT ?`,
          prefix,
          contains,
          ...(filter ? bind(filter, uni as string) : []),
          fetch,
        );
        for (const row of rows) push({ kind: 'lab', id: row.id, title: row.official_name, subtitle: 'laboratory', href: `/labs/${row.id}` }, row.prefix_hit === 1);
      }
      // Tasks
      {
        const filter = uni ? taskInUniversity('t') : null;
        const rows = ws.db.all<{ id: string; job_kind: string; state: string; target_id: string; target_title: string | null; prefix_hit: number }>(
          `SELECT t.id, t.job_kind, t.state, t.target_id, e.display_title AS target_title,
                  (t.id LIKE ? ESCAPE '\\' OR t.job_kind LIKE ? ESCAPE '\\') AS prefix_hit
           FROM tasks t LEFT JOIN entities e ON e.id = t.target_id
           WHERE (t.id LIKE ? ESCAPE '\\' OR t.job_kind LIKE ? ESCAPE '\\' OR COALESCE(e.display_title,'') LIKE ? ESCAPE '\\')
             ${filter ? `AND ${filter.sql}` : ''}
           ORDER BY prefix_hit DESC, t.updated_at DESC LIMIT ?`,
          prefix,
          prefix,
          contains,
          contains,
          contains,
          ...(filter ? bind(filter, uni as string) : []),
          fetch,
        );
        for (const row of rows)
          push(
            { kind: 'task', id: row.id, title: row.target_title ? `${row.job_kind}: ${row.target_title}` : row.id, subtitle: `${row.job_kind} · ${row.state}`, href: `/queue?target=${row.target_id}` },
            row.prefix_hit === 1,
          );
      }
      // Notes (title and body text of the note index, mapped to the entity's page)
      {
        const rows = ws.db.all<{ path: string; title: string | null; entity_id: string; kind: string; prefix_hit: number }>(
          `SELECT n.path, n.title, n.entity_id, e.kind, (COALESCE(n.title,'') LIKE ? ESCAPE '\\') AS prefix_hit
           FROM note_index n JOIN entities e ON e.id = n.entity_id
           WHERE e.merged_into IS NULL
             AND (COALESCE(n.title,'') LIKE ? ESCAPE '\\' OR COALESCE(n.body_text,'') LIKE ? ESCAPE '\\')
           ORDER BY prefix_hit DESC, n.title LIMIT ?`,
          prefix,
          contains,
          contains,
          fetch,
        );
        for (const row of rows) {
          const href = hrefForEntity(row.kind, row.entity_id);
          if (!href) continue;
          if (uni && !entityBelongs(ws, row.kind, row.entity_id, uni)) continue;
          // A note hit for an entity already listed adds nothing.
          if (seen.has(`${row.kind}:${row.entity_id}`) || seen.has(`unit:${row.entity_id}`)) continue;
          push({ kind: 'note', id: row.entity_id, title: row.title ?? row.path, subtitle: row.path, href }, row.prefix_hit === 1);
        }
      }
      // Universities
      {
        const rows = ws.db.all<{ id: string; official_name: string; prefix_hit: number }>(
          `SELECT u.entity_id AS id, u.official_name, (u.official_name LIKE ? ESCAPE '\\') AS prefix_hit
           FROM universities u WHERE u.official_name LIKE ? ESCAPE '\\' ORDER BY u.official_name LIMIT ?`,
          prefix,
          contains,
          fetch,
        );
        for (const row of rows) push({ kind: 'university', id: row.id, title: row.official_name, subtitle: 'university', href: `/?university=${row.id}` }, row.prefix_hit === 1);
      }

      hits.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
      const results = hits.slice(0, limit).map(({ rank: _rank, ...rest }) => rest);
      return { results, truncated: hits.length > limit };
    }),
  );

  return router;
}

function entityBelongs(ws: Workspace, kind: string, id: string, universityId: string): boolean {
  switch (kind) {
    case 'university':
      return id === universityId;
    case 'academic_unit':
    case 'unit':
      return Boolean(ws.db.get('SELECT 1 FROM academic_units WHERE entity_id = ? AND university_id = ?', id, universityId));
    case 'program':
      return Boolean(ws.db.get('SELECT 1 FROM programs WHERE entity_id = ? AND university_id = ?', id, universityId));
    case 'lab': {
      const f = labInUniversity('?');
      return Boolean(ws.db.get(`SELECT 1 WHERE ${f.sql}`, id, ...bind(f, universityId)));
    }
    case 'person': {
      const f = personInUniversity('?');
      return Boolean(ws.db.get(`SELECT 1 WHERE ${f.sql}`, id, id, ...bind(f, universityId)));
    }
    default:
      return false;
  }
}
