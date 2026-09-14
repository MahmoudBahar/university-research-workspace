import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyJobResult,
  buildContextPacket,
  claimTask,
  cancelTask,
  confirmSelection,
  currentScopeVersion,
  describeDispatch,
  enqueueScopedWork,
  enqueueTask,
  failTask,
  getScopeForUniversity,
  getTask,
  jobKindForNumber,
  listCheckpoints,
  listTasks,
  reclaimExpiredLeases,
  refreshAllTaskStates,
  renewLease,
  retryTask,
  saveCheckpoint,
  scopeSummary,
  startUniversityResearch,
  unitTree,
  updateSelection,
  readyForOutreach,
  sourcesNeedingBrowser,
  type JobKind,
  type UnitTreeNode,
} from '@urw/core';
import type { CommandSpec } from '../context.js';
import { emit, table, truncate } from '../output.js';
import { flagBool, flagList, flagNumber, flagString, requireFlag } from '../args.js';

function renderTree(nodes: UnitTreeNode[], depth = 0): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const marker = node.decision === 'included' ? '[x]' : node.decision === 'excluded' ? '[-]' : '[ ]';
    lines.push(`${'  '.repeat(depth)}${marker} ${node.officialName} (${node.unitType}) — ${node.id}${node.explicit ? '' : ' (inherited)'}`);
    lines.push(...renderTree(node.children, depth + 1));
  }
  return lines;
}

function resolveJobKind(value: string | undefined): JobKind | undefined {
  if (!value) return undefined;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return jobKindForNumber(asNumber);
  return value as JobKind;
}

export const researchCommands: Record<string, CommandSpec> = {
  'university start': {
    summary: 'Register a university and queue Job 1 discovery.',
    usage: 'university start --name "University name" [--homepage <url>] [--domain <domain>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = startUniversityResearch(ws, {
        name: requireFlag(ctx.args, 'name'),
        homepageUrl: flagString(ctx.args, 'homepage'),
        domain: flagString(ctx.args, 'domain'),
      });
      emit(
        ctx.out,
        [
          `University: ${result.universityId} (${result.created ? 'created' : 'existing record reused'})`,
          `Scope: ${result.scopeId}`,
          `Job 1 task: ${result.taskId}`,
        ],
        result,
      );
    },
  },

  'university list': {
    summary: 'List registered universities and their selection state.',
    usage: 'university list [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = ws.db.all<{ entity_id: string; official_name: string; domain: string | null }>(
        'SELECT entity_id, official_name, domain FROM universities ORDER BY official_name',
      );
      const data = rows.map((row) => {
        const scope = getScopeForUniversity(ws, row.entity_id);
        return {
          id: row.entity_id,
          name: row.official_name,
          domain: row.domain ?? '',
          scope: scope ? scopeSummary(ws, scope.id) : null,
        };
      });
      emit(
        ctx.out,
        table(
          data.map((d) => ({
            id: d.id,
            name: d.name,
            scopeVersion: (d.scope as { currentVersion?: number } | null)?.currentVersion ?? '-',
            included: (d.scope as { explicitIncluded?: number } | null)?.explicitIncluded ?? 0,
          })),
          ['id', 'name', 'scopeVersion', 'included'],
        ),
        data,
      );
    },
  },

  'scope show': {
    summary: 'Show the organisational hierarchy with include, exclude and undecided marks.',
    usage: 'scope show --university <id> [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const universityId = requireFlag(ctx.args, 'university');
      const scope = getScopeForUniversity(ws, universityId);
      if (!scope) throw new Error(`No scope exists for ${universityId}. Run university start first.`);
      const version = currentScopeVersion(ws, scope.id);
      const draftRow = ws.db.get<{ id: string; version: number }>(
        "SELECT id, version FROM scope_versions WHERE scope_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1",
        scope.id,
      );
      const activeVersionId = draftRow?.id ?? version.id;
      const tree = unitTree(ws, universityId, activeVersionId);
      emit(
        ctx.out,
        [
          `Scope ${scope.id} — confirmed version ${scope.current_version}${draftRow ? `, draft version ${draftRow.version}` : ''}`,
          '',
          ...(tree.length === 0 ? ['(no units discovered yet)'] : renderTree(tree)),
          '',
          'Legend: [x] included, [-] excluded, [ ] undecided. Explicit child decisions override inherited ones.',
        ],
        { scope: scopeSummary(ws, scope.id), draftVersion: draftRow?.version ?? null, tree },
      );
    },
  },

  'scope select': {
    summary: 'Record include/exclude/undecided decisions into the draft selection.',
    usage: 'scope select --scope <id> --expect <version> --include <unit-id> --exclude <unit-id> [--undecided <unit-id>] [--note <text>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const scopeId = requireFlag(ctx.args, 'scope');
      const expected = flagNumber(ctx.args, 'expect');
      if (expected === undefined) throw new Error('Provide --expect with the confirmed scope version you are editing from.');
      const decisions = [
        ...flagList(ctx.args, 'include').map((unitId) => ({ unitId, decision: 'included' as const })),
        ...flagList(ctx.args, 'exclude').map((unitId) => ({ unitId, decision: 'excluded' as const })),
        ...flagList(ctx.args, 'undecided').map((unitId) => ({ unitId, decision: 'undecided' as const })),
      ];
      if (decisions.length === 0) throw new Error('Provide at least one --include, --exclude or --undecided unit id.');
      const draft = updateSelection(ws, {
        scopeId,
        expectedVersion: expected,
        decisions,
        note: flagString(ctx.args, 'note'),
      });
      emit(
        ctx.out,
        [`Draft selection version ${draft.version} updated with ${decisions.length} decision(s).`, 'Confirm it with: scope confirm'],
        { draftVersion: draft.version, decisions },
      );
    },
  },

  'scope confirm': {
    summary: 'Confirm the draft selection as the current versioned scope.',
    usage: 'scope confirm --scope <id> --expect <version> [--enqueue]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const scopeId = requireFlag(ctx.args, 'scope');
      const expected = flagNumber(ctx.args, 'expect');
      if (expected === undefined) throw new Error('Provide --expect with the version you are replacing.');
      const report = confirmSelection(ws, scopeId, expected);
      const enqueued = flagBool(ctx.args, 'enqueue') ? enqueueScopedWork(ws, scopeId) : null;
      emit(
        ctx.out,
        [
          `Scope ${scopeId} confirmed at version ${report.newVersion}.`,
          `Cancelled ${report.cancelledTasks} queued task(s), re-queued ${report.requeuedTasks}, marked ${report.staleRunningTasks} running task(s) stale.`,
          enqueued ? `Queued ${enqueued.enqueued.length} task(s) across ${enqueued.includedUnits} included unit(s).` : 'Run scope enqueue to queue unit-level work.',
        ],
        { report, enqueued },
      );
    },
  },

  'scope enqueue': {
    summary: 'Queue Job 2 and Job 3 for every included unit in the confirmed selection.',
    usage: 'scope enqueue --scope <id> [--jobs research_programs,discover_people]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const scopeId = requireFlag(ctx.args, 'scope');
      const jobs = flagList(ctx.args, 'jobs')
        .flatMap((value) => value.split(','))
        .map((value) => resolveJobKind(value.trim()))
        .filter((value): value is JobKind => Boolean(value));
      const report = enqueueScopedWork(ws, scopeId, jobs.length > 0 ? { jobs } : {});
      emit(
        ctx.out,
        `Queued ${report.enqueued.length} task(s) across ${report.includedUnits} included unit(s) at scope version ${report.version}.`,
        report,
      );
    },
  },

  'tasks list': {
    summary: 'List tasks with their blockers.',
    usage: 'tasks list [--job <1-7|kind>] [--state <state>] [--target <id>] [--ready] [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      refreshAllTaskStates(ws);
      const tasks = listTasks(ws, {
        jobKind: resolveJobKind(flagString(ctx.args, 'job')),
        state: flagString(ctx.args, 'state') as never,
        targetId: flagString(ctx.args, 'target'),
        ready: flagBool(ctx.args, 'ready'),
        limit: flagNumber(ctx.args, 'limit'),
      });
      emit(
        ctx.out,
        table(
          tasks.map((task) => ({
            id: task.id,
            job: task.job_kind,
            target: task.target_id,
            title: truncate(task.target_title, 28),
            state: task.state,
            attempts: task.attempts,
            blockers: truncate(task.blockers.map((b) => b.code).join(','), 34),
          })),
          ['id', 'job', 'target', 'title', 'state', 'attempts', 'blockers'],
        ),
        tasks,
      );
    },
  },

  'tasks enqueue': {
    summary: 'Queue one task for a job and target.',
    usage: 'tasks enqueue --job <1-7|kind> --target <entity-id> [--param key=value] [--priority <n>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const jobKind = resolveJobKind(requireFlag(ctx.args, 'job'));
      if (!jobKind) throw new Error('Unknown job. Use 1-7 or a job kind such as research_person.');
      const params: Record<string, unknown> = {};
      for (const pair of flagList(ctx.args, 'param')) {
        const index = pair.indexOf('=');
        if (index === -1) throw new Error(`--param expects key=value, received "${pair}"`);
        params[pair.slice(0, index)] = pair.slice(index + 1);
      }
      const result = enqueueTask(ws, {
        jobKind,
        targetId: requireFlag(ctx.args, 'target'),
        params,
        priority: flagNumber(ctx.args, 'priority'),
        requestedBy: 'user',
      });
      emit(ctx.out, `Task ${result.taskId} (${result.created ? 'created' : 'already queued'}) state=${result.state}`, result);
    },
  },

  'tasks claim': {
    summary: 'Claim the next ready task, take a lease, and write its context packet.',
    usage: 'tasks claim --owner <id> [--task <id>] [--job <1-7|kind>] [--target <id>] [--lease <seconds>] [--force]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const claimed = claimTask(ws, {
        owner: requireFlag(ctx.args, 'owner'),
        taskId: flagString(ctx.args, 'task'),
        jobKind: resolveJobKind(flagString(ctx.args, 'job')),
        targetId: flagString(ctx.args, 'target'),
        leaseSeconds: flagNumber(ctx.args, 'lease'),
        force: flagBool(ctx.args, 'force'),
      });
      if (!claimed) {
        emit(ctx.out, 'No ready task matched, or the concurrency limit is reached.', { claimed: null });
        return;
      }
      const packet = buildContextPacket(ws, claimed.task.id);
      const dispatch = describeDispatch(ws, claimed.task);
      emit(
        ctx.out,
        [
          `Claimed ${claimed.task.id} (${claimed.task.job_kind}) for ${dispatch.targetTitle ?? claimed.task.target_id}`,
          `Owner token: ${claimed.fencingToken}`,
          `Lease expires: ${claimed.leaseExpiresAt}`,
          `Agent: ${dispatch.agent}`,
          `Context packet: ${dispatch.contextPath}`,
          `Write the result to: ${dispatch.resultPath}`,
        ],
        { ...dispatch, packetInputs: Object.keys(packet.inputs) },
      );
    },
  },

  'tasks packet': {
    summary: 'Rebuild and print the context packet for a claimed task.',
    usage: 'tasks packet --task <id> [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const packet = buildContextPacket(ws, requireFlag(ctx.args, 'task'));
      emit(ctx.out, JSON.stringify(packet, null, 2), packet);
    },
  },

  'tasks renew': {
    summary: 'Renew the lease on a running task.',
    usage: 'tasks renew --task <id> --owner <id> --token <n> [--lease <seconds>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = renewLease(
        ws,
        requireFlag(ctx.args, 'task'),
        requireFlag(ctx.args, 'owner'),
        Number(requireFlag(ctx.args, 'token')),
        flagNumber(ctx.args, 'lease'),
      );
      emit(ctx.out, `Lease renewed until ${result.leaseExpiresAt}`, result);
    },
  },

  'tasks checkpoint': {
    summary: 'Save a resumable checkpoint for the claiming run.',
    usage: 'tasks checkpoint --task <id> --owner <id> --token <n> --kind <kind> [--label <text>] [--payload-file <path>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const payloadFile = flagString(ctx.args, 'payloadFile');
      const payload = payloadFile ? (JSON.parse(readFileSync(payloadFile, 'utf8')) as Record<string, unknown>) : {};
      const result = saveCheckpoint(ws, {
        taskId: requireFlag(ctx.args, 'task'),
        owner: requireFlag(ctx.args, 'owner'),
        fencingToken: Number(requireFlag(ctx.args, 'token')),
        kind: requireFlag(ctx.args, 'kind'),
        label: flagString(ctx.args, 'label'),
        payload,
      });
      emit(ctx.out, `Checkpoint ${result.seq} saved (${result.checkpointId})`, result);
    },
  },

  'tasks checkpoints': {
    summary: 'List saved checkpoints for a task across runs.',
    usage: 'tasks checkpoints --task <id> [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = listCheckpoints(ws, requireFlag(ctx.args, 'task'));
      emit(ctx.out, table(rows, ['seq', 'kind', 'label', 'created_at']), rows);
    },
  },

  'tasks complete': {
    summary: 'Validate a worker result, commit its artifacts, and mark the task complete.',
    usage: 'tasks complete --task <id> --owner <id> --token <n> [--result <path>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const taskId = requireFlag(ctx.args, 'task');
      const task = getTask(ws, taskId);
      const resultPath =
        flagString(ctx.args, 'result') ?? join(ws.paths.runs, task.current_run_id ?? '', 'result.json');
      const parsed = JSON.parse(readFileSync(resultPath, 'utf8')) as unknown;
      const outcome = applyJobResult(ws, {
        taskId,
        owner: requireFlag(ctx.args, 'owner'),
        fencingToken: Number(requireFlag(ctx.args, 'token')),
        result: parsed,
      });
      emit(
        ctx.out,
        [
          `Task ${taskId} -> ${outcome.state}`,
          `Commit ${outcome.commitId}`,
          `Installed ${outcome.installed.length} file(s):`,
          ...outcome.installed.map((file) => `  - ${file}`),
          '',
          JSON.stringify(outcome.summary, null, 2),
        ],
        outcome,
      );
    },
  },

  'tasks fail': {
    summary: 'Record a failure with its category and, where retryable, a saved cooldown.',
    usage: 'tasks fail --task <id> --owner <id> --token <n> --error <text> [--category transient|rate_limited|access_denied|unavailable_evidence|invalid_input|conflict] [--retry-after <seconds>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = failTask(ws, {
        taskId: requireFlag(ctx.args, 'task'),
        owner: requireFlag(ctx.args, 'owner'),
        fencingToken: Number(requireFlag(ctx.args, 'token')),
        error: requireFlag(ctx.args, 'error'),
        category: flagString(ctx.args, 'category') as never,
        retryAfterSeconds: flagNumber(ctx.args, 'retryAfter'),
      });
      emit(ctx.out, `Task state ${result.state}${result.nextAttemptAt ? `, retry after ${result.nextAttemptAt}` : ''}`, result);
    },
  },

  'tasks retry': {
    summary: 'Clear a cooldown and return a task to the ready queue.',
    usage: 'tasks retry --task <id>',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const state = retryTask(ws, requireFlag(ctx.args, 'task'));
      emit(ctx.out, `Task state ${state}`, { state });
    },
  },

  'tasks cancel': {
    summary: 'Cancel a task with a recorded reason.',
    usage: 'tasks cancel --task <id> --reason <text>',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      cancelTask(ws, requireFlag(ctx.args, 'task'), requireFlag(ctx.args, 'reason'));
      emit(ctx.out, 'Task cancelled.', { cancelled: true });
    },
  },

  'tasks reclaim': {
    summary: 'Reclaim tasks whose lease expired so their work can resume.',
    usage: 'tasks reclaim',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = reclaimExpiredLeases(ws);
      emit(ctx.out, `Reclaimed ${result.reclaimed} task(s).`, result);
    },
  },

  'people ready': {
    summary: 'List research-complete people and whether they are ready for Job 7.',
    usage: 'people ready [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = readyForOutreach(ws);
      emit(
        ctx.out,
        table(
          rows.map((row) => ({
            person: row.personId,
            name: row.name,
            emailReady: row.emailReady ? 'yes' : 'no',
            blockers: truncate(row.blockers.join('; '), 60),
          })),
          ['person', 'name', 'emailReady', 'blockers'],
        ),
        rows,
      );
    },
  },

  'people list': {
    summary: 'List people with roles, affiliations and research state.',
    usage: 'people list [--unit <id>] [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const unit = flagString(ctx.args, 'unit');
      const rows = unit
        ? ws.db.all(
            `SELECT p.entity_id, p.full_name, p.official_title, p.role_category, p.research_complete, p.email_ready
             FROM people p JOIN relationships r ON r.from_id = p.entity_id AND r.rel_type = 'affiliated_with'
             WHERE r.to_id = ? ORDER BY p.full_name`,
            unit,
          )
        : ws.db.all(
            `SELECT p.entity_id, p.full_name, p.official_title, p.role_category, p.research_complete, p.email_ready
             FROM people p JOIN entities e ON e.id = p.entity_id WHERE e.merged_into IS NULL ORDER BY p.full_name`,
          );
      emit(ctx.out, table(rows, ['entity_id', 'full_name', 'official_title', 'role_category', 'research_complete', 'email_ready']), rows);
    },
  },

  'sources needs-browser': {
    summary: 'List person sources whose last outcome a browser retrieval may still resolve (needs_browser, blocked, captcha, rate_limited).',
    usage: 'sources needs-browser [--person <id>] [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = sourcesNeedingBrowser(ws, flagString(ctx.args, 'person'));
      emit(
        ctx.out,
        rows.length === 0
          ? 'No sources are waiting for a browser retrieval.'
          : [
              table(
                rows.map((row) => ({
                  person: row.person_id,
                  name: truncate(row.person_title, 24),
                  category: row.source_category,
                  access: row.access_status,
                  method: row.fetch_method,
                  url: truncate(row.url, 48),
                })),
                ['person', 'name', 'category', 'access', 'method', 'url'],
              ),
              '',
              'With the Claude in Chrome extension connected, run /map-person <person-id> --retry-blocked to revisit these.',
            ],
        rows,
      );
    },
  },
};
