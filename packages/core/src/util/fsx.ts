import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  fsyncSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppError } from './errors.js';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Durable write: content goes to a temporary sibling, is fsynced, then renamed
 * over the target. rename(2) is atomic within a filesystem on POSIX and is the
 * closest portable equivalent on Windows (ReplaceFile semantics via libuv).
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  writeFileSync(tmp, data);
  try {
    const fd = openSync(tmp, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* fsync is unavailable on some filesystems; the rename below still applies */
  }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}

/**
 * Make a rename durable: on POSIX the directory entry is only guaranteed on
 * disk after the directory itself is fsynced. Best effort; Windows and some
 * filesystems refuse to open directories, which is not an error here.
 */
export function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* not supported on this platform or filesystem */
  }
}

export function readTextIfExists(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, 'utf8');
}

export function readText(path: string): string {
  if (!existsSync(path)) throw new AppError('not_found', `File not found: ${path}`, { path });
  return readFileSync(path, 'utf8');
}

export function fileStats(path: string): { size: number; mtimeMs: number } | undefined {
  if (!existsSync(path)) return undefined;
  const st = statSync(path);
  return { size: st.size, mtimeMs: Math.trunc(st.mtimeMs) };
}

export function copyFile(from: string, to: string): void {
  ensureDir(dirname(to));
  copyFileSync(from, to);
}

export function removeIfExists(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

/** Convert an OS path to the forward-slash form stored in the database and in notes. */
export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

export function fromPosix(path: string): string {
  return path.split('/').join(sep);
}

/**
 * Resolve `candidate` inside `root` and refuse anything that escapes it.
 * Used by every route or command that accepts a caller-supplied path.
 */
export function resolveWithin(root: string, candidate: string): string {
  const rootResolved = resolve(root);
  const target = isAbsolute(candidate) ? resolve(candidate) : resolve(rootResolved, fromPosix(candidate));
  const rel = relative(rootResolved, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppError('invalid_input', 'Path resolves outside the permitted directory', {
      root: rootResolved,
      candidate,
    });
  }
  return target;
}

export function listFilesRecursive(root: string, filter?: (path: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!filter || filter(full)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/** Reject filenames that are not portable across Windows, macOS and Linux. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export function assertPortableFilename(name: string): void {
  if (name.length === 0 || name.length > 120) {
    throw new AppError('invalid_input', 'Filename must be 1-120 characters', { name });
  }
  if (/[<>:"\\|?*\u0000-\u001f]/.test(name)) {
    throw new AppError('invalid_input', 'Filename contains characters that are unsafe on Windows', { name });
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    throw new AppError('invalid_input', 'Filename must not end with a dot or space', { name });
  }
  const stem = name.replace(/\.[^.]*$/, '');
  if (WINDOWS_RESERVED.test(stem)) {
    throw new AppError('invalid_input', 'Filename uses a reserved Windows device name', { name });
  }
}

export function slugify(input: string, max = 60): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return slug.length > 0 ? slug : 'untitled';
}
