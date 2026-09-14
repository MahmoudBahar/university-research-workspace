import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { openConnection, type OpenOptions, type SqliteConnection, type SqliteStatement, type SqlValue, type RunResult } from './driver.js';
import { MIGRATIONS } from './migrations/index.js';

export class SqliteBusyError extends Error {}

export interface MigrationReport {
  applied: number[];
  current: number;
  /** Applied migrations whose recorded checksum no longer matches the source. */
  warnings: string[];
}

export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\s+/g, ' ').trim(), 'utf8').digest('hex');
}

export interface TransactionOptions {
  /** BEGIN mode. `immediate` is the default and takes the write lock up front. */
  mode?: 'deferred' | 'immediate';
  /** Bounded busy retries for SQLITE_BUSY / SQLITE_LOCKED. */
  retries?: number;
  retryBaseMs?: number;
}

function isBusyError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error);
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i.test(message);
}

function sleepSync(ms: number): void {
  // Deliberately synchronous: the whole data layer is synchronous so that
  // transactional code cannot interleave with other awaited work.
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

export class Database {
  readonly connection: SqliteConnection;
  readonly file: string;
  private readonly cache = new Map<string, SqliteStatement>();
  private depth = 0;
  private savepointCounter = 0;
  lastMigrationWarnings: string[] = [];

  private constructor(connection: SqliteConnection, file: string) {
    this.connection = connection;
    this.file = file;
  }

  static async open(options: OpenOptions): Promise<Database> {
    mkdirSync(dirname(options.file), { recursive: true });
    const connection = await openConnection(options);
    return new Database(connection, options.file);
  }

  get driverName(): string {
    return this.connection.driverName;
  }

  prepare(sql: string): SqliteStatement {
    const cached = this.cache.get(sql);
    if (cached) return cached;
    const stmt = this.connection.prepare(sql);
    this.cache.set(sql, stmt);
    return stmt;
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SqlValue[]): RunResult {
    return this.prepare(sql).run(...params);
  }

  exec(sql: string): void {
    this.connection.exec(sql);
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  /**
   * Run `fn` in a short transaction. Nested calls use SAVEPOINTs so that core
   * operations can compose without opening a second physical transaction.
   */
  transaction<T>(fn: () => T, options: TransactionOptions = {}): T {
    const retries = options.retries ?? 5;
    const base = options.retryBaseMs ?? 25;

    if (this.depth > 0) {
      const name = `sp_${++this.savepointCounter}`;
      this.connection.exec(`SAVEPOINT ${name};`);
      this.depth += 1;
      try {
        const result = fn();
        this.connection.exec(`RELEASE ${name};`);
        return result;
      } catch (error) {
        this.connection.exec(`ROLLBACK TO ${name};`);
        this.connection.exec(`RELEASE ${name};`);
        throw error;
      } finally {
        this.depth -= 1;
      }
    }

    const begin = options.mode === 'deferred' ? 'BEGIN' : 'BEGIN IMMEDIATE';
    let attempt = 0;
    for (;;) {
      try {
        this.connection.exec(`${begin};`);
      } catch (error) {
        if (isBusyError(error) && attempt < retries) {
          attempt += 1;
          sleepSync(base * 2 ** (attempt - 1) + Math.floor(Math.random() * base));
          continue;
        }
        throw error;
      }
      this.depth = 1;
      try {
        const result = fn();
        this.connection.exec('COMMIT;');
        return result;
      } catch (error) {
        try {
          this.connection.exec('ROLLBACK;');
        } catch {
          /* rollback of an already-closed transaction is not an error worth masking */
        }
        if (isBusyError(error) && attempt < retries) {
          attempt += 1;
          sleepSync(base * 2 ** (attempt - 1) + Math.floor(Math.random() * base));
          continue;
        }
        throw error;
      } finally {
        this.depth = 0;
      }
    }
  }

  migrate(): MigrationReport {
    this.connection.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at TEXT NOT NULL,
         checksum TEXT
       );`,
    );
    const columns = this.all<{ name: string }>('PRAGMA table_info(schema_migrations)').map((c) => c.name);
    if (!columns.includes('checksum')) {
      this.connection.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;');
    }
    const applied: number[] = [];
    const warnings: string[] = [];
    for (const migration of MIGRATIONS) {
      const checksum = migrationChecksum(migration.sql);
      const row = this.get<{ id: number; checksum: string | null }>('SELECT id, checksum FROM schema_migrations WHERE id = ?', migration.id);
      if (row) {
        if (row.checksum === null) {
          // Databases created before checksums were recorded: adopt the current text.
          this.run('UPDATE schema_migrations SET checksum = ? WHERE id = ?', checksum, migration.id);
        } else if (row.checksum !== checksum) {
          warnings.push(
            `Migration ${migration.id} (${migration.name}) was applied from different SQL than the current source; an edited migration is never re-run.`,
          );
        }
        continue;
      }
      this.transaction(() => {
        this.connection.exec(migration.sql);
        this.run(
          'INSERT INTO schema_migrations (id, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
          migration.id,
          migration.name,
          new Date().toISOString(),
          checksum,
        );
      });
      applied.push(migration.id);
    }
    const current = this.get<{ v: number }>('SELECT COALESCE(MAX(id), 0) AS v FROM schema_migrations')?.v ?? 0;
    this.lastMigrationWarnings = warnings;
    return { applied, current, warnings };
  }

  /**
   * Consistent point-in-time copy. VACUUM INTO produces a single self-contained
   * file even while WAL is active, so backups never depend on copying -wal/-shm.
   */
  backupTo(targetFile: string): void {
    mkdirSync(dirname(targetFile), { recursive: true });
    const escaped = targetFile.replace(/'/g, "''");
    this.connection.exec(`VACUUM INTO '${escaped}';`);
  }

  checkpoint(): void {
    try {
      this.connection.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      /* checkpointing is best-effort */
    }
  }

  integrityCheck(): string {
    const row = this.get<{ integrity_check: string }>('PRAGMA integrity_check');
    return row?.integrity_check ?? 'unknown';
  }

  close(): void {
    this.cache.clear();
    this.connection.close();
  }
}
