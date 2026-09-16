import { bind, entityInUniversity } from './util/universityFilter.js';
import type { Workspace } from './workspace.js';
import { AppError } from './util/errors.js';
import { nextEntityId, opaqueId, type EntityKind } from './util/ids.js';
import { nowIso } from './util/time.js';
import { emitEvent } from './util/events.js';

export type AnchorKind =
  | 'profile_url'
  | 'orcid'
  | 'scholar_id'
  | 'email'
  | 'homepage'
  | 'lab_url'
  | 'doi'
  | 'program_url'
  | 'unit_url'
  | 'name_in_unit'
  | 'display_name';

export type AnchorStrength = 'strong' | 'medium' | 'weak';

export interface IdentityAnchor {
  kind: AnchorKind;
  value: string;
  sourceId?: string;
}

/**
 * Anchor strength drives deduplication:
 *  - strong  : a verified, globally unique handle. A match merges records.
 *  - medium  : a normalised name scoped to one unit. Matches only when neither
 *              record carries a conflicting strong anchor.
 *  - weak    : a display name. Never merges; it only raises a duplicate candidate.
 *
 * A strong URL anchor must identify exactly one record. Callers are responsible
 * for that: a page that lists several programs, people or labs is evidence, not
 * an identity, and must not be passed as an anchor (see `findEntityByAnchor`).
 */
export const ANCHOR_STRENGTH: Record<AnchorKind, AnchorStrength> = {
  profile_url: 'strong',
  orcid: 'strong',
  scholar_id: 'strong',
  email: 'strong',
  homepage: 'strong',
  lab_url: 'strong',
  doi: 'strong',
  program_url: 'strong',
  unit_url: 'strong',
  name_in_unit: 'medium',
  display_name: 'weak',
};

/**
 * Identity form of a URL: lower-case host without `www.`, no scheme, no default
 * port, no fragment, no trailing slash. Paths keep their case because paths are
 * case-sensitive. Running this twice returns the same value, so an already
 * normalised anchor still matches.
 *
 * A hash route (`#/…` or `#!/…`) is kept: single-page catalogues such as Kuali
 * put the whole address of an entry there, so dropping it would make every
 * entry the same page. A plain in-page anchor (`#section`) is still dropped.
 */
export function normaliseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const route = /^#!?\//.test(url.hash) ? url.hash.replace(/\/+$/, '').replace(/^#!?$/, '') : '';
    url.hash = '';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const port =
      (url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443') || url.port === ''
        ? ''
        : `:${url.port}`;
    const path = url.pathname.replace(/\/+$/, '');
    // http and https name the same destination for identity purposes.
    return `${host}${port}${path}${url.search}${route}`;
  } catch {
    const [head = '', ...rest] = trimmed.split('/');
    return [head.toLowerCase().replace(/^www\./, ''), ...rest].join('/').replace(/\/+$/, '');
  }
}

export function normaliseOrcid(raw: string): string {
  const digits = raw.replace(/[^0-9xX]/g, '').toUpperCase();
  if (digits.length !== 16) return raw.trim().toUpperCase();
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}`;
}

export function normaliseName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normaliseAnchorValue(kind: AnchorKind, value: string): string {
  switch (kind) {
    case 'profile_url':
    case 'homepage':
    case 'lab_url':
    case 'program_url':
    case 'unit_url':
      return normaliseUrl(value);
    case 'orcid':
      return normaliseOrcid(value);
    case 'email':
      return value.trim().toLowerCase();
    case 'doi':
      return value.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    case 'scholar_id':
      return value.trim();
    case 'name_in_unit':
    case 'display_name':
      return normaliseName(value);
    default:
      return value.trim().toLowerCase();
  }
}

export interface EntityRow {
  id: string;
  kind: EntityKind;
  canonical_path: string | null;
  display_title: string;
  identity_confidence: string;
  merged_into: string | null;
  created_at: string;
  updated_at: string;
}

export function canonicalPathFor(kind: EntityKind, id: string): string | null {
  switch (kind) {
    case 'university':
      return `universities/${id}/index.md`;
    case 'unit':
      return `units/${id}.md`;
    case 'program':
      return `programs/${id}.md`;
    case 'person':
      return `people/${id}/profile.md`;
    case 'lab':
      return `labs/${id}.md`;
    case 'publication':
      return `publications/${id}.md`;
    case 'source':
      return `sources/${id}.md`;
    case 'outreach':
      return `outreach/${id}/draft.md`;
    default:
      return null;
  }
}

export function sourceMapPathFor(personId: string): string {
  return `people/${personId}/source-map.md`;
}

export function outreachBriefPathFor(outreachId: string): string {
  return `outreach/${outreachId}/research-brief.md`;
}

/** Prefix a vault-relative path for use in a commit file operation. */
export function vaultFilePath(vaultRelative: string): string {
  return `vault/${vaultRelative}`;
}

export function getEntity(ws: Workspace, id: string): EntityRow | undefined {
  return ws.db.get<EntityRow>('SELECT * FROM entities WHERE id = ?', id);
}

/** Follow merge redirects to the surviving record. */
export function resolveRedirect(ws: Workspace, id: string): string {
  let current = id;
  for (let i = 0; i < 16; i += 1) {
    const row = ws.db.get<{ merged_into: string | null }>('SELECT merged_into FROM entities WHERE id = ?', current);
    if (!row?.merged_into) return current;
    current = row.merged_into;
  }
  throw new AppError('integrity_error', `Merge redirect loop for ${id}`, { id });
}

export function requireEntity(ws: Workspace, id: string, kind?: EntityKind): EntityRow {
  const resolved = resolveRedirect(ws, id);
  const row = getEntity(ws, resolved);
  if (!row) throw new AppError('not_found', `Unknown entity: ${id}`, { id });
  if (kind && row.kind !== kind) {
    throw new AppError('invalid_input', `Entity ${id} is a ${row.kind}, expected ${kind}`, { id, kind: row.kind });
  }
  return row;
}

export interface ResolveResult {
  id: string;
  created: boolean;
  matchedBy: AnchorKind | null;
  duplicateCandidates: { entityId: string; reason: string; confidence: string }[];
}

export interface ResolveInput {
  kind: EntityKind;
  displayTitle: string;
  anchors: IdentityAnchor[];
  identityConfidence?: string;
  /** Existing id to reuse instead of allocating one (used by fixtures and imports). */
  preferId?: string;
}

function findByAnchor(ws: Workspace, kind: EntityKind, anchorKind: AnchorKind, value: string): string | undefined {
  const row = ws.db.get<{ entity_id: string }>(
    `SELECT a.entity_id FROM entity_aliases a
     JOIN entities e ON e.id = a.entity_id
     WHERE a.anchor_kind = ? AND a.anchor_value = ? AND e.kind = ? AND e.merged_into IS NULL
     ORDER BY a.created_at ASC LIMIT 1`,
    anchorKind,
    value,
    kind,
  );
  return row?.entity_id;
}

/**
 * Which live record, if any, currently owns an anchor. The raw value is
 * normalised exactly once, the same way `resolveOrCreateEntity` does.
 */
export function findEntityByAnchor(ws: Workspace, kind: EntityKind, anchorKind: AnchorKind, rawValue: string): string | undefined {
  const value = normaliseAnchorValue(anchorKind, rawValue);
  if (value === '') return undefined;
  return findByAnchor(ws, kind, anchorKind, value);
}

/** All anchors of one kind attached to a record, in their normalised form. */
export function entityAnchors(ws: Workspace, entityId: string, anchorKind: AnchorKind): string[] {
  return ws.db
    .all<{ anchor_value: string }>('SELECT anchor_value FROM entity_aliases WHERE entity_id = ? AND anchor_kind = ?', entityId, anchorKind)
    .map((row) => row.anchor_value);
}

export function recordDuplicateCandidate(ws: Workspace, entityId: string, otherId: string, reason: string, confidence: string): void {
  const existing = ws.db.get<{ id: string }>(
    'SELECT id FROM duplicate_candidates WHERE entity_id = ? AND other_entity_id = ? AND reason = ? AND resolved_at IS NULL',
    entityId,
    otherId,
    reason,
  );
  if (existing) return;
  ws.db.run(
    'INSERT INTO duplicate_candidates (id, entity_id, other_entity_id, reason, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    opaqueId('dup'),
    entityId,
    otherId,
    reason,
    confidence,
    nowIso(),
  );
}

export function addAnchors(ws: Workspace, entityId: string, anchors: IdentityAnchor[]): void {
  insertAnchors(
    ws,
    entityId,
    anchors.map((anchor) => ({ ...anchor, value: normaliseAnchorValue(anchor.kind, anchor.value) })),
  );
}

/**
 * Insert anchors whose values are already normalised.
 *
 * Normalisation is applied exactly once: running it twice over a URL would
 * lower-case a case-sensitive path and quietly break the lookup.
 */
function insertAnchors(ws: Workspace, entityId: string, anchors: IdentityAnchor[]): void {
  for (const anchor of anchors) {
    const value = anchor.value;
    if (value === '') continue;
    ws.db.run(
      `INSERT INTO entity_aliases (id, entity_id, anchor_kind, anchor_value, strength, source_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id, anchor_kind, anchor_value) DO UPDATE SET
         source_id = COALESCE(excluded.source_id, entity_aliases.source_id)`,
      opaqueId('alias'),
      entityId,
      anchor.kind,
      value,
      ANCHOR_STRENGTH[anchor.kind],
      anchor.sourceId ?? null,
      nowIso(),
    );
  }
}

/**
 * The single identity service used by every job. One canonical record per real
 * person, lab, program or publication, across departments and laboratories.
 */
export function resolveOrCreateEntity(ws: Workspace, input: ResolveInput): ResolveResult {
  return ws.db.transaction(() => {
    const duplicateCandidates: ResolveResult['duplicateCandidates'] = [];
    const normalised = input.anchors
      .map((a) => ({ ...a, value: normaliseAnchorValue(a.kind, a.value) }))
      .filter((a) => a.value !== '');

    const strongMatches = new Map<string, AnchorKind>();
    for (const anchor of normalised.filter((a) => ANCHOR_STRENGTH[a.kind] === 'strong')) {
      const found = findByAnchor(ws, input.kind, anchor.kind, anchor.value);
      if (found) strongMatches.set(found, anchor.kind);
    }

    if (strongMatches.size > 1) {
      const ids = [...strongMatches.keys()];
      for (let i = 1; i < ids.length; i += 1) {
        recordDuplicateCandidate(ws, ids[0] as string, ids[i] as string, 'conflicting_strong_anchors', 'high');
        duplicateCandidates.push({
          entityId: ids[i] as string,
          reason: 'conflicting_strong_anchors',
          confidence: 'high',
        });
      }
    }

    if (strongMatches.size >= 1) {
      const [id, matchedBy] = [...strongMatches.entries()][0] as [string, AnchorKind];
      insertAnchors(ws, id, normalised);
      ws.db.run('UPDATE entities SET updated_at = ? WHERE id = ?', nowIso(), id);
      return { id, created: false, matchedBy, duplicateCandidates };
    }

    for (const anchor of normalised.filter((a) => ANCHOR_STRENGTH[a.kind] === 'medium')) {
      const found = findByAnchor(ws, input.kind, anchor.kind, anchor.value);
      if (found) {
        insertAnchors(ws, found, normalised);
        return { id: found, created: false, matchedBy: anchor.kind, duplicateCandidates };
      }
    }

    // Name-only similarity never merges; it only flags a candidate for review.
    for (const anchor of normalised.filter((a) => ANCHOR_STRENGTH[a.kind] === 'weak')) {
      const found = findByAnchor(ws, input.kind, anchor.kind, anchor.value);
      if (found) {
        duplicateCandidates.push({ entityId: found, reason: 'same_display_name', confidence: 'low' });
      }
    }

    if (input.preferId) {
      // A caller-supplied id refers to an existing record whenever one exists.
      const existing = getEntity(ws, input.preferId);
      if (existing) {
        insertAnchors(ws, existing.id, normalised);
        return { id: existing.id, created: false, matchedBy: null, duplicateCandidates };
      }
    }
    const id = input.preferId ?? nextEntityId(ws.db, input.kind);
    const now = nowIso();
    ws.db.run(
      `INSERT INTO entities (id, kind, canonical_path, display_title, identity_confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.kind,
      canonicalPathFor(input.kind, id),
      input.displayTitle,
      input.identityConfidence ?? (normalised.some((a) => ANCHOR_STRENGTH[a.kind] === 'strong') ? 'probable' : 'name_only'),
      now,
      now,
    );
    insertAnchors(ws, id, normalised);
    for (const candidate of duplicateCandidates) {
      recordDuplicateCandidate(ws, id, candidate.entityId, candidate.reason, candidate.confidence);
    }
    emitEvent(ws.db, 'entity:created', id, { kind: input.kind, title: input.displayTitle });
    return { id, created: true, matchedBy: null, duplicateCandidates };
  });
}

export interface MergeResult {
  keptId: string;
  mergedId: string;
  movedRelationships: number;
}

/** Redirect `mergeId` into `keepId`, preserving both notes and all evidence. */
export function mergeEntities(ws: Workspace, keepId: string, mergeId: string, reason: string): MergeResult {
  if (keepId === mergeId) throw new AppError('invalid_input', 'Cannot merge an entity into itself', { keepId });
  return ws.db.transaction(() => {
    const keep = requireEntity(ws, keepId);
    const merge = requireEntity(ws, mergeId);
    if (keep.kind !== merge.kind) {
      throw new AppError('invalid_input', 'Refusing to merge entities of different kinds', {
        keepKind: keep.kind,
        mergeKind: merge.kind,
      });
    }
    const aliases = ws.db.all<{ anchor_kind: string; anchor_value: string; strength: string; source_id: string | null }>(
      'SELECT anchor_kind, anchor_value, strength, source_id FROM entity_aliases WHERE entity_id = ?',
      mergeId,
    );
    for (const alias of aliases) {
      ws.db.run(
        `INSERT INTO entity_aliases (id, entity_id, anchor_kind, anchor_value, strength, source_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entity_id, anchor_kind, anchor_value) DO NOTHING`,
        opaqueId('alias'),
        keepId,
        alias.anchor_kind,
        alias.anchor_value,
        alias.strength,
        alias.source_id,
        nowIso(),
      );
    }
    const rels = ws.db.all<{ id: string; from_id: string; to_id: string; rel_type: string; role: string }>(
      'SELECT id, from_id, to_id, rel_type, role FROM relationships WHERE from_id = ? OR to_id = ?',
      mergeId,
      mergeId,
    );
    let moved = 0;
    for (const rel of rels) {
      const from = rel.from_id === mergeId ? keepId : rel.from_id;
      const to = rel.to_id === mergeId ? keepId : rel.to_id;
      if (from === to) continue;
      const clash = ws.db.get<{ id: string }>(
        'SELECT id FROM relationships WHERE from_id = ? AND to_id = ? AND rel_type = ? AND role = ?',
        from,
        to,
        rel.rel_type,
        rel.role,
      );
      if (clash) {
        ws.db.run('DELETE FROM relationships WHERE id = ?', rel.id);
      } else {
        ws.db.run('UPDATE relationships SET from_id = ?, to_id = ?, updated_at = ? WHERE id = ?', from, to, nowIso(), rel.id);
        moved += 1;
      }
    }
    ws.db.run('UPDATE entities SET merged_into = ?, canonical_path = NULL, updated_at = ? WHERE id = ?', keepId, nowIso(), mergeId);
    ws.db.run(
      'UPDATE duplicate_candidates SET resolved_at = ?, resolution = ? WHERE (entity_id = ? AND other_entity_id = ?) OR (entity_id = ? AND other_entity_id = ?)',
      nowIso(),
      `merged_into:${keepId}`,
      keepId,
      mergeId,
      mergeId,
      keepId,
    );
    emitEvent(ws.db, 'entity:merged', keepId, { mergedId: mergeId, reason });
    return { keptId: keepId, mergedId: mergeId, movedRelationships: moved };
  });
}

export function listDuplicateCandidates(ws: Workspace, filter: { universityId?: string } = {}): Record<string, unknown>[] {
  const params: string[] = [];
  let extra = '';
  if (filter.universityId) {
    const a = entityInUniversity('d.entity_id');
    const b = entityInUniversity('d.other_entity_id');
    extra = ` AND (${a.sql} OR ${b.sql})`;
    params.push(...bind(a, filter.universityId), ...bind(b, filter.universityId));
  }
  return ws.db.all(
    `SELECT d.*, a.display_title AS entity_title, b.display_title AS other_title
     FROM duplicate_candidates d
     LEFT JOIN entities a ON a.id = d.entity_id
     LEFT JOIN entities b ON b.id = d.other_entity_id
     WHERE d.resolved_at IS NULL${extra} ORDER BY d.created_at DESC`,
    ...params,
  );
}
