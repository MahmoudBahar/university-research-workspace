import type { Workspace } from '../workspace.js';
import { nextEntityId, opaqueId } from '../util/ids.js';
import { nowIso, daysBetween } from '../util/time.js';
import { normaliseUrl, canonicalPathFor } from '../registry.js';
import { AppError } from '../util/errors.js';

export interface SourceRow {
  id: string;
  url: string;
  url_normalized: string;
  source_category: string;
  title: string | null;
  publisher: string | null;
  discovered_from: string | null;
  created_at: string;
}

export interface UpsertSourceInput {
  url: string;
  category: string;
  title?: string;
  publisher?: string;
  discoveredFrom?: string;
}

/** One row per distinct destination; identity is the normalised URL. */
export function upsertSource(ws: Workspace, input: UpsertSourceInput): SourceRow {
  const normalized = normaliseUrl(input.url);
  if (normalized === '') throw new AppError('invalid_input', 'A source needs a URL', {});
  return ws.db.transaction(() => {
    const existing = ws.db.get<SourceRow>('SELECT * FROM sources WHERE url_normalized = ?', normalized);
    if (existing) {
      ws.db.run(
        'UPDATE sources SET title = COALESCE(?, title), publisher = COALESCE(?, publisher) WHERE id = ?',
        input.title ?? null,
        input.publisher ?? null,
        existing.id,
      );
      return ws.db.get<SourceRow>('SELECT * FROM sources WHERE id = ?', existing.id) as SourceRow;
    }
    const id = nextEntityId(ws.db, 'source');
    const now = nowIso();
    ws.db.run(
      `INSERT INTO sources (id, url, url_normalized, source_category, title, publisher, discovered_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.url,
      normalized,
      input.category,
      input.title ?? null,
      input.publisher ?? null,
      input.discoveredFrom ?? null,
      now,
    );
    ws.db.run(
      `INSERT INTO entities (id, kind, canonical_path, display_title, identity_confidence, created_at, updated_at)
       VALUES (?, 'source', ?, ?, 'verified', ?, ?) ON CONFLICT(id) DO NOTHING`,
      id,
      canonicalPathFor('source', id),
      input.title ?? input.url,
      now,
      now,
    );
    return ws.db.get<SourceRow>('SELECT * FROM sources WHERE id = ?', id) as SourceRow;
  });
}

export interface ObservationInput {
  sourceId: string;
  accessStatus: string;
  fetchMethod?: string;
  httpStatus?: number;
  contentHash?: string;
  cachePath?: string;
  observer?: string;
  notes?: string;
  observedAt?: string;
}

/** Access outcomes are evidence in their own right, including blocks and failures. */
export function recordObservation(ws: Workspace, input: ObservationInput): { id: string } {
  const id = opaqueId('obs');
  ws.db.run(
    `INSERT INTO source_observations (id, source_id, observed_at, access_status, fetch_method, http_status, content_hash, cache_path, observer, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.sourceId,
    input.observedAt ?? nowIso(),
    input.accessStatus,
    input.fetchMethod ?? 'none',
    input.httpStatus ?? null,
    input.contentHash ?? null,
    input.cachePath ?? null,
    input.observer ?? null,
    input.notes ?? null,
  );
  return { id };
}

export function latestObservation(ws: Workspace, sourceId: string): Record<string, unknown> | undefined {
  return ws.db.get('SELECT * FROM source_observations WHERE source_id = ? ORDER BY observed_at DESC LIMIT 1', sourceId);
}

/** Cached observations are reused while they are inside the configured window. */
export function isObservationFresh(ws: Workspace, sourceId: string, days?: number): boolean {
  const latest = latestObservation(ws, sourceId) as { observed_at?: string } | undefined;
  if (!latest?.observed_at) return false;
  return daysBetween(latest.observed_at, nowIso()) <= (days ?? ws.config.freshness.sourceObservationDays);
}

export interface PersonSourceInput {
  personId: string;
  sourceId: string;
  category: string;
  identityConfidence?: string;
  investigated?: boolean;
  accessStatus?: string;
  fetchMethod?: string;
  discoverySource?: string;
  note?: string;
  lastAttemptAt?: string;
}

export function upsertPersonSource(ws: Workspace, input: PersonSourceInput): void {
  ws.db.run(
    `INSERT INTO person_sources (person_id, source_id, source_category, identity_confidence, investigated,
                                 investigated_at, last_attempt_at, access_status, fetch_method, discovery_source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(person_id, source_id) DO UPDATE SET
       source_category = excluded.source_category,
       identity_confidence = excluded.identity_confidence,
       investigated = MAX(person_sources.investigated, excluded.investigated),
       investigated_at = COALESCE(excluded.investigated_at, person_sources.investigated_at),
       last_attempt_at = COALESCE(excluded.last_attempt_at, person_sources.last_attempt_at),
       access_status = excluded.access_status,
       fetch_method = excluded.fetch_method,
       note = COALESCE(excluded.note, person_sources.note)`,
    input.personId,
    input.sourceId,
    input.category,
    input.identityConfidence ?? 'uncertain',
    input.investigated ? 1 : 0,
    input.investigated ? nowIso() : null,
    input.lastAttemptAt ?? null,
    input.accessStatus ?? 'not_attempted',
    input.fetchMethod ?? 'none',
    input.discoverySource ?? null,
    input.note ?? null,
    nowIso(),
  );
}

export function personSourceMap(ws: Workspace, personId: string): Record<string, unknown>[] {
  return ws.db.all(
    `SELECT ps.*, s.url, s.title, s.publisher,
            (SELECT access_status FROM source_observations o WHERE o.source_id = s.id ORDER BY observed_at DESC LIMIT 1) AS latest_access,
            (SELECT observed_at FROM source_observations o WHERE o.source_id = s.id ORDER BY observed_at DESC LIMIT 1) AS latest_observed_at,
            (SELECT fetch_method FROM source_observations o WHERE o.source_id = s.id ORDER BY observed_at DESC LIMIT 1) AS latest_fetch_method
     FROM person_sources ps JOIN sources s ON s.id = ps.source_id
     WHERE ps.person_id = ? ORDER BY ps.source_category, s.url`,
    personId,
  );
}

export interface BrowserRetryRow {
  person_id: string;
  person_title: string | null;
  source_id: string;
  url: string;
  source_category: string;
  access_status: string;
  fetch_method: string;
  last_attempt_at: string | null;
  note: string | null;
}

/**
 * Person sources whose last outcome a browser retrieval may still resolve:
 * `needs_browser`, `blocked`, `captcha` or `rate_limited`. Nothing here retries
 * anything; it lists what a `/map-person <id> --retry-blocked` run would revisit.
 */
export function sourcesNeedingBrowser(ws: Workspace, personId?: string): BrowserRetryRow[] {
  const clauses = ["ps.access_status IN ('needs_browser','blocked','captcha','rate_limited')"];
  const params: string[] = [];
  if (personId) {
    clauses.push('ps.person_id = ?');
    params.push(personId);
  }
  return ws.db.all<BrowserRetryRow>(
    `SELECT ps.person_id, e.display_title AS person_title, ps.source_id, s.url, ps.source_category,
            ps.access_status, ps.fetch_method, ps.last_attempt_at, ps.note
     FROM person_sources ps
     JOIN sources s ON s.id = ps.source_id
     LEFT JOIN entities e ON e.id = ps.person_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY ps.person_id, ps.source_category, s.url`,
    ...params,
  );
}

export function listSources(ws: Workspace, limit = 500): Record<string, unknown>[] {
  return ws.db.all(
    `SELECT s.*, (SELECT access_status FROM source_observations o WHERE o.source_id = s.id ORDER BY observed_at DESC LIMIT 1) AS latest_access
     FROM sources s ORDER BY s.created_at DESC LIMIT ?`,
    limit,
  );
}
