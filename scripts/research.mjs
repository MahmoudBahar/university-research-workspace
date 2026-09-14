import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { npx, rootDir, run } from './lib.mjs';

const cliEntry = join(rootDir, 'packages', 'cli', 'dist', 'index.js');
if (!existsSync(cliEntry)) {
  process.stderr.write('Building the TypeScript packages first...\n');
  await npx(['tsc', '-b', 'tsconfig.build.json']);
}
const args = process.argv.slice(2);
try {
  await run(process.execPath, [cliEntry, ...args]);
} catch {
  process.exit(1);
}
