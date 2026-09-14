import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyJobResult,
  approveApplicantRevision,
  claimTask,
  enqueueTask,
  openWorkspace,
  snapshotApplicantRevision,
  type JobKind,
  type Workspace,
} from '@urw/core';

const here = dirname(fileURLToPath(import.meta.url));
// Compiled to tests/dist/helpers, so the repository root is three levels up.
export const fixturesDir = join(here, '..', '..', 'fixtures');
const repoRoot = join(here, '..', '..', '..');

export interface TestWorkspace {
  ws: Workspace;
  root: string;
  cleanup: () => void;
}

/** A throwaway workspace on a temporary directory, with its own database. */
export async function makeWorkspace(options: { config?: Record<string, unknown> } = {}): Promise<TestWorkspace> {
  const root = mkdtempSync(join(tmpdir(), 'urw-test-'));
  for (const dir of [
    'vault/universities',
    'vault/units',
    'vault/programs',
    'vault/people',
    'vault/labs',
    'vault/publications',
    'vault/sources',
    'vault/outreach',
    'vault/views',
    'data/runs',
    'data/revisions',
    'data/commits',
    'data/cache',
    'data/backups',
    'data/tmp',
    'applicant/overrides',
    'applicant/documents',
    'applicant/extracted',
    'config',
    'templates',
  ]) {
    mkdirSync(join(root, ...dir.split('/')), { recursive: true });
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'university-research-workspace', private: true }, null, 2));
  if (options.config) {
    writeFileSync(join(root, 'config', 'research.json'), JSON.stringify(options.config, null, 2));
  }
  const templates = join(repoRoot, 'templates');
  if (existsSync(templates)) cpSync(templates, join(root, 'templates'), { recursive: true });

  const ws = await openWorkspace({ root, create: true });
  return {
    ws,
    root,
    cleanup: () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      // Windows refuses to delete files another handle still holds; retry briefly.
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

export function seedApplicant(ws: Workspace, options: { approve?: boolean } = {}): void {
  const profile = `---
schema_version: 1
id: applicant-profile
type: applicant_profile
title: Applicant profile
revision: 1
---

# Applicant profile

- Full name: A. Fictional Applicant
- Degree: BSc in Electrical Engineering, Fictional State University, 2025
- Background: adaptive filtering coursework and simulation work
- IELTS Academic 7.5 overall, taken 2026-03-14
`;
  const style = `---
schema_version: 1
id: applicant-email-style
type: applicant_style
title: Email drafting guidance
revision: 1
---

# Email drafting guidance

- Tone: direct and specific.
- Never claim a paper was read when only the abstract was available.
`;
  writeFileSync(join(ws.paths.applicant, 'profile.md'), profile);
  writeFileSync(join(ws.paths.applicant, 'email-style.md'), style);
  if (options.approve !== false) {
    for (const kind of ['profile', 'style'] as const) {
      const revision = snapshotApplicantRevision(ws, kind);
      approveApplicantRevision(ws, kind, revision.sha256, { actor: 'test' });
    }
  }
}

export interface RunJobOptions {
  jobKind: JobKind;
  targetId: string;
  result: unknown;
  owner?: string;
  params?: Record<string, unknown>;
}

/** Enqueue, claim and complete a job the way the orchestrator does. */
export function runJob(ws: Workspace, options: RunJobOptions): { taskId: string; summary: Record<string, unknown>; state: string } {
  const enqueued = enqueueTask(ws, {
    jobKind: options.jobKind,
    targetId: options.targetId,
    params: options.params ?? {},
    requestedBy: 'test',
  });
  const owner = options.owner ?? `test-${process.pid}`;
  const claimed = claimTask(ws, { owner, taskId: enqueued.taskId, force: true });
  if (!claimed) throw new Error(`Could not claim ${options.jobKind} for ${options.targetId}`);
  const applied = applyJobResult(ws, {
    taskId: claimed.task.id,
    owner,
    fencingToken: claimed.fencingToken,
    result: options.result,
  });
  return { taskId: claimed.task.id, summary: applied.summary, state: applied.state };
}

export function unitIdByName(ws: Workspace, officialName: string): string {
  const row = ws.db.get<{ entity_id: string }>('SELECT entity_id FROM academic_units WHERE official_name = ?', officialName);
  if (!row) throw new Error(`No unit named ${officialName}`);
  return row.entity_id;
}

export function personIdByName(ws: Workspace, fullName: string): string {
  const row = ws.db.get<{ entity_id: string }>('SELECT entity_id FROM people WHERE full_name = ?', fullName);
  if (!row) throw new Error(`No person named ${fullName}`);
  return row.entity_id;
}

export function programIdByTitle(ws: Workspace, title: string): string {
  const row = ws.db.get<{ entity_id: string }>('SELECT entity_id FROM programs WHERE official_title = ?', title);
  if (!row) throw new Error(`No program titled ${title}`);
  return row.entity_id;
}
