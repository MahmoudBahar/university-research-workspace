import type { Database } from '@urw/db';
import type { DbOp } from './manifest.js';
import { nowIso } from '../util/time.js';
import { opaqueId } from '../util/ids.js';
import { emitEvent } from '../util/events.js';
import { taskDedupeKey, TASK_SCHEMA_VERSION, type JobKind } from '../tasks/definitions.js';
import { fingerprint } from '../util/hash.js';

type Payload = Record<string, unknown>;

const str = (p: Payload, key: string): string => String(p[key] ?? '');
const strOrNull = (p: Payload, key: string): string | null => (p[key] == null ? null : String(p[key]));
const num = (p: Payload, key: string, fallback = 0): number =>
  p[key] == null ? fallback : Number(p[key]);
const bool = (p: Payload, key: string): number => (p[key] ? 1 : 0);
const json = (p: Payload, key: string, fallback = '{}'): string =>
  p[key] == null ? fallback : JSON.stringify(p[key]);

/**
 * Every handler is idempotent: replaying an interrupted commit must reach the
 * same state without duplicating rows.
 */
const HANDLERS: Record<string, (db: Database, p: Payload, commitId: string) => void> = {
  'entity.upsert': (db, p) => {
    const now = nowIso();
    db.run(
      `INSERT INTO entities (id, kind, canonical_path, display_title, identity_confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         canonical_path = COALESCE(excluded.canonical_path, entities.canonical_path),
         display_title = excluded.display_title,
         identity_confidence = excluded.identity_confidence,
         updated_at = excluded.updated_at`,
      str(p, 'id'),
      str(p, 'kind'),
      strOrNull(p, 'canonicalPath'),
      str(p, 'displayTitle'),
      String(p['identityConfidence'] ?? 'unverified'),
      now,
      now,
    );
  },

  'entity.alias': (db, p) => {
    db.run(
      `INSERT INTO entity_aliases (id, entity_id, anchor_kind, anchor_value, strength, source_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id, anchor_kind, anchor_value) DO UPDATE SET
         strength = excluded.strength,
         source_id = COALESCE(excluded.source_id, entity_aliases.source_id)`,
      opaqueId('alias'),
      str(p, 'entityId'),
      str(p, 'anchorKind'),
      str(p, 'anchorValue'),
      String(p['strength'] ?? 'weak'),
      strOrNull(p, 'sourceId'),
      nowIso(),
    );
  },

  'university.upsert': (db, p) => {
    db.run(
      `INSERT INTO universities (entity_id, official_name, domain, homepage_url, country, default_timezone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         official_name = excluded.official_name,
         domain = COALESCE(excluded.domain, universities.domain),
         homepage_url = COALESCE(excluded.homepage_url, universities.homepage_url),
         country = COALESCE(excluded.country, universities.country),
         default_timezone = COALESCE(excluded.default_timezone, universities.default_timezone)`,
      str(p, 'entityId'),
      str(p, 'officialName'),
      strOrNull(p, 'domain'),
      strOrNull(p, 'homepageUrl'),
      strOrNull(p, 'country'),
      strOrNull(p, 'defaultTimezone'),
      nowIso(),
    );
  },

  'unit.upsert': (db, p) => {
    db.run(
      `INSERT INTO academic_units (entity_id, university_id, official_name, unit_type, campus, url, discovered_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         university_id = excluded.university_id,
         official_name = excluded.official_name,
         unit_type = excluded.unit_type,
         campus = COALESCE(excluded.campus, academic_units.campus),
         url = COALESCE(excluded.url, academic_units.url)`,
      str(p, 'entityId'),
      str(p, 'universityId'),
      str(p, 'officialName'),
      String(p['unitType'] ?? 'other'),
      strOrNull(p, 'campus'),
      strOrNull(p, 'url'),
      strOrNull(p, 'discoveredBy'),
      nowIso(),
    );
  },

  'unit.parent': (db, p) => {
    db.run(
      `INSERT INTO unit_parents (unit_id, parent_id, parent_kind) VALUES (?, ?, ?)
       ON CONFLICT(unit_id, parent_id) DO UPDATE SET parent_kind = excluded.parent_kind`,
      str(p, 'unitId'),
      str(p, 'parentId'),
      String(p['parentKind'] ?? 'unit'),
    );
  },

  'program.upsert': (db, p) => {
    db.run(
      `INSERT INTO programs (entity_id, university_id, official_title, award, degree_family, campus, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         university_id = excluded.university_id,
         official_title = excluded.official_title,
         award = COALESCE(excluded.award, programs.award),
         degree_family = COALESCE(excluded.degree_family, programs.degree_family),
         campus = COALESCE(excluded.campus, programs.campus)`,
      str(p, 'entityId'),
      str(p, 'universityId'),
      str(p, 'officialTitle'),
      strOrNull(p, 'award'),
      strOrNull(p, 'degreeFamily'),
      strOrNull(p, 'campus'),
      nowIso(),
    );
  },

  'person.upsert': (db, p) => {
    const now = nowIso();
    db.run(
      `INSERT INTO people (entity_id, full_name, official_title, role_category, profile_url, orcid, email,
                           email_evidence, timezone, timezone_basis, timezone_observed_at, contact_rule,
                           created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         full_name = excluded.full_name,
         official_title = COALESCE(excluded.official_title, people.official_title),
         role_category = excluded.role_category,
         profile_url = COALESCE(excluded.profile_url, people.profile_url),
         orcid = COALESCE(excluded.orcid, people.orcid),
         email = COALESCE(excluded.email, people.email),
         email_evidence = COALESCE(excluded.email_evidence, people.email_evidence),
         timezone = COALESCE(excluded.timezone, people.timezone),
         timezone_basis = COALESCE(excluded.timezone_basis, people.timezone_basis),
         timezone_observed_at = COALESCE(excluded.timezone_observed_at, people.timezone_observed_at),
         contact_rule = COALESCE(excluded.contact_rule, people.contact_rule),
         updated_at = excluded.updated_at`,
      str(p, 'entityId'),
      str(p, 'fullName'),
      strOrNull(p, 'officialTitle'),
      String(p['roleCategory'] ?? 'unknown'),
      strOrNull(p, 'profileUrl'),
      strOrNull(p, 'orcid'),
      strOrNull(p, 'email'),
      strOrNull(p, 'emailEvidence'),
      strOrNull(p, 'timezone'),
      strOrNull(p, 'timezoneBasis'),
      strOrNull(p, 'timezoneObservedAt'),
      strOrNull(p, 'contactRule'),
      now,
      now,
    );
  },

  'person.readiness': (db, p) => {
    db.run(
      `UPDATE people SET research_complete = ?, email_ready = ?, readiness_detail = ?, updated_at = ?
       WHERE entity_id = ?`,
      bool(p, 'researchComplete'),
      bool(p, 'emailReady'),
      json(p, 'detail'),
      nowIso(),
      str(p, 'entityId'),
    );
  },

  'lab.upsert': (db, p) => {
    db.run(
      `INSERT INTO labs (entity_id, university_id, official_name, url, timezone, timezone_basis, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         university_id = COALESCE(excluded.university_id, labs.university_id),
         official_name = excluded.official_name,
         url = COALESCE(excluded.url, labs.url),
         timezone = COALESCE(excluded.timezone, labs.timezone),
         timezone_basis = COALESCE(excluded.timezone_basis, labs.timezone_basis)`,
      str(p, 'entityId'),
      strOrNull(p, 'universityId'),
      str(p, 'officialName'),
      strOrNull(p, 'url'),
      strOrNull(p, 'timezone'),
      strOrNull(p, 'timezoneBasis'),
      nowIso(),
    );
  },

  'publication.upsert': (db, p) => {
    db.run(
      `INSERT INTO publications (entity_id, title, doi, venue, pub_type, published_date, online_date,
                                 preprint_date, accessibility, summary_basis, version_of, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         title = excluded.title,
         doi = COALESCE(excluded.doi, publications.doi),
         venue = COALESCE(excluded.venue, publications.venue),
         pub_type = COALESCE(excluded.pub_type, publications.pub_type),
         published_date = COALESCE(excluded.published_date, publications.published_date),
         online_date = COALESCE(excluded.online_date, publications.online_date),
         preprint_date = COALESCE(excluded.preprint_date, publications.preprint_date),
         accessibility = excluded.accessibility,
         summary_basis = excluded.summary_basis,
         version_of = COALESCE(excluded.version_of, publications.version_of)`,
      str(p, 'entityId'),
      str(p, 'title'),
      strOrNull(p, 'doi'),
      strOrNull(p, 'venue'),
      strOrNull(p, 'pubType'),
      strOrNull(p, 'publishedDate'),
      strOrNull(p, 'onlineDate'),
      strOrNull(p, 'preprintDate'),
      String(p['accessibility'] ?? 'unknown'),
      String(p['summaryBasis'] ?? 'none'),
      strOrNull(p, 'versionOf'),
      nowIso(),
    );
  },

  'relationship.upsert': (db, p) => {
    const now = nowIso();
    db.run(
      `INSERT INTO relationships (id, from_id, to_id, rel_type, role, status, evidence_status, source_id,
                                  observed_at, start_date, end_date, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(from_id, to_id, rel_type, role) DO UPDATE SET
         status = excluded.status,
         evidence_status = excluded.evidence_status,
         source_id = COALESCE(excluded.source_id, relationships.source_id),
         observed_at = COALESCE(excluded.observed_at, relationships.observed_at),
         start_date = COALESCE(excluded.start_date, relationships.start_date),
         end_date = COALESCE(excluded.end_date, relationships.end_date),
         note = COALESCE(excluded.note, relationships.note),
         updated_at = excluded.updated_at`,
      opaqueId('rel'),
      str(p, 'fromId'),
      str(p, 'toId'),
      str(p, 'relType'),
      String(p['role'] ?? ''),
      String(p['status'] ?? 'current'),
      String(p['evidenceStatus'] ?? 'unverified'),
      strOrNull(p, 'sourceId'),
      strOrNull(p, 'observedAt'),
      strOrNull(p, 'startDate'),
      strOrNull(p, 'endDate'),
      strOrNull(p, 'note'),
      now,
      now,
    );
  },

  'source.upsert': (db, p) => {
    db.run(
      `INSERT INTO sources (id, url, url_normalized, source_category, title, publisher, discovered_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url_normalized) DO UPDATE SET
         source_category = excluded.source_category,
         title = COALESCE(excluded.title, sources.title),
         publisher = COALESCE(excluded.publisher, sources.publisher)`,
      str(p, 'id'),
      str(p, 'url'),
      str(p, 'urlNormalized'),
      String(p['category'] ?? 'other'),
      strOrNull(p, 'title'),
      strOrNull(p, 'publisher'),
      strOrNull(p, 'discoveredFrom'),
      nowIso(),
    );
  },

  'source.observation': (db, p) => {
    // Deterministic id keeps replay from inserting a second observation row.
    const id =
      strOrNull(p, 'id') ??
      `obs-${fingerprint({ s: str(p, 'sourceId'), at: str(p, 'observedAt'), st: str(p, 'accessStatus') }).slice(0, 24)}`;
    db.run(
      `INSERT INTO source_observations (id, source_id, observed_at, access_status, http_status, content_hash,
                                        cache_path, observer, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      id,
      str(p, 'sourceId'),
      str(p, 'observedAt'),
      str(p, 'accessStatus'),
      p['httpStatus'] == null ? null : num(p, 'httpStatus'),
      strOrNull(p, 'contentHash'),
      strOrNull(p, 'cachePath'),
      strOrNull(p, 'observer'),
      strOrNull(p, 'notes'),
    );
  },

  'person_source.upsert': (db, p) => {
    db.run(
      `INSERT INTO person_sources (person_id, source_id, source_category, identity_confidence, investigated,
                                   investigated_at, last_attempt_at, access_status, discovery_source, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id, source_id) DO UPDATE SET
         source_category = excluded.source_category,
         identity_confidence = excluded.identity_confidence,
         investigated = MAX(person_sources.investigated, excluded.investigated),
         investigated_at = COALESCE(excluded.investigated_at, person_sources.investigated_at),
         last_attempt_at = COALESCE(excluded.last_attempt_at, person_sources.last_attempt_at),
         access_status = excluded.access_status,
         note = COALESCE(excluded.note, person_sources.note)`,
      str(p, 'personId'),
      str(p, 'sourceId'),
      String(p['category'] ?? 'other'),
      String(p['identityConfidence'] ?? 'uncertain'),
      bool(p, 'investigated'),
      strOrNull(p, 'investigatedAt'),
      strOrNull(p, 'lastAttemptAt'),
      String(p['accessStatus'] ?? 'not_attempted'),
      strOrNull(p, 'discoverySource'),
      strOrNull(p, 'note'),
      nowIso(),
    );
  },

  'note.revision': (db, p, commitId) => {
    const path = str(p, 'path');
    const existing = db.get<{ id: string }>(
      'SELECT id FROM note_revisions WHERE path = ? AND commit_id = ?',
      path,
      commitId,
    );
    let revision: number;
    if (existing) {
      revision =
        db.get<{ revision: number }>('SELECT revision FROM note_revisions WHERE id = ?', existing.id)?.revision ?? 0;
    } else {
      revision =
        (db.get<{ v: number }>('SELECT COALESCE(MAX(revision), 0) AS v FROM note_revisions WHERE path = ?', path)?.v ??
          0) + 1;
      db.run(
        `INSERT INTO note_revisions (id, entity_id, path, revision, sha256, size, source, commit_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        opaqueId('rev'),
        strOrNull(p, 'entityId'),
        path,
        revision,
        str(p, 'sha256'),
        num(p, 'size'),
        String(p['source'] ?? 'core'),
        commitId,
        nowIso(),
      );
    }
    db.run(
      `INSERT INTO note_index (path, entity_id, note_type, title, schema_version, current_revision, sha256,
                               mtime_ms, size, frontmatter_json, body_text, protected_blocks_json, checked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         entity_id = COALESCE(excluded.entity_id, note_index.entity_id),
         note_type = COALESCE(excluded.note_type, note_index.note_type),
         title = COALESCE(excluded.title, note_index.title),
         schema_version = excluded.schema_version,
         current_revision = excluded.current_revision,
         sha256 = excluded.sha256,
         mtime_ms = excluded.mtime_ms,
         size = excluded.size,
         frontmatter_json = excluded.frontmatter_json,
         body_text = excluded.body_text,
         protected_blocks_json = excluded.protected_blocks_json,
         checked_at = COALESCE(excluded.checked_at, note_index.checked_at),
         updated_at = excluded.updated_at`,
      path,
      strOrNull(p, 'entityId'),
      strOrNull(p, 'noteType'),
      strOrNull(p, 'title'),
      num(p, 'schemaVersion', 1),
      revision,
      str(p, 'sha256'),
      p['mtimeMs'] == null ? null : num(p, 'mtimeMs'),
      num(p, 'size'),
      json(p, 'frontmatter'),
      strOrNull(p, 'bodyText'),
      json(p, 'protectedBlocks'),
      strOrNull(p, 'checkedAt'),
      nowIso(),
    );
  },

  'claim.upsert': (db, p) => {
    db.run(
      `INSERT INTO claim_index (id, entity_id, path, claim_key, claim_value, evidence_status, source_id,
                                checked_at, freshness_class, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path, claim_key) DO UPDATE SET
         claim_value = excluded.claim_value,
         evidence_status = excluded.evidence_status,
         source_id = COALESCE(excluded.source_id, claim_index.source_id),
         checked_at = COALESCE(excluded.checked_at, claim_index.checked_at),
         freshness_class = excluded.freshness_class,
         updated_at = excluded.updated_at`,
      opaqueId('claim'),
      strOrNull(p, 'entityId'),
      str(p, 'path'),
      str(p, 'claimKey'),
      strOrNull(p, 'claimValue'),
      String(p['evidenceStatus'] ?? 'unverified'),
      strOrNull(p, 'sourceId'),
      strOrNull(p, 'checkedAt'),
      String(p['freshnessClass'] ?? 'standard'),
      nowIso(),
    );
  },

  'task.state': (db, p) => {
    const state = str(p, 'state');
    db.run(
      `UPDATE tasks SET state = ?, progress_json = COALESCE(?, progress_json), last_error = ?,
              completed_at = CASE WHEN ? IN ('complete','cancelled') THEN ? ELSE completed_at END,
              owner_id = CASE WHEN ? IN ('complete','cancelled','failed','partial','retryable_failed','stale') THEN NULL ELSE owner_id END,
              lease_expires_at = CASE WHEN ? IN ('complete','cancelled','failed','partial','retryable_failed','stale') THEN NULL ELSE lease_expires_at END,
              updated_at = ?
       WHERE id = ?`,
      state,
      p['progress'] == null ? null : JSON.stringify(p['progress']),
      strOrNull(p, 'lastError'),
      state,
      nowIso(),
      state,
      state,
      nowIso(),
      str(p, 'taskId'),
    );
  },

  'task.enqueue': (db, p) => {
    const jobKind = str(p, 'jobKind') as JobKind;
    const identity = {
      jobKind,
      targetKind: str(p, 'targetKind'),
      targetId: String(p['targetId'] ?? ''),
      scopeId: strOrNull(p, 'scopeId'),
      scopeVersion: p['scopeVersion'] == null ? null : num(p, 'scopeVersion'),
      params: (p['params'] as Record<string, unknown>) ?? {},
      inputRevisions: (p['inputRevisions'] as Record<string, string | number>) ?? {},
      schemaVersion: TASK_SCHEMA_VERSION,
    };
    const key = taskDedupeKey(identity);
    const now = nowIso();
    db.run(
      `INSERT INTO tasks (id, job_kind, target_kind, target_id, scope_id, scope_version, params_json,
                          input_fingerprint, schema_version, dedupe_key, state, priority, requested_by,
                          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO NOTHING`,
      opaqueId('task'),
      identity.jobKind,
      identity.targetKind,
      identity.targetId,
      identity.scopeId,
      identity.scopeVersion,
      JSON.stringify(identity.params),
      fingerprint(identity.inputRevisions),
      TASK_SCHEMA_VERSION,
      key,
      String(p['state'] ?? 'pending'),
      num(p, 'priority', 100),
      String(p['requestedBy'] ?? 'discovery'),
      now,
      now,
    );
  },

  'discovery.enqueue': (db, p) => {
    db.run(
      `INSERT INTO discovery_queue (id, entity_id, entity_kind, discovered_by, discovered_at, reason, scope_status, decision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         reason = COALESCE(excluded.reason, discovery_queue.reason),
         scope_status = excluded.scope_status`,
      opaqueId('disc'),
      str(p, 'entityId'),
      str(p, 'entityKind'),
      strOrNull(p, 'discoveredBy'),
      nowIso(),
      strOrNull(p, 'reason'),
      String(p['scopeStatus'] ?? 'unknown'),
      String(p['decision'] ?? 'undecided'),
    );
  },

  'outreach.upsert': (db, p) => {
    const now = nowIso();
    db.run(
      `INSERT INTO outreach (id, person_id, purpose, program_id, campaign, state, current_revision,
                             draft_path, brief_path, contact_conflict, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         current_revision = excluded.current_revision,
         contact_conflict = excluded.contact_conflict,
         updated_at = excluded.updated_at`,
      str(p, 'id'),
      str(p, 'personId'),
      str(p, 'purpose'),
      String(p['programId'] ?? ''),
      String(p['campaign'] ?? 'default'),
      String(p['state'] ?? 'draft'),
      num(p, 'currentRevision'),
      str(p, 'draftPath'),
      str(p, 'briefPath'),
      strOrNull(p, 'contactConflict'),
      now,
      now,
    );
  },

  'outreach.revision': (db, p) => {
    db.run(
      `INSERT INTO outreach_revisions (id, outreach_id, revision, recipient, subject, body_sha256, body_path,
                                       attachments_json, fingerprint, applicant_revision_id, style_revision_id,
                                       contact_requirements_json, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(outreach_id, revision) DO NOTHING`,
      opaqueId('orev'),
      str(p, 'outreachId'),
      num(p, 'revision'),
      str(p, 'recipient'),
      str(p, 'subject'),
      str(p, 'bodySha256'),
      str(p, 'bodyPath'),
      json(p, 'attachments', '[]'),
      str(p, 'fingerprint'),
      strOrNull(p, 'applicantRevisionId'),
      strOrNull(p, 'styleRevisionId'),
      json(p, 'contactRequirements', '[]'),
      String(p['source'] ?? 'core'),
      nowIso(),
    );
  },

  /* ---------------------------------------------------------------- revert */

  'entity.delete': (db, p) => {
    const id = str(p, 'entityId');
    // Two references lack ON DELETE clauses; clear them so the delete cannot fail.
    db.run('UPDATE publications SET version_of = NULL WHERE version_of = ?', id);
    db.run('UPDATE entities SET merged_into = NULL WHERE merged_into = ?', id);
    db.run('DELETE FROM duplicate_candidates WHERE entity_id = ? OR other_entity_id = ?', id, id);
    db.run('DELETE FROM claim_index WHERE entity_id = ?', id);
    db.run('DELETE FROM note_index WHERE entity_id = ?', id);
    db.run('DELETE FROM entities WHERE id = ?', id);
  },

  'alias.delete': (db, p) => {
    db.run(
      'DELETE FROM entity_aliases WHERE entity_id = ? AND anchor_kind = ? AND anchor_value = ?',
      str(p, 'entityId'),
      str(p, 'anchorKind'),
      str(p, 'anchorValue'),
    );
  },

  'relationship.delete': (db, p) => {
    db.run(
      'DELETE FROM relationships WHERE from_id = ? AND to_id = ? AND rel_type = ? AND role = ?',
      str(p, 'fromId'),
      str(p, 'toId'),
      str(p, 'relType'),
      String(p['role'] ?? ''),
    );
  },

  'person_source.delete': (db, p) => {
    db.run('DELETE FROM person_sources WHERE person_id = ? AND created_at >= ?', str(p, 'personId'), str(p, 'sinceIso'));
  },

  'person.reset': (db, p) => {
    const allowed = new Set(['official_title', 'profile_url', 'orcid', 'email', 'email_evidence', 'timezone', 'timezone_basis', 'timezone_observed_at', 'contact_rule']);
    const fields = ((p['nullFields'] as string[] | undefined) ?? []).filter((f) => allowed.has(f));
    const sets = ['research_complete = 0', 'email_ready = 0', 'readiness_detail = NULL', ...fields.map((f) => `${f} = NULL`)];
    db.run(`UPDATE people SET ${sets.join(', ')}, updated_at = ? WHERE entity_id = ?`, nowIso(), str(p, 'entityId'));
  },

  'outreach.delete': (db, p) => {
    const id = str(p, 'outreachId');
    const row = db.get<{ draft_path: string; brief_path: string }>('SELECT draft_path, brief_path FROM outreach WHERE id = ?', id);
    if (!row) {
      db.run("DELETE FROM entities WHERE id = ? AND kind = 'outreach'", id);
      return;
    }
    const sent = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sent_events WHERE outreach_id = ?', id)?.n ?? 0;
    const approved = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM approvals WHERE outreach_id = ? AND invalidated_at IS NULL', id)?.n ?? 0;
    if (sent > 0 || approved > 0) {
      throw new Error(`Outreach ${id} has sent or approved history and cannot be removed.`);
    }
    for (const path of [row.draft_path, row.brief_path]) {
      const indexed = path.startsWith('vault/') ? path : `vault/${path}`;
      db.run('DELETE FROM claim_index WHERE path = ?', indexed);
      db.run('DELETE FROM note_index WHERE path = ?', indexed);
      db.run('UPDATE note_issues SET resolved_at = ? WHERE path = ? AND resolved_at IS NULL', nowIso(), indexed);
    }
    db.run('DELETE FROM outreach WHERE id = ?', id);
    db.run("DELETE FROM entities WHERE id = ? AND kind = 'outreach'", id);
  },

  'note.forget': (db, p) => {
    const path = str(p, 'path');
    db.run('DELETE FROM claim_index WHERE path = ?', path);
    db.run('DELETE FROM note_index WHERE path = ?', path);
    db.run('UPDATE note_issues SET resolved_at = ? WHERE path = ? AND resolved_at IS NULL', nowIso(), path);
  },

  'discovery.delete': (db, p) => {
    // Only undecided rows go; a decision the user already made is kept.
    db.run("DELETE FROM discovery_queue WHERE discovered_by = ? AND decision = 'undecided'", str(p, 'taskId'));
  },

  'task.reset': (db, p) => {
    const taskId = str(p, 'taskId');
    db.run(
      `UPDATE tasks SET state = 'pending', fencing_token = MAX(fencing_token, ?), owner_id = NULL, lease_expires_at = NULL,
              current_run_id = NULL, progress_json = NULL, completed_at = NULL, last_error = NULL, blocked_reason = NULL,
              next_attempt_at = NULL, updated_at = ?
       WHERE id = ?`,
      num(p, 'fencingToken'),
      nowIso(),
      taskId,
    );
    db.run("UPDATE task_runs SET state = 'reverted', ended_at = COALESCE(ended_at, ?) WHERE task_id = ? AND state != 'reverted'", nowIso(), taskId);
  },

  'task.delete': (db, p) => {
    db.run('DELETE FROM tasks WHERE id = ?', str(p, 'taskId'));
  },

  'commit.state': (db, p) => {
    db.run(
      'UPDATE artifact_commits SET state = ?, conflict_detail = ?, updated_at = ? WHERE id = ?',
      str(p, 'state'),
      strOrNull(p, 'detail'),
      nowIso(),
      str(p, 'commitId'),
    );
  },

  'settings.set': (db, p) => {
    db.run(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      str(p, 'key'),
      JSON.stringify(p['value']),
      nowIso(),
    );
  },

  event: (db, p) => {
    emitEvent(db, str(p, 'kind'), strOrNull(p, 'entityId'), (p['payload'] as Record<string, unknown>) ?? {});
  },
};

export function applyDbOps(db: Database, ops: DbOp[], commitId: string): void {
  for (const op of ops) {
    const handler = HANDLERS[op.kind];
    if (!handler) throw new Error(`Unknown database operation in commit manifest: ${op.kind}`);
    handler(db, op.payload, commitId);
  }
}

export function knownDbOpKinds(): string[] {
  return Object.keys(HANDLERS);
}
