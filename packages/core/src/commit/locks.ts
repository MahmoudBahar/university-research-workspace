import type { Database } from '@urw/db';
import { AppError } from '../util/errors.js';
import { isoPlusSeconds, nowIso } from '../util/time.js';

export interface CommitLock {
  lockKey: string;
  owner: string;
  expiresAt: string;
}

/**
 * Advisory per-entity lock held in SQLite so that the CLI and the local API
 * serialise multi-file commits against each other, not only within one process.
 */
export function acquireCommitLock(db: Database, lockKey: string, owner: string, ttlSeconds = 120): CommitLock {
  return db.transaction(() => {
    const existing = db.get<{ owner: string; expires_at: string }>(
      'SELECT owner, expires_at FROM commit_locks WHERE lock_key = ?',
      lockKey,
    );
    const now = nowIso();
    if (existing && existing.expires_at > now && existing.owner !== owner) {
      throw new AppError('conflict', `Commit lock held by ${existing.owner} until ${existing.expires_at}`, {
        lockKey,
        heldBy: existing.owner,
      });
    }
    const expiresAt = isoPlusSeconds(ttlSeconds);
    db.run(
      `INSERT INTO commit_locks (lock_key, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(lock_key) DO UPDATE SET owner = excluded.owner, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at`,
      lockKey,
      owner,
      now,
      expiresAt,
    );
    return { lockKey, owner, expiresAt };
  });
}

export function releaseCommitLock(db: Database, lockKey: string, owner: string): void {
  db.run('DELETE FROM commit_locks WHERE lock_key = ? AND owner = ?', lockKey, owner);
}

export function withCommitLock<T>(db: Database, lockKey: string, owner: string, fn: () => T, ttlSeconds = 120): T {
  acquireCommitLock(db, lockKey, owner, ttlSeconds);
  try {
    return fn();
  } finally {
    releaseCommitLock(db, lockKey, owner);
  }
}
