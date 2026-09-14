import { openWorkspace } from '@urw/core';
import { createApp, reconcileOnStart } from './app.js';
import { ensureLocalSession } from './security.js';

const serveWeb = process.env['URW_SERVE_WEB'] !== '0';
const devOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];

const ws = await openWorkspace({ root: process.env['URW_ROOT'] });
reconcileOnStart(ws);

const port = Number(process.env['URW_PORT'] ?? ws.config.server.port);
const session = ensureLocalSession(ws);
const app = createApp({ workspace: ws, session, port, serveWeb, devOrigins });

const server = app.listen(port, '127.0.0.1', () => {
  process.stdout.write(
    [
      '',
      `University Research Workspace API on http://127.0.0.1:${port}`,
      serveWeb ? `Interface:            http://127.0.0.1:${port}` : 'Interface:            run the Vite dev server (npm run dev)',
      `Workspace root:       ${ws.paths.root}`,
      `Database driver:      ${ws.db.driverName}`,
      '',
      'This server queues and reviews work. Research runs in your Claude Code session;',
      'nothing here starts a model run or sends an email.',
      '',
    ].join('\n'),
  );
});

const shutdown = (signal: string): void => {
  process.stdout.write(`\nReceived ${signal}; closing.\n`);
  server.close(() => {
    ws.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
