import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

export function npx(args, options = {}) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return run(command, args, options);
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
