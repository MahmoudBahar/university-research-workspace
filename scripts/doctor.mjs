import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { rootDir, run } from './lib.mjs';

const checks = [];
const [major] = process.versions.node.split('.').map(Number);
checks.push({
  name: 'Node.js >= 24',
  ok: major >= 24,
  detail: `found ${process.versions.node}`,
});
checks.push({
  name: 'Temporal available',
  ok: true,
  detail: typeof globalThis.Temporal === 'object' ? 'runtime Temporal' : 'temporal-polyfill will be used',
});
let driver = 'node:sqlite (fallback)';
try {
  const { default: Better } = await import('better-sqlite3');
  const db = new Better(':memory:');
  db.close();
  driver = 'better-sqlite3';
} catch (error) {
  driver = `node:sqlite (better-sqlite3 unavailable: ${String(error).split('\n')[0]})`;
}
checks.push({ name: 'SQLite driver', ok: true, detail: driver });
checks.push({
  name: 'Document text extraction',
  ok: true,
  detail: 'plain text and Markdown built in; PDFs are read by Claude via /import-document (no system tool needed)',
});
checks.push({
  name: 'Build output present',
  ok: existsSync(join(rootDir, 'packages', 'cli', 'dist', 'index.js')),
  detail: 'run npm run build if missing',
});

for (const check of checks) {
  process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name.padEnd(24)} ${check.detail}\n`);
}
if (checks.some((check) => !check.ok)) process.exitCode = 1;

if (existsSync(join(rootDir, 'data', 'research.sqlite'))) {
  await run(process.execPath, [join(rootDir, 'packages', 'cli', 'dist', 'index.js'), 'diagnose']);
}
