/**
 * Thin client for the local API.
 *
 * Every mutation carries the local session token that `GET /api/bootstrap`
 * hands out, so a page served from any other origin cannot drive this API.
 */

export interface ApiError {
  error: string;
  message: string;
  detail?: Record<string, unknown>;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown>;
  readonly status: number;

  constructor(status: number, body: ApiError) {
    super(body.message || `Request failed with ${status}`);
    this.name = 'ApiRequestError';
    this.code = body.error ?? 'error';
    this.detail = body.detail ?? {};
    this.status = status;
  }
}

let sessionToken: string | null = null;

export interface Bootstrap {
  session: string;
  allowedOrigins: string[];
  status: WorkspaceStatus;
  actions: string[];
  root: string;
  execution: { mode: string; note: string };
}

export async function bootstrap(): Promise<Bootstrap> {
  const response = await fetch('/api/bootstrap', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new ApiRequestError(response.status, (await response.json()) as ApiError);
  const body = (await response.json()) as Bootstrap;
  sessionToken = body.session;
  return body;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (!['GET', 'HEAD'].includes(method)) {
    if (!sessionToken) await bootstrap();
    if (sessionToken) headers['x-urw-session'] = sessionToken;
  }
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) throw new ApiRequestError(response.status, body as ApiError);
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
};

/* --------------------------------------------------------------- types */

export interface JobProgress {
  jobKind: string;
  jobNumber: number;
  label: string;
  counts: Record<string, number>;
  ready: number;
}

export interface WorkspaceStatus {
  driver: string;
  universities: { id: string; name: string; units: number; scope: ScopeSummary | null }[];
  jobs: JobProgress[];
  readyCandidates: { personId: string; name: string; emailReady: boolean; blockers: string[] }[];
  blocked: { taskId: string; jobKind: string; targetId: string; reasons: string[] }[];
  outreach: { total: number; byState: Record<string, number>; due: number; overdue: number; sent: number };
  discoveryQueue: number;
  duplicateCandidates: number;
  openNoteIssues: number;
  pendingCommits: number;
  lastActivity: string | null;
  eventSeq: number;
  activeRuns: { taskId: string; jobKind: string; owner: string | null; leaseExpiresAt: string | null; runId: string | null }[];
}

export interface ScopeSummary {
  scopeId: string;
  universityId: string;
  currentVersion: number;
  confirmedAt: string | null;
  hasDraft: boolean;
  draftVersion: number | null;
  explicitIncluded: number;
  explicitExcluded: number;
  totalUnits: number;
}

export interface UnitNode {
  id: string;
  officialName: string;
  unitType: string;
  campus: string | null;
  url: string | null;
  decision: 'included' | 'excluded' | 'undecided';
  explicit: boolean;
  notePath: string | null;
  children: UnitNode[];
}

export interface TaskRow {
  id: string;
  job_kind: string;
  target_id: string;
  target_title: string | null;
  state: string;
  priority: number;
  attempts: number;
  blocked_reason: string | null;
  next_attempt_at: string | null;
  owner_id: string | null;
  lease_expires_at: string | null;
  current_run_id: string | null;
  scope_version: number | null;
  updated_at: string;
  blockers: { code: string; message: string }[];
}

export interface PersonRow {
  entity_id: string;
  full_name: string;
  official_title: string | null;
  role_category: string;
  email: string | null;
  email_evidence: string | null;
  contact_rule: string | null;
  timezone: string | null;
  timezone_basis: string | null;
  research_complete: number;
  email_ready: number;
  canonical_path: string | null;
  affiliations: { unit_id: string; display_title: string }[];
  labs: { lab_id: string; display_title: string; rel_type: string; status: string }[];
  readiness: Readiness;
}

export interface Readiness {
  personId: string;
  researchComplete: boolean;
  emailReady: boolean;
  recipient: string | null;
  contactRule: string;
  issues: { code: string; message: string; severity: 'blocker' | 'warning' }[];
}

export interface OutreachRow {
  id: string;
  person_id: string;
  person_title: string | null;
  purpose: string;
  program_id: string;
  campaign: string;
  state: string;
  current_revision: number;
  current_fingerprint: string | null;
  sent_count: number;
  updated_at: string;
}

export interface DraftContent {
  recipient: string;
  subject: string;
  body: string;
  attachments: { document_id: string; version: number; filename: string; sha256: string }[];
  contactRequirements: { requirement: string; source_id?: string; satisfied: 'yes' | 'no' | 'unknown' }[];
  fingerprint: string;
  sha256: string;
  vaultPath: string;
}

export interface SendPlan {
  id: string;
  outreach_id: string;
  local_date: string;
  local_time: string;
  recipient_zone: string;
  zone_basis: string;
  disambiguation: string | null;
  utc_instant: string;
  display_zone: string;
  original_wall_intent: string;
}

export interface PlannerRow {
  outreachId: string;
  personTitle: string | null;
  state: string;
  plan: SendPlan | null;
  due: 'scheduled' | 'due' | 'overdue' | null;
  recipientRendering: { formatted: string; weekday: string } | null;
  displayRendering: { formatted: string; weekday: string } | null;
  drift: { drifted: boolean; recomputedInstant: string | null; reason?: string } | null;
  sent: boolean;
}

export interface DocumentRow {
  id: string;
  kind: string;
  display_name: string;
  current_version: number;
  versions: {
    id: string;
    version: number;
    original_filename: string;
    media_type: string | null;
    size: number;
    sha256: string;
    review_state: string;
    imported_at: string;
    extraction?: ExtractionSummary | null;
  }[];
}

export interface SearchResult {
  kind: 'person' | 'program' | 'lab' | 'unit' | 'draft' | 'task' | 'note' | 'university';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface SearchResponse {
  results: SearchResult[];
  truncated: boolean;
}

export interface AppEvent {
  seq: number;
  at: string;
  kind: string;
  entityId: string | null;
  payload: Record<string, unknown> | null;
}

export interface EventsResponse {
  events: AppEvent[];
  latest: number;
}

export interface UnitProgress {
  unitId: string;
  name: string;
  unitType: string;
  decision: 'included' | 'excluded' | 'undecided';
  tasks: { total: number; complete: number; blocked: number; running: number; pending: number };
  people: { total: number; researchComplete: number; emailReady: number };
  programs: number;
}

export interface UnitProgressResponse {
  units: UnitProgress[];
}

export interface RevisionDetail {
  revision: number;
  recipient: string;
  subject: string;
  body: string;
  fingerprint: string;
  source: string;
  created_at: string;
}

export interface ExtractionSummary {
  status: 'extracted' | 'unavailable' | 'empty';
  method: string;
  characters?: number;
  page_count?: number | null;
  detail: string | null;
  created_at?: string;
}
