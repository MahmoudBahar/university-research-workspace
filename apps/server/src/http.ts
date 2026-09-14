import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '@urw/core';

export type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

/** Wrap a handler so thrown AppErrors become their documented status codes. */
export function route(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await handler(req, res);
      if (res.headersSent) return;
      res.json(result ?? { ok: true });
    } catch (error) {
      next(error);
    }
  };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    res.status(error.httpStatus).json(error.toJSON());
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: 'invalid_input',
      message: 'Request body failed validation',
      detail: { issues: error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })) },
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: 'internal_error', message });
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  return schema.parse(req.body ?? {});
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  return schema.parse(req.query ?? {});
}
