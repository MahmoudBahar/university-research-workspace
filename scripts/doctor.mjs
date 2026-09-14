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
const built = existsSync(join(rootDir, 'packages', 'cli', 'dist', 'index.js'));
checks.push({
  name: 'Build output present',
  ok: true,
  warn: !built,
  detail: built ? 'packages/cli/dist/index.js' : 'not built yet; run npm run build',
});

for (const check of checks) {
  const mark = !check.ok ? 'FAIL' : check.warn ? 'warn' : 'ok  ';
  process.stdout.write(`${mark} ${check.name.padEnd(24)} ${check.detail}\n`);
}
// Only a genuinely unusable runtime fails the doctor; a fresh checkout is not an error.
if (checks.some((check) => !check.ok)) process.exitCode = 1;

if (built && existsSync(join(rootDir, 'data', 'research.sqlite'))) {
  await run(process.execPath, [join(rootDir, 'packages', 'cli', 'dist', 'index.js'), 'diagnose']);
}
