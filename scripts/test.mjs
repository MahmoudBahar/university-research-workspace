import { npx, run, rootDir } from './lib.mjs';
import { join } from 'node:path';

await npx(['tsc', '-b', 'tsconfig.build.json']);
await npx(['tsc', '-p', join('tests', 'tsconfig.json')]);
await run(process.execPath, ['--test', '--test-reporter=spec', 'tests/dist/acceptance/'], { cwd: rootDir });
