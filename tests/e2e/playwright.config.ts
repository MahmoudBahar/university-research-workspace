import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const port = Number(process.env['URW_E2E_PORT'] ?? 5188);

/**
 * Browser flows run against the real API and core, on a throwaway workspace
 * seeded with the fictional Northvale fixtures. No real institution is touched.
 */
export default defineConfig({
  testDir: here,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  globalSetup: join(here, 'global-setup.ts'),
  webServer: {
    command: `node apps/server/dist/main.js`,
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}/api/bootstrap`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      URW_ROOT: process.env['URW_E2E_ROOT'] ?? join(repoRoot, 'data', 'tmp', 'e2e-workspace'),
      URW_PORT: String(port),
      URW_SERVE_WEB: '1',
    },
  },
});
