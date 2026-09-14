import { npx, rootDir } from './lib.mjs';
import { join } from 'node:path';

// TypeScript packages first, then the web bundle that imports their types.
await npx(['tsc', '-b', 'tsconfig.build.json']);
await npx(['vite', 'build'], { cwd: join(rootDir, 'apps', 'web') });
process.stdout.write('\nBuild complete. Start the local interface with: npm start\n');
