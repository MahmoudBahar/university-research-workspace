import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/**
 * Seed the fictional workspace if it is not there yet.
 *
 * This never deletes the directory: Playwright may already have started the web
 * server against it, and removing the database file underneath a live
 * connection produces a server serving a workspace that no longer exists.
 * `npm run test:e2e` wipes it beforehand, while nothing is attached.
 */
export default function globalSetup(): void {
  const root = process.env['URW_E2E_ROOT'] ?? join(repoRoot, 'data', 'tmp', 'e2e-workspace');
  if (existsSync(join(root, 'data', 'research.sqlite'))) return;

  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'demo.mjs'), root], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to seed the e2e workspace: ${result.stderr || result.stdout}`);
  }
}
