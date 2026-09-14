export interface FileOp {
  /** Workspace-root-relative posix path of the file this op installs. */
  path: string;
  /** File name inside the commit's staged directory. */
  staged: string;
  sha256: string;
  size: number;
  /** Hash the file must currently have. `null` means "must not exist yet". */
  expectedPriorSha256: string | null;
  entityId?: string;
  noteType?: string;
  source: 'worker' | 'core' | 'user';
}

export type DbOpKind =
  | 'entity.upsert'
  | 'entity.alias'
  | 'university.upsert'
  | 'unit.upsert'
  | 'unit.parent'
  | 'program.upsert'
  | 'person.upsert'
  | 'person.readiness'
  | 'lab.upsert'
  | 'publication.upsert'
  | 'relationship.upsert'
  | 'source.upsert'
  | 'source.observation'
  | 'person_source.upsert'
  | 'note.revision'
  | 'claim.upsert'
  | 'task.state'
  | 'task.enqueue'
  | 'discovery.enqueue'
  | 'outreach.upsert'
  | 'outreach.revision'
  | 'settings.set'
  | 'event';

export interface DbOp {
  kind: DbOpKind;
  payload: Record<string, unknown>;
}

export interface CommitManifest {
  id: string;
  createdAt: string;
  lockKey: string;
  entityId: string | null;
  taskId: string | null;
  runId: string | null;
  fencingToken: number | null;
  scopeId: string | null;
  scopeVersion: number | null;
  description: string;
  files: FileOp[];
  dbOps: DbOp[];
}

export type CommitState = 'prepared' | 'applying' | 'committed' | 'conflict' | 'rolled_back';
