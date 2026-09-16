export interface FileOp {
  /** Workspace-root-relative posix path of the file this op installs. */
  path: string;
  /** File name inside the commit's staged directory; empty for a removal. */
  staged: string;
  /** Hash of the installed bytes; empty for a removal. */
  sha256: string;
  size: number;
  /** Hash the file must currently have. `null` means "must not exist yet". */
  expectedPriorSha256: string | null;
  /** Remove the file instead of installing one. Prior bytes are retained first. */
  remove?: true;
  entityId?: string;
  noteType?: string;
  source: 'worker' | 'core' | 'user' | 'revert';
}

export type DbOpKind =
  | 'entity.upsert'
  | 'entity.alias'
  | 'entity.delete'
  | 'alias.delete'
  | 'relationship.delete'
  | 'person_source.delete'
  | 'person.reset'
  | 'outreach.delete'
  | 'note.forget'
  | 'discovery.delete'
  | 'task.reset'
  | 'task.delete'
  | 'commit.state'
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

export type CommitState = 'prepared' | 'applying' | 'committed' | 'conflict' | 'rolled_back' | 'reverted';
