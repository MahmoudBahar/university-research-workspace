import { fingerprint } from '../util/hash.js';

export const TASK_SCHEMA_VERSION = 1;

export type JobKind =
  | 'discover_university'
  | 'research_programs'
  | 'discover_people'
  | 'map_person_sources'
  | 'research_person'
  | 'research_lab'
  | 'draft_outreach'
  | 'verify_person';

export type TaskState =
  | 'pending'
  | 'blocked'
  | 'running'
  | 'partial'
  | 'complete'
  | 'retryable_failed'
  | 'failed'
  | 'cancelled'
  | 'stale';

export const TERMINAL_STATES: TaskState[] = ['complete', 'cancelled'];

export interface JobDefinition {
  kind: JobKind;
  jobNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 0;
  label: string;
  targetKind: 'university' | 'unit' | 'person' | 'lab' | 'program' | 'outreach';
  /** Requires a confirmed scope version before it may run. */
  scopeGated: boolean;
  agent: string;
  skill: string;
  defaultPriority: number;
  atomicUnit: string;
}

export const JOBS: Record<JobKind, JobDefinition> = {
  discover_university: {
    kind: 'discover_university',
    jobNumber: 1,
    label: 'University and department discovery',
    targetKind: 'university',
    scopeGated: false,
    agent: 'university-discoverer',
    skill: 'research-university',
    defaultPriority: 10,
    atomicUnit: 'One discovery run over a university, checkpointed per unit and source',
  },
  research_programs: {
    kind: 'research_programs',
    jobNumber: 2,
    label: 'MASc program research',
    targetKind: 'unit',
    scopeGated: true,
    agent: 'program-researcher',
    skill: 'research-programs',
    defaultPriority: 30,
    atomicUnit: 'One included academic unit',
  },
  discover_people: {
    kind: 'discover_people',
    jobNumber: 3,
    label: 'Faculty and assistant discovery',
    targetKind: 'unit',
    scopeGated: true,
    agent: 'people-discoverer',
    skill: 'discover-people',
    defaultPriority: 20,
    atomicUnit: 'One included academic unit or directory page set',
  },
  map_person_sources: {
    kind: 'map_person_sources',
    jobNumber: 4,
    label: 'Per-person source mapping',
    targetKind: 'person',
    scopeGated: true,
    agent: 'source-mapper',
    skill: 'map-person',
    defaultPriority: 40,
    atomicUnit: 'One person',
  },
  research_person: {
    kind: 'research_person',
    jobNumber: 5,
    label: 'Deep person research',
    targetKind: 'person',
    scopeGated: true,
    agent: 'person-researcher',
    skill: 'research-person',
    defaultPriority: 50,
    atomicUnit: 'One person',
  },
  research_lab: {
    kind: 'research_lab',
    jobNumber: 6,
    label: 'Laboratory research',
    targetKind: 'lab',
    scopeGated: false,
    agent: 'lab-researcher',
    skill: 'research-labs',
    defaultPriority: 60,
    atomicUnit: 'One laboratory',
  },
  draft_outreach: {
    kind: 'draft_outreach',
    jobNumber: 7,
    label: 'Email preparation',
    targetKind: 'person',
    scopeGated: true,
    agent: 'email-drafter',
    skill: 'draft-outreach',
    defaultPriority: 70,
    atomicUnit: 'One person, purpose, program and campaign',
  },
  verify_person: {
    kind: 'verify_person',
    jobNumber: 0,
    label: 'Targeted verification',
    targetKind: 'person',
    scopeGated: true,
    agent: 'verifier',
    skill: 'research-person',
    defaultPriority: 55,
    atomicUnit: 'Critical claims for one person',
  },
};

const JOB_BY_NUMBER: Record<number, JobKind> = {
  1: 'discover_university',
  2: 'research_programs',
  3: 'discover_people',
  4: 'map_person_sources',
  5: 'research_person',
  6: 'research_lab',
  7: 'draft_outreach',
};

export function jobKindForNumber(n: number): JobKind | undefined {
  return JOB_BY_NUMBER[n];
}

export function jobNumberForKind(kind: JobKind): number {
  return JOBS[kind].jobNumber;
}

export interface TaskIdentity {
  jobKind: JobKind;
  targetKind: string;
  targetId: string;
  scopeId: string | null;
  scopeVersion: number | null;
  params: Record<string, unknown>;
  inputRevisions: Record<string, string | number>;
  schemaVersion: number;
}

/**
 * A task's identity is job kind + target + scope version + relevant input
 * revisions + parameters + schema version. Two enqueue requests that agree on
 * all of those are the same task.
 */
export function taskDedupeKey(identity: TaskIdentity): string {
  return fingerprint({
    jobKind: identity.jobKind,
    targetKind: identity.targetKind,
    targetId: identity.targetId,
    scopeId: identity.scopeId,
    scopeVersion: identity.scopeVersion,
    params: identity.params,
    inputRevisions: identity.inputRevisions,
    schemaVersion: identity.schemaVersion,
  });
}

export function inputFingerprint(inputRevisions: Record<string, string | number>): string {
  return fingerprint(inputRevisions);
}
