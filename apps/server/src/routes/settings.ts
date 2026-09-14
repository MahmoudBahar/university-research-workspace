import { Router } from 'express';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ResearchConfigSchema,
  displayZone,
  lastDriverProbe,
  temporalSource,
  writeFileAtomic,
  type Workspace,
} from '@urw/core';
import { parseBody, route } from '../http.js';

export function settingsRoutes(ws: Workspace): Router {
  const router = Router();
  const configPath = join(ws.paths.config, 'research.json');

  router.get(
    '/settings',
    route(() => ({
      config: ws.config,
      configPath: 'config/research.json',
      displayZone: displayZone(ws),
      paths: {
        root: ws.paths.root,
        vault: 'vault',
        data: 'data',
        applicant: 'applicant',
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        driver: ws.db.driverName,
        driverProbe: lastDriverProbe(),
        temporal: temporalSource,
      },
      note: 'Changes are written to config/research.json. Restart the server to apply them everywhere.',
    })),
  );

  router.put(
    '/settings',
    route((req) => {
      const body = parseBody(z.object({ config: z.unknown() }), req);
      const parsed = ResearchConfigSchema.parse(body.config);
      const existing = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>) : {};
      writeFileAtomic(configPath, JSON.stringify({ ...existing, ...parsed }, null, 2));
      return { saved: true, config: parsed, restartRequired: true };
    }),
  );

  return router;
}
