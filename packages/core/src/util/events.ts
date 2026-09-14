import type { Database } from '@urw/db';
import { nowIso } from './time.js';
import { opaqueId } from './ids.js';

export interface AppEvent {
  seq: number;
  at: string;
  kind: string;
  entityId: string | null;
  payload: Record<string, unknown> | null;
}

/** Append to the change feed that the UI polls or streams. */
export function emitEvent(
  db: Database,
  kind: string,
  entityId: string | null = null,
  payload: Record<string, unknown> = {},
): void {
  db.run(
    'INSERT INTO event_log (at, kind, entity_id, payload_json) VALUES (?, ?, ?, ?)',
    nowIso(),
    kind,
    entityId,
    JSON.stringify(payload),
  );
}

/** Append an auditable record of an explicit user or core action. */
export function recordAudit(
  db: Database,
  actor: string,
  action: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
): string {
  const id = opaqueId('audit');
  db.run(
    'INSERT INTO audit_events (id, at, actor, action, entity_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    nowIso(),
    actor,
    action,
    entityId,
    JSON.stringify(detail),
  );
  emitEvent(db, `audit:${action}`, entityId, detail);
  return id;
}

export function readEvents(db: Database, sinceSeq = 0, limit = 200): AppEvent[] {
  const rows = db.all<{ seq: number; at: string; kind: string; entity_id: string | null; payload_json: string | null }>(
    'SELECT seq, at, kind, entity_id, payload_json FROM event_log WHERE seq > ? ORDER BY seq ASC LIMIT ?',
    sinceSeq,
    limit,
  );
  return rows.map((row) => ({
    seq: row.seq,
    at: row.at,
    kind: row.kind,
    entityId: row.entity_id,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : null,
  }));
}

export function latestEventSeq(db: Database): number {
  return db.get<{ v: number }>('SELECT COALESCE(MAX(seq), 0) AS v FROM event_log')?.v ?? 0;
}

/**
 * Drop change-feed rows older than the retention window. Audit mirrors
 * (`audit:*`) are kept: the change feed is a convenience, the audit trail is not.
 */
export function pruneEvents(db: Database, retentionDays: number): { pruned: number } {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const result = db.run("DELETE FROM event_log WHERE at < ? AND kind NOT LIKE 'audit:%'", cutoff);
  return { pruned: Number(result.changes ?? 0) };
}
