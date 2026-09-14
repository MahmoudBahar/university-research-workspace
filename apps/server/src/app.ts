import express, { type Express, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextActions, reconcileVault, workspaceStatus, type Workspace } from '@urw/core';
import { errorHandler, route } from './http.js';
import { allowedOrigins, hostGuard, loopbackGuard, type LocalSession } from './security.js';
import { registryRoutes } from './routes/registry.js';
import { taskRoutes } from './routes/tasks.js';
import { outreachRoutes } from './routes/outreach.js';
import { applicantRoutes } from './routes/applicant.js';
import { eventRoutes } from './routes/events.js';
import { settingsRoutes } from './routes/settings.js';
import { searchRoutes } from './routes/search.js';

export interface AppOptions {
  workspace: Workspace;
  session: LocalSession;
  port: number;
  serveWeb: boolean;
  devOrigins?: string[];
}

export function createApp(options: AppOptions): Express {
  const { workspace: ws } = options;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  const guardOptions = { port: options.port, session: options.session, devOrigins: options.devOrigins };
  // Loopback and Host are checked on every request, before any body is parsed.
  app.use(hostGuard(guardOptions));
  app.use('/api', loopbackGuard(guardOptions));
  app.use('/api', express.json({ limit: '48mb' }));

  app.get(
    '/api/bootstrap',
    route(() => ({
      session: options.session.token,
      allowedOrigins: allowedOrigins({ port: options.port, session: options.session, devOrigins: options.devOrigins }),
      status: workspaceStatus(ws),
      actions: nextActions(ws),
      root: ws.paths.root,
      execution: {
        mode: 'interactive_claude_code',
        note:
          'This interface queues and reviews work. Research runs in your own Claude Code session; the server never starts one and holds no model credentials.',
      },
    })),
  );

  app.use('/api', registryRoutes(ws));
  app.use('/api', taskRoutes(ws));
  app.use('/api', outreachRoutes(ws));
  app.use('/api', applicantRoutes(ws));
  app.use('/api', eventRoutes(ws));
  app.use('/api', settingsRoutes(ws));
  app.use('/api', searchRoutes(ws));

  if (options.serveWeb) {
    // Resolved from this module, so a workspace opened at another path still
    // gets the bundle that was built alongside this server.
    const here = dirname(fileURLToPath(import.meta.url));
    const webDist = join(here, '..', '..', 'web', 'dist');
    if (existsSync(webDist)) {
      app.use(express.static(webDist, { index: false, maxAge: '5m' }));
      app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
        res.sendFile(join(webDist, 'index.html'));
      });
    }
  }

  app.use(errorHandler);
  return app;
}

export function reconcileOnStart(ws: Workspace): void {
  // Recover interrupted commits and pick up edits made while the app was closed.
  const report = reconcileVault(ws);
  const parts = [
    `commits recovered: ${report.commitRecovery.recovered.length}`,
    `notes: +${report.added} ~${report.updated}`,
  ];
  if (report.commitRecovery.conflicts.length > 0) parts.push(`conflicts: ${report.commitRecovery.conflicts.length}`);
  if (report.issues.length > 0) parts.push(`issues: ${report.issues.length}`);
  process.stdout.write(`Reconciled on start (${parts.join(', ')}).\n`);
}
