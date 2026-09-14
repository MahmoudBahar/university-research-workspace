import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import type { Workspace } from '../workspace.js';
import { listFilesRecursive, toPosix, fromPosix } from '../util/fsx.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractLinks, isExternalLink, resolveLinkTarget } from './links.js';
import { parseNote } from './frontmatter.js';

export interface LinkProblem {
  from: string;
  target: string;
  kind: 'broken' | 'case_mismatch' | 'external_unchecked';
  detail?: string;
}

export interface LinkReport {
  notesChecked: number;
  linksChecked: number;
  problems: LinkProblem[];
  duplicateTitles: { title: string; paths: string[] }[];
  caseCollisions: { lowered: string; paths: string[] }[];
}

/**
 * Verify that every relative link in the vault resolves, and that filenames do
 * not collide on case-insensitive filesystems.
 */
export function checkLinks(ws: Workspace): LinkReport {
  const files = listFilesRecursive(ws.paths.vault, (p) => p.endsWith('.md'));
  const vaultPaths = files.map((absolute) => toPosix(relative(ws.paths.vault, absolute)));
  const lowerMap = new Map<string, string[]>();
  for (const path of vaultPaths) {
    const lowered = path.toLowerCase();
    lowerMap.set(lowered, [...(lowerMap.get(lowered) ?? []), path]);
  }

  const report: LinkReport = {
    notesChecked: 0,
    linksChecked: 0,
    problems: [],
    duplicateTitles: [],
    caseCollisions: [],
  };

  const titles = new Map<string, string[]>();

  for (const absolute of files) {
    const vaultPath = toPosix(relative(ws.paths.vault, absolute));
    report.notesChecked += 1;
    const text = readFileSync(absolute, 'utf8');
    let body = text;
    try {
      const parsed = parseNote(text);
      body = parsed.body;
      const title = String(parsed.frontmatter['title'] ?? '').trim();
      if (title) titles.set(title, [...(titles.get(title) ?? []), vaultPath]);
    } catch {
      // Frontmatter problems are reported by reconciliation, not the link check.
    }

    for (const link of extractLinks(body)) {
      if (isExternalLink(link.target)) continue;
      report.linksChecked += 1;
      const resolved = resolveLinkTarget(vaultPath, link.target);
      if (!resolved) continue;
      const candidate = join(ws.paths.vault, fromPosix(resolved));
      if (existsSync(candidate)) continue;
      const lowered = resolved.toLowerCase();
      const insensitive = lowerMap.get(lowered);
      if (insensitive && insensitive.length > 0) {
        report.problems.push({
          from: vaultPath,
          target: link.target,
          kind: 'case_mismatch',
          detail: `Resolves only when filename case is ignored: ${insensitive.join(', ')}`,
        });
        continue;
      }
      report.problems.push({ from: vaultPath, target: link.target, kind: 'broken' });
    }
  }

  for (const [title, paths] of titles) {
    if (paths.length > 1) report.duplicateTitles.push({ title, paths });
  }
  for (const [lowered, paths] of lowerMap) {
    if (paths.length > 1) report.caseCollisions.push({ lowered, paths });
  }
  return report;
}
