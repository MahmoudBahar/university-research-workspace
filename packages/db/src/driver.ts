/**
 * Small SQLite driver adapter.
 *
 * The project targets better-sqlite3 first, as specified, but the adapter also
 * supports the built-in `node:sqlite` module so that the workspace still runs on
 * machines where the native module cannot be compiled or prebuilt. Both drivers
 * are exposed through the same narrow interface; the rest of the codebase never
 * imports a driver directly.
 *
 * Only positional (`?`) parameters are used by callers, because that is the one
 * binding style both drivers implement identically.
 */

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  get(...params: SqlValue[]): Record<string, unknown> | undefined;
  all(...params: SqlValue[]): Record<string, unknown>[];
  run(...params: SqlValue[]): RunResult;
}

export interface SqliteConnection {
  readonly driverName: string;
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

export interface OpenOptions {
  /** Absolute path to the database file. */
  file: string;
  /** Busy timeout in milliseconds applied through PRAGMA busy_timeout. */
  busyTimeoutMs?: number;
  /** Force a driver instead of auto-detecting. */
  driver?: 'better-sqlite3' | 'node:sqlite';
  readOnly?: boolean;
}

interface BetterSqlite3Like {
  new (file: string, options?: Record<string, unknown>): {
    prepare(sql: string): {
      get(...p: unknown[]): unknown;
      all(...p: unknown[]): unknown[];
      run(...p: unknown[]): RunResult;
    };
    exec(sql: string): void;
    close(): void;
  };
}

function normaliseRunResult(raw: unknown): RunResult {
  const value = raw as { changes?: number | bigint; lastInsertRowid?: number | bigint } | undefined;
  const changesRaw = value?.changes ?? 0;
  return {
    changes: typeof changesRaw === 'bigint' ? Number(changesRaw) : changesRaw,
    lastInsertRowid: value?.lastInsertRowid ?? 0,
  };
}

async function openBetterSqlite3(options: OpenOptions): Promise<SqliteConnection> {
  const mod = (await import('better-sqlite3')) as unknown as { default: BetterSqlite3Like };
  const Ctor = mod.default;
  const handle = new Ctor(options.file, { readonly: options.readOnly === true });
  return {
    driverName: 'better-sqlite3',
    prepare(sql: string): SqliteStatement {
      const stmt = handle.prepare(sql);
      return {
        get: (...params) => stmt.get(...params) as Record<string, unknown> | undefined,
        all: (...params) => stmt.all(...params) as Record<string, unknown>[],
        run: (...params) => normaliseRunResult(stmt.run(...params)),
      };
    },
    exec: (sql: string) => handle.exec(sql),
    close: () => handle.close(),
  };
}

async function openNodeSqlite(options: OpenOptions): Promise<SqliteConnection> {
  const { DatabaseSync } = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (
      file: string,
      opts?: Record<string, unknown>,
    ) => {
      prepare(sql: string): {
        get(...p: unknown[]): unknown;
        all(...p: unknown[]): unknown[];
        run(...p: unknown[]): RunResult;
      };
      exec(sql: string): void;
      close(): void;
    };
  };
  const handle = new DatabaseSync(options.file, {
    readOnly: options.readOnly === true,
    enableForeignKeyConstraints: true,
  });
  return {
    driverName: 'node:sqlite',
    prepare(sql: string): SqliteStatement {
      const stmt = handle.prepare(sql);
      return {
        get: (...params) => stmt.get(...params) as Record<string, unknown> | undefined,
        all: (...params) => stmt.all(...params) as Record<string, unknown>[],
        run: (...params) => normaliseRunResult(stmt.run(...params)),
      };
    },
    exec: (sql: string) => handle.exec(sql),
    close: () => handle.close(),
  };
}

export interface DriverProbe {
  selected: string;
  attempted: { driver: string; ok: boolean; error?: string }[];
}

let lastProbe: DriverProbe | undefined;

export function lastDriverProbe(): DriverProbe | undefined {
  return lastProbe;
}

export async function openConnection(options: OpenOptions): Promise<SqliteConnection> {
  const attempted: DriverProbe['attempted'] = [];
  const order: ('better-sqlite3' | 'node:sqlite')[] = options.driver
    ? [options.driver]
    : ['better-sqlite3', 'node:sqlite'];

  let connection: SqliteConnection | undefined;
  for (const driver of order) {
    try {
      connection =
        driver === 'better-sqlite3'
          ? await openBetterSqlite3(options)
          : await openNodeSqlite(options);
      attempted.push({ driver, ok: true });
      break;
    } catch (error) {
      attempted.push({ driver, ok: false, error: (error as Error).message });
    }
  }

  if (!connection) {
    const detail = attempted.map((a) => `${a.driver}: ${a.error ?? 'unknown error'}`).join('; ');
    throw new Error(`No usable SQLite driver. Attempts -> ${detail}`);
  }

  lastProbe = { selected: connection.driverName, attempted };

  const busy = options.busyTimeoutMs ?? 5000;
  connection.exec(`PRAGMA busy_timeout = ${Math.trunc(busy)};`);
  connection.exec('PRAGMA foreign_keys = ON;');
  if (options.readOnly !== true) {
    // WAL keeps readers (UI) from blocking writers (CLI) on the same host.
    connection.exec('PRAGMA journal_mode = WAL;');
    connection.exec('PRAGMA synchronous = FULL;');
  }
  return connection;
}
