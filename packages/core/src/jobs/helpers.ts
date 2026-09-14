import type { Workspace } from '../workspace.js';
import type { DbOp } from '../commit/manifest.js';
import type { SourceInput } from './schemas.js';
import { upsertSource, recordObservation } from '../sources/sources.js';
import { markdownLink } from '../notes/links.js';
import { todayIso } from '../util/time.js';

export const NONE = '_None recorded._';

export function bullets(items: (string | undefined | null)[], empty = NONE): string {
  const clean = items.filter((item): item is string => Boolean(item && item.trim()));
  if (clean.length === 0) return empty;
  return clean.map((item) => `- ${item}`).join('\n');
}

export function paragraph(text: string | undefined, empty = NONE): string {
  return text && text.trim() ? text.trim() : empty;
}

/** Render a category of typed facts as a readable two-column table. */
export function factTable(facts: Record<string, string | string[] | null | undefined>): string {
  const rows = Object.entries(facts).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  if (rows.length === 0) return NONE;
  const body = rows
    .map(([key, value]) => {
      const label = key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
      const rendered = Array.isArray(value) ? value.join('; ') : String(value);
      return `| ${label} | ${rendered.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`;
    })
    .join('\n');
  return `| Field | Value |\n| --- | --- |\n${body}`;
}

export interface EvidenceLike {
  claim: string;
  source_id?: string;
  url?: string;
  status?: string;
  checked_at?: string;
  note?: string;
}

export function evidenceTable(evidence: EvidenceLike[]): string {
  if (evidence.length === 0) return NONE;
  const rows = evidence
    .map(
      (item) =>
        `| ${item.claim.replace(/\|/g, '\\|')} | ${item.status ?? 'unverified'} | ${item.source_id ?? item.url ?? '—'} | ${item.checked_at ?? '—'} |`,
    )
    .join('\n');
  return `| Claim | Status | Source | Checked |\n| --- | --- | --- | --- |\n${rows}`;
}

export function linkList(fromVaultPath: string, entries: { label: string; vaultPath: string; prefix?: string }[]): string {
  if (entries.length === 0) return NONE;
  return entries
    .map((entry) => `- ${entry.prefix ? `${entry.prefix}: ` : ''}${markdownLink(entry.label, fromVaultPath, entry.vaultPath)}`)
    .join('\n');
}

export interface IngestedSources {
  ids: Map<string, string>;
  dbOps: DbOp[];
  list: { id: string; url: string; category: string; access: string }[];
}

/**
 * Register every cited destination and its access outcome. Blocked and failed
 * fetches are recorded as evidence, not dropped.
 */
export function ingestSources(ws: Workspace, sources: SourceInput[], discoveredFrom: string, observer: string): IngestedSources {
  const ids = new Map<string, string>();
  const list: IngestedSources['list'] = [];
  for (const source of sources) {
    const row = upsertSource(ws, {
      url: source.url,
      category: source.category,
      title: source.title,
      publisher: source.publisher,
      discoveredFrom,
    });
    recordObservation(ws, {
      sourceId: row.id,
      accessStatus: source.access_status,
      fetchMethod: source.fetch_method,
      observer,
      notes: source.notes,
      observedAt: source.observed_at ? `${source.observed_at}T00:00:00.000Z` : undefined,
    });
    ids.set(source.url, row.id);
    list.push({ id: row.id, url: source.url, category: source.category, access: source.access_status });
  }
  return { ids, dbOps: [], list };
}

export function sourceSection(sources: { id: string; url: string; category: string; access: string }[], checkedAt = todayIso()): string {
  if (sources.length === 0) return NONE;
  const rows = sources
    .map((source) => `| ${source.id} | ${source.category} | ${source.access} | ${source.url} |`)
    .join('\n');
  return `Checked on ${checkedAt}.\n\n| Source | Category | Access | URL |\n| --- | --- | --- | --- |\n${rows}`;
}

export function coverageSection(coverage: {
  pages_checked?: string[];
  inaccessible?: { url: string; reason: string }[];
  notes?: string;
}): string {
  const parts: string[] = [];
  parts.push(`**Pages checked**\n\n${bullets(coverage.pages_checked ?? [])}`);
  parts.push(
    `**Inaccessible or blocked**\n\n${bullets((coverage.inaccessible ?? []).map((item) => `${item.url} — ${item.reason}`))}`,
  );
  if (coverage.notes) parts.push(`**Notes**\n\n${coverage.notes}`);
  return parts.join('\n\n');
}

export function relationshipOp(payload: {
  fromId: string;
  toId: string;
  relType: string;
  role?: string;
  status?: string;
  evidenceStatus?: string;
  sourceId?: string | null;
  observedAt?: string | null;
  note?: string | null;
}): DbOp {
  return { kind: 'relationship.upsert', payload: { ...payload } };
}

export function entityOp(payload: {
  id: string;
  kind: string;
  canonicalPath?: string | null;
  displayTitle: string;
  identityConfidence?: string;
}): DbOp {
  return { kind: 'entity.upsert', payload: { ...payload } };
}

export function eventOp(kind: string, entityId: string | null, payload: Record<string, unknown> = {}): DbOp {
  return { kind: 'event', payload: { kind, entityId, payload } };
}

/** Bounded per-run expansion: everything discovered is persisted, only follow-up work is capped. */
export function expansionBudget(ws: Workspace): { limit: number; taken: number; take: () => boolean } {
  const limit = ws.config.research.expansionBudgetPerRun;
  let taken = 0;
  return {
    limit,
    get taken() {
      return taken;
    },
    take: () => {
      if (taken >= limit) return false;
      taken += 1;
      return true;
    },
  };
}

/**
 * A minimal profile note for a person discovered as a by-product of another
 * job. Every discovery is persisted and navigable; the note states plainly that
 * no research has run for this person yet.
 */
export function personStubSections(input: {
  fullName: string;
  role: string;
  roleCategory: string;
  profileUrl?: string;
  sourceUrl?: string;
  discoveredVia: string;
  relatedLinks: { label: string; vaultPath: string; prefix?: string }[];
  personPath: string;
}): { id: string; heading: string; content: string }[] {
  return [
    {
      id: 'identity',
      heading: 'Identity',
      content: factTable({
        full_name: input.fullName,
        stated_role: input.role,
        role_category: input.roleCategory,
        profile_url: input.profileUrl ?? null,
      }),
    },
    {
      id: 'discovery',
      heading: 'How this record was discovered',
      content: [
        `Discovered via ${input.discoveredVia}.`,
        input.sourceUrl ? `Source: ${input.sourceUrl}` : '',
        '',
        'No deep research has run for this person. Nothing below the identity block has been verified.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { id: 'related-records', heading: 'Related records', content: linkList(input.personPath, input.relatedLinks) },
    {
      id: 'research-summary',
      heading: 'Research summary',
      content: 'Not researched yet. Queue Job 4 and Job 5 for this person if they are in scope.',
    },
  ];
}

/** A source-map note for a person whose sources have not been mapped yet. */
export function emptySourceMapSections(personPath: string, profileLink: { label: string; vaultPath: string }): { id: string; heading: string; content: string }[] {
  return [
    {
      id: 'summary',
      heading: 'Summary',
      content: 'Job 4 has not mapped this person’s sources yet. This note exists so the profile has somewhere to link.',
    },
    { id: 'entries', heading: 'Mapped sources', content: NONE },
    { id: 'absent', heading: 'Categories with nothing found', content: NONE },
    { id: 'blocked', heading: 'Blocked or unavailable', content: NONE },
    { id: 'timezone-basis', heading: 'Timezone basis', content: NONE },
    {
      id: 'related-records',
      heading: 'Related records',
      content: linkList(personPath, [{ label: profileLink.label, vaultPath: profileLink.vaultPath, prefix: 'Profile' }]),
    },
  ];
}

/**
 * A minimal note for a laboratory discovered while researching a person. Job 6
 * fills it in; until then the record is navigable and states what is unknown.
 */
export function labStubSections(input: {
  officialName: string;
  url?: string;
  role?: string;
  discoveredVia: string;
  labPath: string;
  relatedLinks: { label: string; vaultPath: string; prefix?: string }[];
}): { id: string; heading: string; content: string }[] {
  return [
    { id: 'overview', heading: 'Overview', content: `Discovered via ${input.discoveredVia}. Job 6 has not researched this laboratory yet.` },
    {
      id: 'identity',
      heading: 'Laboratory identity',
      content: factTable({ official_name: input.officialName, url: input.url ?? null, known_role_of_discoverer: input.role ?? null }),
    },
    { id: 'members', heading: 'Membership', content: linkList(input.labPath, input.relatedLinks) },
    {
      id: 'recruitment',
      heading: 'Recruitment notices',
      content: 'Not checked. An active lab page is not evidence that a funded opening exists.',
    },
  ];
}
