import { Router } from 'express';
import { z } from 'zod';
import {
  cancelTask,
  enqueueTask,
  getTask,
  JOBS,
  jobKindForNumber,
  listCheckpoints,
  listTasks,
  reclaimExpiredLeases,
  refreshAllTaskStates,
  retryTask,
  taskCounts,
  type JobKind,
  type Workspace,
} from '@urw/core';
import { parseBody, parseQuery, route } from '../http.js';

const JobKindSchema = z.string().transform((value) => {
  const asNumber = Number(value);
  const kind = Number.isFinite(asNumber) ? jobKindForNumber(asNumber) : (value as JobKind);
  if (!kind || !(kind in JOBS)) throw new Error(`Unknown job: ${value}`);
  return kind;
});

export function taskRoutes(ws: Workspace): Router {
  const router = Router();

  router.get(
    '/tasks',
    route((req) => {
      const query = parseQuery(
        z.object({
          job: JobKindSchema.optional(),
          state: z.string().optional(),
          target: z.string().optional(),
          ready: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().max(1000).optional(),
          university: z.string().min(1).max(200).optional(),
        }),
        req,
      );
      refreshAllTaskStates(ws);
      const tasks = listTasks(ws, {
        jobKind: query.job,
        state: query.state as never,
        targetId: query.target,
        ready: query.ready,
        limit: query.limit,
        universityId: query.university,
      });
      return {
        tasks,
        counts: taskCounts(ws),
        jobs: Object.values(JOBS).map((job) => ({
          kind: job.kind,
          number: job.jobNumber,
          label: job.label,
          skill: job.skill,
          agent: job.agent,
          atomicUnit: job.atomicUnit,
        })),
        concurrency: ws.config.concurrency,
        /**
         * The interface queues work; an interactive Claude session executes it.
         * Nothing here starts a model run.
         */
        execution: {
          mode: 'interactive_claude_code',
          note: 'Queued tasks wait for an active Claude Code session. This server never starts one.',
        },
      };
    }),
  );

  router.post(
    '/tasks',
    route((req) => {
      const body = parseBody(
        z.object({
          job: JobKindSchema,
          targetId: z.string().min(1),
          params: z.record(z.string(), z.unknown()).default({}),
          priority: z.number().int().optional(),
        }),
        req,
      );
      return enqueueTask(ws, {
        jobKind: body.job,
        targetId: body.targetId,
        params: body.params,
        priority: body.priority,
        requestedBy: 'ui',
      });
    }),
  );

  router.get(
    '/tasks/:id',
    route((req) => {
      const task = getTask(ws, String(req.params['id']));
      return {
        task,
        checkpoints: listCheckpoints(ws, task.id),
        runs: ws.db.all('SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC', task.id),
        command: dispatchCommand(task.job_kind, task.target_id),
      };
    }),
  );

  router.post(
    '/tasks/:id/retry',
    route((req) => ({ state: retryTask(ws, String(req.params['id'])) })),
  );

  router.post(
    '/tasks/:id/cancel',
    route((req) => {
      const body = parseBody(z.object({ reason: z.string().min(3) }), req);
      cancelTask(ws, String(req.params['id']), body.reason);
      return { ok: true };
    }),
  );

  router.post('/tasks/reclaim', route(() => reclaimExpiredLeases(ws)));

  router.get(
    '/queue/commands',
    route(() => {
      refreshAllTaskStates(ws);
      const ready = listTasks(ws, { ready: true });
      const grouped = new Map<string, number>();
      for (const task of ready) grouped.set(task.job_kind, (grouped.get(task.job_kind) ?? 0) + 1);
      return {
        readyCount: ready.length,
        byJob: [...grouped.entries()].map(([jobKind, count]) => ({
          jobKind,
          count,
          skill: JOBS[jobKind as JobKind].skill,
          command: `/${JOBS[jobKind as JobKind].skill}${jobKind === 'draft_outreach' ? ' --ready' : ''}`,
        })),
        resumeCommand: '/research-university --resume',
        note:
          'These commands run in your Claude Code session. If no session is running, the queue simply waits; nothing starts by itself.',
      };
    }),
  );

  return router;
}

function dispatchCommand(jobKind: string, targetId: string): string {
  const job = JOBS[jobKind as JobKind];
  if (!job) return '/research-status';
  switch (job.kind) {
    case 'research_person':
      return `/research-person ${targetId}`;
    case 'draft_outreach':
      return `/draft-outreach ${targetId}`;
    case 'research_lab':
      return `/research-labs ${targetId}`;
    case 'map_person_sources':
      return `/map-person ${targetId}`;
    default:
      return `/research-university --job ${job.jobNumber}`;
  }
}
