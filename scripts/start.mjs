import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { npx, rootDir, run } from './lib.mjs';

const serverEntry = join(rootDir, 'apps', 'server', 'dist', 'main.js');
const webBundle = join(rootDir, 'apps', 'web', 'dist', 'index.html');

if (!existsSync(serverEntry) || !existsSync(webBundle)) {
  process.stdout.write('Building before start...\n');
  await npx(['tsc', '-b', 'tsconfig.build.json']);
  await npx(['vite', 'build'], { cwd: join(rootDir, 'apps', 'web') });
}
await run(process.execPath, [serverEntry], { env: { URW_SERVE_WEB: '1' } });
