import type { Workspace } from '../workspace.js';
import { currentScopeVersion, getScopeForUniversity, unitTree, type UnitTreeNode } from './scope.js';

export interface UnitProgress {
  unitId: string;
  name: string;
  unitType: string;
  decision: string;
  depth: number;
  tasks: { total: number; complete: number; blocked: number; running: number; pending: number; failed: number };
  people: { total: number; researchComplete: number; emailReady: number };
  programs: number;
}

function flatten(nodes: UnitTreeNode[], depth = 0, out: { node: UnitTreeNode; depth: number }[] = [], seen = new Set<string>()): { node: UnitTreeNode; depth: number }[] {
  for (const node of nodes) {
    if (!seen.has(node.id)) {
      seen.add(node.id);
      out.push({ node, depth });
    }
    flatten(node.children, depth + 1, out, seen);
  }
  return out;
}

/**
 * Per-unit progress: the unit's own tasks plus the tasks of the people
 * affiliated with it, people counts and program count. Derived on demand from
 * the task table and the registry; nothing is cached.
 */
export function unitProgress(ws: Workspace, universityId: string): UnitProgress[] {
  const scope = getScopeForUniversity(ws, universityId);
  const versionId = scope ? currentScopeVersion(ws, scope.id).id : undefined;
  const tree = unitTree(ws, universityId, versionId);
  return flatten(tree).map(({ node, depth }) => {
    const taskRows = ws.db.all<{ state: string; n: number }>(
      `SELECT state, COUNT(*) AS n FROM tasks
       WHERE (target_kind = 'unit' AND target_id = ?)
          OR (target_kind = 'person' AND target_id IN (
                SELECT r.from_id FROM relationships r WHERE r.to_id = ? AND r.rel_type = 'affiliated_with'))
       GROUP BY state`,
      node.id,
      node.id,
    );
    const tasks = { total: 0, complete: 0, blocked: 0, running: 0, pending: 0, failed: 0 };
    for (const row of taskRows) {
      tasks.total += row.n;
      if (row.state === 'complete') tasks.complete += row.n;
      else if (row.state === 'blocked') tasks.blocked += row.n;
      else if (row.state === 'running') tasks.running += row.n;
      else if (row.state === 'failed' || row.state === 'cancelled') tasks.failed += row.n;
      else tasks.pending += row.n;
    }
    const people = ws.db.get<{ total: number; research_complete: number; email_ready: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(p.research_complete), 0) AS research_complete,
              COALESCE(SUM(p.email_ready), 0) AS email_ready
       FROM people p
       JOIN entities e ON e.id = p.entity_id AND e.merged_into IS NULL
       WHERE p.entity_id IN (SELECT r.from_id FROM relationships r WHERE r.to_id = ? AND r.rel_type = 'affiliated_with')`,
      node.id,
    );
    const programs = ws.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM relationships r WHERE r.from_id = ? AND r.rel_type = 'administers_program'",
      node.id,
    );
    return {
      unitId: node.id,
      name: node.officialName,
      unitType: node.unitType,
      decision: node.decision,
      depth,
      tasks,
      people: {
        total: people?.total ?? 0,
        researchComplete: Number(people?.research_complete ?? 0),
        emailReady: Number(people?.email_ready ?? 0),
      },
      programs: programs?.n ?? 0,
    };
  });
}
