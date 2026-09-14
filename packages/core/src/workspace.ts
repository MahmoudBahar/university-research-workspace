import { Database } from '@urw/db';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig, type ResearchConfig } from './config.js';
import { ensureDir } from './util/fsx.js';
import { AppError } from './util/errors.js';

export interface WorkspacePaths {
  root: string;
  vault: string;
  data: string;
  applicant: string;
  templates: string;
  config: string;
  docs: string;
  runs: string;
  revisions: string;
  commits: string;
  cache: string;
  backups: string;
  tmp: string;
  dbFile: string;
}

export class Workspace {
  readonly paths: WorkspacePaths;
  readonly config: ResearchConfig;
  readonly db: Database;

  constructor(paths: WorkspacePaths, config: ResearchConfig, db: Database) {
    this.paths = paths;
    this.config = config;
    this.db = db;
  }

  /** Absolute path for a vault-relative posix path. */
  vaultPath(relPosix: string): string {
    return join(this.paths.vault, ...relPosix.split('/'));
  }

  close(): void {
    this.db.close();
  }
}

export function workspacePaths(root: string): WorkspacePaths {
  const abs = resolve(root);
  return {
    root: abs,
    vault: join(abs, 'vault'),
    data: join(abs, 'data'),
    applicant: join(abs, 'applicant'),
    templates: join(abs, 'templates'),
    config: join(abs, 'config'),
    docs: join(abs, 'docs'),
    runs: join(abs, 'data', 'runs'),
    revisions: join(abs, 'data', 'revisions'),
    commits: join(abs, 'data', 'commits'),
    cache: join(abs, 'data', 'cache'),
    backups: join(abs, 'data', 'backups'),
    tmp: join(abs, 'data', 'tmp'),
    dbFile: join(abs, 'data', 'research.sqlite'),
  };
}

/** Walk upwards from `start` looking for the workspace root marker. */
export function findWorkspaceRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string };
        if (parsed.name === 'university-research-workspace') return dir;
      } catch {
        /* an unparsable package.json upstream is not this workspace */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new AppError('not_found', 'Workspace root not found. Run commands inside the project directory.', {
        start,
      });
    }
    dir = parent;
  }
}

export interface OpenWorkspaceOptions {
  root?: string;
  /** Create directories and run migrations. `research init` uses this. */
  create?: boolean;
  driver?: 'better-sqlite3' | 'node:sqlite';
  readOnly?: boolean;
}

export async function openWorkspace(options: OpenWorkspaceOptions = {}): Promise<Workspace> {
  const root = options.root ? resolve(options.root) : findWorkspaceRoot();
  const paths = workspacePaths(root);

  if (options.create) {
    for (const dir of [paths.vault, paths.data, paths.runs, paths.revisions, paths.commits, paths.cache, paths.backups, paths.tmp]) {
      ensureDir(dir);
    }
  } else if (!existsSync(paths.data)) {
    ensureDir(paths.data);
  }

  const config = loadConfig(root);
  const db = await Database.open({
    file: paths.dbFile,
    busyTimeoutMs: 8000,
    driver: options.driver,
    readOnly: options.readOnly === true,
  });
  if (options.readOnly !== true) db.migrate();
  return new Workspace(paths, config, db);
}
