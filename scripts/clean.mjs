import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { rootDir } from './lib.mjs';

const targets = [
  'packages/db/dist',
  'packages/core/dist',
  'packages/cli/dist',
  'apps/server/dist',
  'apps/web/dist',
  'packages/db/tsconfig.tsbuildinfo',
  'packages/core/tsconfig.tsbuildinfo',
  'packages/cli/tsconfig.tsbuildinfo',
  'apps/server/tsconfig.tsbuildinfo',
];
for (const target of targets) {
  rmSync(join(rootDir, target), { recursive: true, force: true });
}
process.stdout.write('Removed build output. Runtime data under data/ and vault/ was left untouched.\n');
