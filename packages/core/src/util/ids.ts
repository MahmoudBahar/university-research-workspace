import type { Database } from '@urw/db';
import { randomUUID } from 'node:crypto';

export type EntityKind =
  | 'university'
  | 'unit'
  | 'program'
  | 'person'
  | 'lab'
  | 'publication'
  | 'source'
  | 'outreach'
  | 'document';

const PREFIX: Record<EntityKind, string> = {
  university: 'university',
  unit: 'unit',
  program: 'program',
  person: 'person',
  lab: 'lab',
  publication: 'paper',
  source: 'source',
  outreach: 'draft',
  document: 'doc',
};

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*-\d{4,}$/;

/** Allocate the next sequential public identifier for a kind, e.g. `person-0007`. */
export function nextEntityId(db: Database, kind: EntityKind): string {
  const key = `id_seq:${kind}`;
  return db.transaction(() => {
    const row = db.get<{ value_json: string }>('SELECT value_json FROM app_settings WHERE key = ?', key);
    const next = (row ? (JSON.parse(row.value_json) as number) : 0) + 1;
    db.run(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      key,
      JSON.stringify(next),
      new Date().toISOString(),
    );
    return `${PREFIX[kind]}-${String(next).padStart(4, '0')}`;
  });
}

export function isEntityId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function entityKindOfId(value: string): EntityKind | undefined {
  const prefix = value.replace(/-\d{4,}$/, '');
  const found = (Object.entries(PREFIX) as [EntityKind, string][]).find(([, p]) => p === prefix);
  return found?.[0];
}

/** Opaque identifiers for rows the user never types (runs, commits, revisions). */
export function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function shortId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
