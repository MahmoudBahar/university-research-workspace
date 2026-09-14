import { existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureDir,
  generateViews,
  nextActions,
  openWorkspace,
  reconcileVault,
  checkLinks,
  workspaceStatus,
  writeFileAtomic,
  lastDriverProbe,
  temporalSource,
  snapshotApplicantRevision,
  workspacePaths,
} from '@urw/core';
import type { CommandSpec } from '../context.js';
import { emit, table } from '../output.js';
import { flagBool, flagString } from '../args.js';

const APPLICANT_SEEDS: { template: string; target: string }[] = [
  { template: 'applicant-profile.md', target: 'profile.md' },
  { template: 'applicant-email-style.md', target: 'email-style.md' },
];

export const workspaceCommands: Record<string, CommandSpec> = {
  init: {
    summary: 'Create the workspace directories, database schema and blank applicant templates.',
    usage: 'init [--root <dir>]',
    handler: async (ctx) => {
      const root = flagString(ctx.args, 'root') ?? process.cwd();
      const paths = workspacePaths(root);
      const created: string[] = [];
      for (const dir of [
        paths.vault,
        join(paths.vault, 'universities'),
        join(paths.vault, 'units'),
        join(paths.vault, 'programs'),
        join(paths.vault, 'people'),
        join(paths.vault, 'labs'),
        join(paths.vault, 'publications'),
        join(paths.vault, 'sources'),
        join(paths.vault, 'outreach'),
        join(paths.vault, 'views'),
        paths.data,
        paths.runs,
        paths.revisions,
        paths.commits,
        paths.cache,
        paths.backups,
        paths.tmp,
        paths.applicant,
        join(paths.applicant, 'overrides'),
        join(paths.applicant, 'documents'),
        join(paths.applicant, 'extracted'),
      ]) {
        if (!existsSync(dir)) {
          ensureDir(dir);
          created.push(dir.slice(paths.root.length + 1));
        }
      }

      const ws = await openWorkspace({ root, create: true });
      const migration = ws.db.migrate();

      for (const seed of APPLICANT_SEEDS) {
        const source = join(paths.templates, seed.template);
        const target = join(paths.applicant, seed.target);
        if (existsSync(source) && !existsSync(target)) {
          copyFileSync(source, target);
          created.push(join('applicant', seed.target));
        }
      }
      for (const kind of ['profile', 'style'] as const) {
        const file = kind === 'profile' ? 'profile.md' : 'email-style.md';
        if (existsSync(join(paths.applicant, file))) snapshotApplicantRevision(ws, kind);
      }

      const views = generateViews(ws);
      emit(
        ctx.out,
        [
          `Workspace ready at ${paths.root}`,
          `Database driver: ${ws.db.driverName} (schema version ${migration.current})`,
          `Created: ${created.length === 0 ? 'nothing new' : created.join(', ')}`,
          `Views written: ${views.written.join(', ')}`,
          '',
          'Next: start the interface with `npm start`, or begin research with /research-university "University name".',
        ],
        { root: paths.root, created, driver: ws.db.driverName, schemaVersion: migration.current, views: views.written },
      );
      ws.close();
    },
  },

  status: {
    summary: 'Show progress by job, ready candidates, blockers and outreach state.',
    usage: 'status [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const status = workspaceStatus(ws);
      const actions = nextActions(ws);
      const lines = [
        `Database: ${status.driver}`,
        '',
        'Jobs',
        table(
          status.jobs.map((job) => ({
            job: job.jobNumber || '-',
            kind: job.jobKind,
            ready: job.ready,
            ...job.counts,
          })),
          ['job', 'kind', 'ready', 'pending', 'blocked', 'running', 'partial', 'complete', 'retryable_failed', 'failed', 'cancelled', 'stale'],
        ),
        '',
        `Universities: ${status.universities.map((u) => `${u.name} (${u.id}, ${u.units} units)`).join('; ') || 'none'}`,
        `Ready for outreach: ${status.readyCandidates.filter((c) => c.emailReady).length} of ${status.readyCandidates.length} research-complete candidates`,
        `Outreach: ${JSON.stringify(status.outreach.byState)} | due ${status.outreach.due} | overdue ${status.outreach.overdue} | recorded sends ${status.outreach.sent}`,
        `Discovery queue: ${status.discoveryQueue} | duplicate candidates: ${status.duplicateCandidates} | note issues: ${status.openNoteIssues} | pending commits: ${status.pendingCommits}`,
        '',
        'Next actions',
        ...actions.map((action) => `  - ${action}`),
      ];
      emit(ctx.out, lines, { status, actions });
    },
  },

  reconcile: {
    summary: 'Recover interrupted commits and bring the index back in step with the files on disk.',
    usage: 'reconcile [--full] [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const report = reconcileVault(ws, { full: flagBool(ctx.args, 'full') });
      emit(
        ctx.out,
        [
          `Commits recovered: ${report.commitRecovery.recovered.length}, conflicts: ${report.commitRecovery.conflicts.length}, rejected: ${report.commitRecovery.rejected.length}`,
          `Notes scanned: ${report.scanned} (added ${report.added}, updated ${report.updated}, unchanged ${report.unchanged}, ${report.skippedByStat} skipped by size+mtime)`,
          `Missing files: ${report.missingFiles.length}`,
          `Readiness refreshed for ${report.readinessRefreshed} people; ${report.prunedEvents} old change-feed rows pruned.`,
          report.issues.length === 0 ? 'No issues.' : `Issues:\n${report.issues.map((i) => `  - ${i.path}: ${i.kind} — ${i.detail}`).join('\n')}`,
        ],
        report,
      );
    },
  },

  'verify-links': {
    summary: 'Check that every relative Markdown link resolves and filenames stay portable.',
    usage: 'verify-links [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const report = checkLinks(ws);
      const lines = [
        `Notes checked: ${report.notesChecked}, links checked: ${report.linksChecked}`,
        report.problems.length === 0
          ? 'All relative links resolve.'
          : `Problems:\n${report.problems.map((p) => `  - ${p.from} -> ${p.target} (${p.kind})${p.detail ? ` ${p.detail}` : ''}`).join('\n')}`,
        report.caseCollisions.length === 0 ? 'No case-insensitive filename collisions.' : `Case collisions: ${report.caseCollisions.length}`,
        report.duplicateTitles.length === 0 ? 'No duplicate display titles.' : `Duplicate titles: ${report.duplicateTitles.map((d) => d.title).join(', ')}`,
      ];
      emit(ctx.out, lines, report);
      if (report.problems.some((p) => p.kind === 'broken') && !flagBool(ctx.args, 'allowBroken')) {
        process.exitCode = 2;
      }
    },
  },

  views: {
    summary: 'Rebuild the generated dashboards under vault/views.',
    usage: 'views [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = generateViews(ws);
      emit(ctx.out, `Wrote ${result.written.length} view(s): ${result.written.join(', ')}`, result);
    },
  },

  diagnose: {
    summary: 'Report runtime, driver, path and capability details for troubleshooting.',
    usage: 'diagnose [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const probe = lastDriverProbe();
      const info = {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        driver: ws.db.driverName,
        driverProbe: probe,
        temporal: temporalSource,
        integrity: ws.db.integrityCheck(),
        schemaVersion: ws.db.get<{ v: number }>('SELECT COALESCE(MAX(id), 0) AS v FROM schema_migrations')?.v ?? 0,
        migrationWarnings: ws.db.lastMigrationWarnings,
        paths: ws.paths,
        config: ws.config,
        runs: existsSync(ws.paths.runs) ? readdirSync(ws.paths.runs).length : 0,
      };
      emit(
        ctx.out,
        [
          `Node ${info.node} on ${info.platform}/${info.arch}`,
          `SQLite driver: ${info.driver} (attempts: ${(probe?.attempted ?? []).map((a: { driver: string; ok: boolean; error?: string }) => `${a.driver}=${a.ok ? 'ok' : a.error}`).join(', ')})`,
          `Temporal implementation: ${info.temporal}`,
          `Database integrity: ${info.integrity}`,
          `Schema version: ${info.schemaVersion}${info.migrationWarnings.length ? ` (WARNING: ${info.migrationWarnings.join(' ')})` : ''}`,
          `Workspace root: ${ws.paths.root}`,
          `Run directories: ${info.runs}`,
        ],
        info,
      );
    },
  },

  'args-parse': {
    summary: 'Parse raw skill arguments from a file into structured JSON (never through a shell).',
    usage: 'args-parse --file <path>',
    handler: async (ctx) => {
      const file = flagString(ctx.args, 'file');
      if (!file) throw new Error('Provide --file pointing at a UTF-8 file containing the raw argument string.');
      const { readFileSync } = await import('node:fs');
      const raw = readFileSync(file, 'utf8').trim();
      const { parseArgs } = await import('../args.js');
      const tokens = tokenise(raw);
      const parsed = parseArgs(tokens);
      emit(ctx.out, JSON.stringify(parsed, null, 2), parsed);
    },
  },
};

/** Split a raw argument string into tokens, honouring single and double quotes. */
export function tokenise(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

export { writeFileAtomic };
