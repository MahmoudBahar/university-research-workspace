import { join } from 'node:path';
import { binPath, npx, rootDir, spawnBackground } from './lib.mjs';

// Compile the shared packages once, then run the API and the Vite dev server.
await npx(['tsc', '-b', 'tsconfig.build.json']);

const api = spawnBackground(process.execPath, [join(rootDir, 'apps', 'server', 'dist', 'main.js')], {
  env: { URW_SERVE_WEB: '0' },
});
const web = spawnBackground(process.execPath, [binPath('vite'), '--host', '127.0.0.1'], { cwd: join(rootDir, 'apps', 'web') });

const shutdown = () => {
  api.kill();
  web.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const child of [api, web]) {
  child.on('exit', (code) => {
    if (code !== 0) shutdown();
  });
}
