import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { writeFileAtomic, type Workspace } from '@urw/core';

export interface LocalSession {
  token: string;
  createdAt: string;
  pid: number;
}

/**
 * A per-run token that only a local process can read. Mutations must present it,
 * so a page on another origin cannot drive the API even if the browser sends the
 * request: it cannot read the token, and its Origin is refused as well.
 */
export function ensureLocalSession(ws: Workspace): LocalSession {
  const file = join(ws.paths.data, 'session.json');
  const session: LocalSession = { token: randomBytes(32).toString('hex'), createdAt: new Date().toISOString(), pid: process.pid };
  writeFileAtomic(file, JSON.stringify(session, null, 2));
  try {
    chmodSync(file, 0o600);
  } catch {
    /* permission bits are advisory on some platforms */
  }
  return session;
}

export function readLocalSession(ws: Workspace): LocalSession | undefined {
  const file = join(ws.paths.data, 'session.json');
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as LocalSession;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface GuardOptions {
  port: number;
  session: LocalSession;
  /** Extra origins allowed during development, e.g. the Vite dev server. */
  devOrigins?: string[];
}

export function allowedOrigins(options: GuardOptions): string[] {
  return [
    `http://127.0.0.1:${options.port}`,
    `http://localhost:${options.port}`,
    ...(options.devOrigins ?? []),
  ];
}

function allowedHosts(options: GuardOptions): Set<string> {
  const hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);
  for (const origin of options.devOrigins ?? []) {
    try {
      hosts.add(new URL(origin).host);
    } catch {
      /* ignore an unparsable configured origin */
    }
  }
  return hosts;
}

function tokenMatches(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string') return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

/**
 * Loopback and Host checks only. Applied to every route, including the static
 * bundle, so a rebinding hostname cannot even load the interface.
 */
export function hostGuard(options: GuardOptions) {
  const hosts = allowedHosts(options);
  return (req: Request, res: Response, next: NextFunction): void => {
    const remote = req.socket.remoteAddress ?? '';
    if (!LOOPBACK.has(remote)) {
      res.status(403).json({ error: 'access_denied', message: 'This server only accepts connections from this machine.' });
      return;
    }
    const host = req.headers.host ?? '';
    if (!hosts.has(host)) {
      res.status(403).json({ error: 'access_denied', message: `Host header ${host} is not allowed.` });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  };
}

/**
 * Reject anything that is not a same-host request from this machine. Mutations
 * must additionally prove they come from a page on an allowed origin (an
 * `Origin` header on the allowlist, or `Sec-Fetch-Site: same-origin`) and carry
 * the per-run session token.
 */
export function loopbackGuard(options: GuardOptions) {
  const origins = new Set(allowedOrigins(options));
  const hosts = allowedHosts(options);

  return (req: Request, res: Response, next: NextFunction): void => {
    const remote = req.socket.remoteAddress ?? '';
    if (!LOOPBACK.has(remote)) {
      res.status(403).json({ error: 'access_denied', message: 'This API only accepts connections from this machine.' });
      return;
    }
    const host = req.headers.host ?? '';
    if (!hosts.has(host)) {
      res.status(403).json({ error: 'access_denied', message: `Host header ${host} is not allowed.` });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) {
      res.status(403).json({ error: 'access_denied', message: `Origin ${origin} is not allowed.` });
      return;
    }
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (isMutation) {
      const fetchSite = req.headers['sec-fetch-site'];
      const provenance = (origin && origins.has(origin)) || fetchSite === 'same-origin';
      if (!provenance) {
        res.status(403).json({
          error: 'access_denied',
          message: 'Mutations must carry an allowed Origin header or Sec-Fetch-Site: same-origin.',
        });
        return;
      }
      if (!tokenMatches(req.headers['x-urw-session'], options.session.token)) {
        res.status(403).json({
          error: 'access_denied',
          message: 'Mutations require the local session token from GET /api/bootstrap.',
        });
        return;
      }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  };
}
