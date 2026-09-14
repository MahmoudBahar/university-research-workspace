import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { latestEventSeq, readEvents, type Workspace } from '@urw/core';
import { parseQuery, route } from '../http.js';

export function eventRoutes(ws: Workspace): Router {
  const router = Router();

  router.get(
    '/events',
    route((req) => {
      const query = parseQuery(z.object({ since: z.coerce.number().int().default(0), limit: z.coerce.number().int().max(500).default(200) }), req);
      return { events: readEvents(ws.db, query.since, query.limit), latest: latestEventSeq(ws.db) };
    }),
  );

  // Server-sent events: the same feed, pushed. One poller serves every open
  // stream, so ten tabs cost one database read per tick rather than ten.
  const clients = new Set<{ res: Response; cursor: number }>();
  let timer: NodeJS.Timeout | null = null;

  const tick = (): void => {
    if (clients.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    let events: ReturnType<typeof readEvents>;
    const floor = Math.min(...[...clients].map((c) => c.cursor));
    try {
      events = readEvents(ws.db, floor, 200);
    } catch {
      for (const client of clients) client.res.end();
      clients.clear();
      return;
    }
    const now = new Date().toISOString();
    for (const client of clients) {
      try {
        for (const event of events) {
          if (event.seq <= client.cursor) continue;
          client.cursor = event.seq;
          client.res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
        }
        client.res.write(`event: ping\ndata: ${JSON.stringify({ at: now, cursor: client.cursor })}\n\n`);
      } catch {
        clients.delete(client);
        client.res.end();
      }
    }
  };

  router.get('/events/stream', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const requested = Number(req.query['since']);
    const cursor = Number.isFinite(requested) ? requested : latestEventSeq(ws.db);
    const client = { res, cursor };
    res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ since: cursor })}\n\n`);
    clients.add(client);
    if (!timer) timer = setInterval(tick, 1500);

    req.on('close', () => {
      clients.delete(client);
      res.end();
    });
  });

  return router;
}
