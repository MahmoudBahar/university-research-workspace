import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

/** Run a command without a shell so arguments are never re-interpreted. */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      stdio: options.stdio ?? 'inherit',
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve(0);
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });
}

/** Which package provides each command-line tool this repo runs. */
const TOOL_PACKAGES = { tsc: 'typescript', vite: 'vite', playwright: '@playwright/test' };

/**
 * The JavaScript entry point of an installed tool, so it can be run with
 * `process.execPath` and no shell. Spawning the `npx`/`tsc` shims directly is
 * refused on Windows (they are .cmd files), and a shell would re-interpret
 * arguments, so neither is used.
 */
export function binPath(tool) {
  const pkg = TOOL_PACKAGES[tool];
  if (!pkg) throw new Error(`No package registered for tool "${tool}"`);
  const pkgDir = join(rootDir, 'node_modules', ...pkg.split('/'));
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[tool];
  if (!bin) throw new Error(`Package ${pkg} does not expose a "${tool}" binary`);
  return join(pkgDir, ...bin.split('/'));
}

/** Run an installed tool (`tsc`, `vite`, `playwright`) through Node itself. */
export function npx(args, options = {}) {
  const [tool, ...rest] = args;
  return run(process.execPath, [binPath(tool), ...rest], options);
}

export function npm(args, options = {}) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return run(command, args, options);
}

export function spawnBackground(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? rootDir,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
    shell: false,
  });
  return child;
}

export function distExists(relative) {
  return existsSync(join(rootDir, relative));
}

export function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
