import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { npx, rootDir, run } from './lib.mjs';

// Browser flows run against the real API and core, on a workspace seeded with
// the fictional Northvale fixtures. The workspace is rebuilt here, before
// Playwright starts anything that could hold the database open.
const workspace = process.env['URW_E2E_ROOT'] ?? join(rootDir, 'data', 'tmp', 'e2e-workspace');
rmSync(workspace, { recursive: true, force: true });
await run(process.execPath, [join(rootDir, 'scripts', 'demo.mjs'), workspace], { stdio: 'ignore' });

await npx(['playwright', 'test', '--config', join('tests', 'e2e', 'playwright.config.ts'), ...process.argv.slice(2)], {
  cwd: rootDir,
  env: { URW_E2E_ROOT: workspace },
});
