import type { Workspace } from './workspace.js';
import { writeFileAtomic, ensureDir } from './util/fsx.js';
import { join } from 'node:path';
import { todayIso } from './util/time.js';
import { markdownLink } from './notes/links.js';
import { workspaceStatus } from './status.js';
import { sendPlanner } from './outreach/sending.js';

function header(title: string, id: string): string {
  return `---
schema_version: 1
id: ${id}
type: view
title: ${title}
revision: 1
checked_at: ${todayIso()}
---

> Generated view. Workflow state lives in the database; this file is a convenience index and is safe to delete.

`;
}

/**
 * Generated dashboards for reading in Obsidian. These are never authoritative:
 * they are rebuilt from the registry on demand.
 */
export function generateViews(ws: Workspace): { written: string[] } {
  ensureDir(join(ws.paths.vault, 'views'));
  const written: string[] = [];
  const status = workspaceStatus(ws);

  const indexPath = join(ws.paths.vault, 'index.md');
  const universities = ws.db.all<{ entity_id: string; official_name: string; canonical_path: string | null }>(
    'SELECT u.entity_id, u.official_name, e.canonical_path FROM universities u JOIN entities e ON e.id = u.entity_id',
  );
  writeFileAtomic(
    indexPath,
    `${header('Research vault', 'view-index')}# Research vault

## Universities

${
  universities.length === 0
    ? '_No university has been researched yet._'
    : universities
        .map((u) => `- ${u.canonical_path ? markdownLink(u.official_name, 'index.md', u.canonical_path) : u.official_name}`)
        .join('\n')
}

## Views

- ${markdownLink('People', 'index.md', 'views/people.md')}
- ${markdownLink('Programs', 'index.md', 'views/programs.md')}
- ${markdownLink('Laboratories', 'index.md', 'views/labs.md')}
- ${markdownLink('Outreach', 'index.md', 'views/outreach.md')}
- ${markdownLink('Queue', 'index.md', 'views/queue.md')}

## Snapshot

- Ready candidates: ${status.readyCandidates.filter((c) => c.emailReady).length}
- Blocked tasks: ${status.blocked.length}
- Drafts awaiting review: ${status.outreach.byState['needs_review'] ?? 0}
- Recorded sends: ${status.outreach.sent}
`,
  );
  written.push('vault/index.md');

  const people = ws.db.all<{
    entity_id: string;
    full_name: string;
    official_title: string | null;
    role_category: string;
    research_complete: number;
    email_ready: number;
    canonical_path: string | null;
  }>(
    `SELECT p.entity_id, p.full_name, p.official_title, p.role_category, p.research_complete, p.email_ready, e.canonical_path
     FROM people p JOIN entities e ON e.id = p.entity_id WHERE e.merged_into IS NULL ORDER BY p.full_name`,
  );
  writeFileAtomic(
    join(ws.paths.vault, 'views', 'people.md'),
    `${header('People', 'view-people')}# People

| Person | Title | Role | Research | Email ready |
| --- | --- | --- | --- | --- |
${people
  .map(
    (p) =>
      `| ${p.canonical_path ? markdownLink(p.full_name, 'views/people.md', p.canonical_path) : p.full_name} | ${p.official_title ?? '—'} | ${p.role_category} | ${p.research_complete ? 'complete' : 'pending'} | ${p.email_ready ? 'yes' : 'no'} |`,
  )
  .join('\n')}
`,
  );
  written.push('vault/views/people.md');

  const programs = ws.db.all<{ entity_id: string; official_title: string; award: string | null; canonical_path: string | null }>(
    `SELECT pr.entity_id, pr.official_title, pr.award, e.canonical_path FROM programs pr
     JOIN entities e ON e.id = pr.entity_id WHERE e.merged_into IS NULL ORDER BY pr.official_title`,
  );
  writeFileAtomic(
    join(ws.paths.vault, 'views', 'programs.md'),
    `${header('Programs', 'view-programs')}# Programs

${
  programs.length === 0
    ? '_No programs recorded._'
    : programs
        .map(
          (p) =>
            `- ${p.canonical_path ? markdownLink(p.official_title, 'views/programs.md', p.canonical_path) : p.official_title}${p.award ? ` — ${p.award}` : ''}`,
        )
        .join('\n')
}
`,
  );
  written.push('vault/views/programs.md');

  const labs = ws.db.all<{ entity_id: string; official_name: string; canonical_path: string | null }>(
    `SELECT l.entity_id, l.official_name, e.canonical_path FROM labs l JOIN entities e ON e.id = l.entity_id
     WHERE e.merged_into IS NULL ORDER BY l.official_name`,
  );
  writeFileAtomic(
    join(ws.paths.vault, 'views', 'labs.md'),
    `${header('Laboratories', 'view-labs')}# Laboratories

${
  labs.length === 0
    ? '_No laboratories recorded._'
    : labs
        .map((l) => `- ${l.canonical_path ? markdownLink(l.official_name, 'views/labs.md', l.canonical_path) : l.official_name}`)
        .join('\n')
}
`,
  );
  written.push('vault/views/labs.md');

  const planner = sendPlanner(ws);
  writeFileAtomic(
    join(ws.paths.vault, 'views', 'outreach.md'),
    `${header('Outreach', 'view-outreach')}# Outreach

All sending is manual. A planned time that has passed never sends anything.

| Draft | Person | State | Planned (recipient) | Due | Sent |
| --- | --- | --- | --- | --- | --- |
${
  planner.length === 0
    ? '| _none_ | | | | | |'
    : planner
        .map(
          (row) =>
            `| ${row.outreachId} | ${row.personTitle ?? '—'} | ${row.state} | ${
              row.recipientRendering ? String((row.recipientRendering as { formatted: string }).formatted) : '—'
            } | ${row.due ?? '—'} | ${row.sent ? 'yes' : 'no'} |`,
        )
        .join('\n')
}
`,
  );
  written.push('vault/views/outreach.md');

  writeFileAtomic(
    join(ws.paths.vault, 'views', 'queue.md'),
    `${header('Queue', 'view-queue')}# Queue

| Job | Label | States | Ready |
| --- | --- | --- | --- |
${status.jobs
  .map(
    (job) =>
      `| ${job.jobNumber || '—'} | ${job.label} | ${Object.entries(job.counts).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'} | ${job.ready} |`,
  )
  .join('\n')}

## Blocked

${status.blocked.length === 0 ? '_Nothing is blocked._' : status.blocked.map((b) => `- ${b.jobKind} → ${b.targetId}: ${b.reasons.join(' ')}`).join('\n')}
`,
  );
  written.push('vault/views/queue.md');

  return { written };
}
