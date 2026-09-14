import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npx, run, rootDir } from './lib.mjs';

await npx(['tsc', '-b', 'tsconfig.build.json']);
await npx(['tsc', '-p', join('tests', 'tsconfig.json')]);

// List the files explicitly: a directory argument is accepted by newer Node
// versions only, and a shell glob is never used (shell: false).
const suiteDir = join(rootDir, 'tests', 'dist', 'acceptance');
const files = readdirSync(suiteDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => join(suiteDir, name));
if (files.length === 0) throw new Error(`No compiled tests found in ${suiteDir}`);
await run(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: rootDir });
