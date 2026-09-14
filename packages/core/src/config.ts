import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ResearchConfigSchema = z.object({
  schemaVersion: z.number().int().default(1),
  degreeScope: z
    .object({
      /** Degree families the research jobs may record as in-scope offerings. */
      primary: z.array(z.string()).default(['MASc']),
      related: z.array(z.string()).default([]),
      allowRelated: z.boolean().default(false),
    })
    .prefault({}),
  concurrency: z
    .object({
      candidates: z.number().int().min(1).max(16).default(1),
      totalWorkers: z.number().int().min(1).max(16).default(4),
    })
    .prefault({}),
  research: z
    .object({
      publicationInventory: z.enum(['all_in_scope', 'selected']).default('all_in_scope'),
      paperSummaryMode: z.enum(['all_accessible', 'selected', 'metadata_only']).default('all_accessible'),
      publicationYearsFrom: z.number().int().nullable().default(null),
      publicationTopics: z.array(z.string()).default([]),
      publicationCountBudget: z.number().int().nullable().default(null),
      expansionBudgetPerRun: z.number().int().min(0).default(5),
      requireVerifier: z.boolean().default(true),
    })
    .prefault({}),
  retry: z
    .object({
      maxAttempts: z.number().int().min(0).max(10).default(3),
      baseDelayMs: z.number().int().min(100).default(2000),
      maxDelayMs: z.number().int().min(1000).default(900_000),
      jitterRatio: z.number().min(0).max(1).default(0.25),
    })
    .prefault({}),
  freshness: z
    .object({
      contactDays: z.number().int().min(1).default(30),
      programFactsDays: z.number().int().min(1).default(60),
      profileDays: z.number().int().min(1).default(120),
      publicationDays: z.number().int().min(1).default(3650),
      sourceObservationDays: z.number().int().min(1).default(14),
    })
    .prefault({}),
  leases: z
    .object({
      defaultSeconds: z.number().int().min(60).default(1800),
      maxRenewals: z.number().int().min(0).default(48),
    })
    .prefault({}),
  timing: z
    .object({
      displayZone: z.string().default('auto'),
      suggestStartHour: z.number().int().min(0).max(23).default(9),
      suggestEndHour: z.number().int().min(1).max(24).default(11),
      weekdaysOnly: z.boolean().default(true),
    })
    .prefault({}),
  server: z
    .object({
      port: z.number().int().min(1).max(65535).default(5178),
      host: z.literal('127.0.0.1').default('127.0.0.1'),
    })
    .prefault({}),
  workers: z
    .object({
      /** `inherit` keeps the model choice with the installed Claude Code session. */
      model: z.string().default('inherit'),
    })
    .prefault({}),
  /** How workers retrieve pages; the browser is the user's own Claude in Chrome session. */
  fetching: z
    .object({
      browserAllowed: z.boolean().default(true),
      browserHosts: z.array(z.string()).default(['scholar.google.com', 'www.semanticscholar.org', 'www.researchgate.net']),
      perHostDelayMs: z.number().int().min(0).default(2000),
      maxBrowserPagesPerRun: z.number().int().min(0).default(40),
    })
    .prefault({}),
  events: z
    .object({
      /** Non-audit change-feed rows older than this are pruned during reconcile. Audit events are never pruned. */
      retentionDays: z.number().int().min(1).default(30),
    })
    .prefault({}),
});

export type ResearchConfig = z.infer<typeof ResearchConfigSchema>;

export function defaultConfig(): ResearchConfig {
  return ResearchConfigSchema.parse({});
}

export function loadConfig(root: string): ResearchConfig {
  const configPath = join(root, 'config', 'research.json');
  const localPath = join(root, 'config', 'local.json');
  let raw: unknown = {};
  if (existsSync(configPath)) {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  }
  if (existsSync(localPath)) {
    const local = JSON.parse(readFileSync(localPath, 'utf8')) as Record<string, unknown>;
    raw = mergeDeep(raw as Record<string, unknown>, local);
  }
  return ResearchConfigSchema.parse(raw);
}

function mergeDeep(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = out[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)) {
      out[key] = mergeDeep(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}
