export interface Migration {
  id: number;
  name: string;
  sql: string;
}

const m001 = `
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  canonical_path TEXT,
  display_title TEXT NOT NULL,
  identity_confidence TEXT NOT NULL DEFAULT 'unverified',
  merged_into TEXT REFERENCES entities(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX entities_kind_idx ON entities(kind);
CREATE UNIQUE INDEX entities_path_ci_idx
  ON entities(lower(canonical_path)) WHERE canonical_path IS NOT NULL AND merged_into IS NULL;

CREATE TABLE entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  anchor_kind TEXT NOT NULL,
  anchor_value TEXT NOT NULL,
  strength TEXT NOT NULL DEFAULT 'weak',
  source_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX entity_aliases_unique_idx ON entity_aliases(entity_id, anchor_kind, anchor_value);
CREATE INDEX entity_aliases_lookup_idx ON entity_aliases(anchor_kind, anchor_value);

CREATE TABLE universities (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  official_name TEXT NOT NULL,
  domain TEXT,
  homepage_url TEXT,
  country TEXT,
  default_timezone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE academic_units (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  university_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  official_name TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  campus TEXT,
  url TEXT,
  discovered_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX academic_units_university_idx ON academic_units(university_id);

CREATE TABLE unit_parents (
  unit_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  parent_kind TEXT NOT NULL,
  PRIMARY KEY (unit_id, parent_id)
);

CREATE TABLE programs (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  university_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  official_title TEXT NOT NULL,
  award TEXT,
  degree_family TEXT,
  campus TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE people (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  official_title TEXT,
  role_category TEXT NOT NULL DEFAULT 'unknown',
  profile_url TEXT,
  orcid TEXT,
  email TEXT,
  email_evidence TEXT,
  timezone TEXT,
  timezone_basis TEXT,
  timezone_observed_at TEXT,
  contact_rule TEXT,
  research_complete INTEGER NOT NULL DEFAULT 0,
  email_ready INTEGER NOT NULL DEFAULT 0,
  readiness_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE labs (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  university_id TEXT,
  official_name TEXT NOT NULL,
  url TEXT,
  timezone TEXT,
  timezone_basis TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE publications (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  doi TEXT,
  venue TEXT,
  pub_type TEXT,
  published_date TEXT,
  online_date TEXT,
  preprint_date TEXT,
  accessibility TEXT NOT NULL DEFAULT 'unknown',
  summary_basis TEXT NOT NULL DEFAULT 'none',
  version_of TEXT REFERENCES entities(id),
  created_at TEXT NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  url_normalized TEXT NOT NULL UNIQUE,
  source_category TEXT NOT NULL,
  title TEXT,
  publisher TEXT,
  discovered_from TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE source_observations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  access_status TEXT NOT NULL,
  http_status INTEGER,
  content_hash TEXT,
  cache_path TEXT,
  observer TEXT,
  notes TEXT
);
CREATE INDEX source_observations_source_idx ON source_observations(source_id, observed_at);

CREATE TABLE person_sources (
  person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_category TEXT NOT NULL,
  identity_confidence TEXT NOT NULL DEFAULT 'uncertain',
  investigated INTEGER NOT NULL DEFAULT 0,
  investigated_at TEXT,
  last_attempt_at TEXT,
  access_status TEXT NOT NULL DEFAULT 'not_attempted',
  discovery_source TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (person_id, source_id)
);

CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rel_type TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'current',
  evidence_status TEXT NOT NULL DEFAULT 'unverified',
  source_id TEXT REFERENCES sources(id),
  observed_at TEXT,
  start_date TEXT,
  end_date TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX relationships_unique_idx ON relationships(from_id, to_id, rel_type, role);
CREATE INDEX relationships_from_idx ON relationships(from_id);
CREATE INDEX relationships_to_idx ON relationships(to_id);

CREATE TABLE scopes (
  id TEXT PRIMARY KEY,
  university_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE scope_versions (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE (scope_id, version)
);

CREATE TABLE scope_units (
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  explicit INTEGER NOT NULL DEFAULT 1,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (scope_version_id, unit_id)
);

CREATE TABLE scope_person_exceptions (
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  reason TEXT,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (scope_version_id, person_id)
);

CREATE TABLE note_revisions (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  path TEXT NOT NULL,
  revision INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  source TEXT NOT NULL,
  commit_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (path, revision)
);
CREATE INDEX note_revisions_entity_idx ON note_revisions(entity_id);

CREATE TABLE note_index (
  path TEXT PRIMARY KEY,
  entity_id TEXT,
  note_type TEXT,
  title TEXT,
  schema_version INTEGER,
  current_revision INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  mtime_ms INTEGER,
  size INTEGER,
  frontmatter_json TEXT,
  body_text TEXT,
  protected_blocks_json TEXT,
  checked_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX note_index_entity_idx ON note_index(entity_id);

CREATE TABLE claim_index (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  path TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  claim_value TEXT,
  evidence_status TEXT NOT NULL DEFAULT 'unverified',
  source_id TEXT,
  checked_at TEXT,
  freshness_class TEXT NOT NULL DEFAULT 'standard',
  updated_at TEXT NOT NULL,
  UNIQUE (path, claim_key)
);

CREATE TABLE note_issues (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX note_issues_open_idx ON note_issues(path) WHERE resolved_at IS NULL;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  job_kind TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  scope_id TEXT,
  scope_version INTEGER,
  params_json TEXT NOT NULL DEFAULT '{}',
  input_fingerprint TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  dedupe_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 100,
  blocked_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  fencing_token INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  lease_expires_at TEXT,
  current_run_id TEXT,
  next_attempt_at TEXT,
  last_error TEXT,
  progress_json TEXT,
  requested_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX tasks_state_idx ON tasks(state, job_kind);
CREATE INDEX tasks_target_idx ON tasks(target_id);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'hard',
  PRIMARY KEY (task_id, depends_on)
);

CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  run_dir TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'running',
  lease_expires_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error_json TEXT
);
CREATE INDEX task_runs_task_idx ON task_runs(task_id);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, seq)
);

CREATE TABLE artifact_commits (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  task_id TEXT,
  run_id TEXT,
  fencing_token INTEGER,
  state TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  conflict_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX artifact_commits_state_idx ON artifact_commits(state);

CREATE TABLE commit_locks (
  lock_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  original_filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  media_type TEXT,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'unreviewed',
  imported_at TEXT NOT NULL,
  note TEXT,
  UNIQUE (document_id, version)
);

CREATE TABLE document_extractions (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  text_path TEXT,
  page_count INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE extracted_facts (
  id TEXT PRIMARY KEY,
  document_version_id TEXT REFERENCES document_versions(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL,
  fact_value TEXT,
  page INTEGER,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  entry_method TEXT NOT NULL DEFAULT 'extracted',
  created_at TEXT NOT NULL
);

CREATE TABLE applicant_revisions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  revision INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (path, revision)
);

CREATE TABLE outreach (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  program_id TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT 'default',
  state TEXT NOT NULL DEFAULT 'draft',
  current_revision INTEGER NOT NULL DEFAULT 0,
  draft_path TEXT NOT NULL,
  brief_path TEXT NOT NULL,
  contact_conflict TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (person_id, purpose, program_id, campaign)
);

CREATE TABLE outreach_revisions (
  id TEXT PRIMARY KEY,
  outreach_id TEXT NOT NULL REFERENCES outreach(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  body_path TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT NOT NULL,
  applicant_revision_id TEXT,
  style_revision_id TEXT,
  contact_requirements_json TEXT,
  source TEXT NOT NULL DEFAULT 'core',
  created_at TEXT NOT NULL,
  UNIQUE (outreach_id, revision)
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  outreach_id TEXT NOT NULL REFERENCES outreach(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  approved_by TEXT NOT NULL DEFAULT 'user',
  note TEXT,
  invalidated_at TEXT,
  invalidated_reason TEXT
);
CREATE INDEX approvals_outreach_idx ON approvals(outreach_id);

CREATE TABLE send_plans (
  id TEXT PRIMARY KEY,
  outreach_id TEXT NOT NULL REFERENCES outreach(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  recipient_zone TEXT NOT NULL,
  zone_basis TEXT NOT NULL,
  disambiguation TEXT,
  utc_instant TEXT NOT NULL,
  display_zone TEXT NOT NULL,
  original_wall_intent TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX send_plans_outreach_idx ON send_plans(outreach_id);

CREATE TABLE sent_events (
  id TEXT PRIMARY KEY,
  outreach_id TEXT NOT NULL REFERENCES outreach(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  sent_at_utc TEXT NOT NULL,
  snapshot_revision INTEGER NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  snapshot_path TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  was_approved INTEGER NOT NULL DEFAULT 0,
  approval_id TEXT,
  source TEXT NOT NULL DEFAULT 'user_reported',
  message_reference TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT,
  detail_json TEXT
);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_id);

CREATE TABLE discovery_queue (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  discovered_by TEXT,
  discovered_at TEXT NOT NULL,
  reason TEXT,
  scope_status TEXT NOT NULL DEFAULT 'unknown',
  decision TEXT NOT NULL DEFAULT 'undecided',
  decided_at TEXT,
  UNIQUE (entity_id)
);

CREATE TABLE duplicate_candidates (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  other_entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE event_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT
);
`;

/**
 * Incremental changes are appended here and applied forward-only. Each applied
 * migration is recorded with a checksum so an edited migration is detected
 * rather than silently ignored.
 */
const m002 = `
ALTER TABLE source_observations ADD COLUMN fetch_method TEXT NOT NULL DEFAULT 'none';
ALTER TABLE person_sources ADD COLUMN fetch_method TEXT NOT NULL DEFAULT 'none';
ALTER TABLE task_runs ADD COLUMN renewals INTEGER NOT NULL DEFAULT 0;
CREATE INDEX event_log_kind_at_idx ON event_log(kind, at);
CREATE INDEX event_log_at_idx ON event_log(at);
`;

export const MIGRATIONS: Migration[] = [
  { id: 1, name: 'initial-schema', sql: m001 },
  { id: 2, name: 'fetch-method-renewals-event-index', sql: m002 },
];
