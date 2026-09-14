import { posix } from 'node:path';

export interface NoteLink {
  kind: 'markdown' | 'wiki';
  text: string;
  target: string;
  raw: string;
}

const MD_LINK = /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const WIKI_LINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

export function extractLinks(body: string): NoteLink[] {
  const links: NoteLink[] = [];
  MD_LINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MD_LINK.exec(body)) !== null) {
    links.push({ kind: 'markdown', text: match[1] ?? '', target: match[2] ?? '', raw: match[0] });
  }
  WIKI_LINK.lastIndex = 0;
  while ((match = WIKI_LINK.exec(body)) !== null) {
    links.push({ kind: 'wiki', text: match[2] ?? match[1] ?? '', target: match[1] ?? '', raw: match[0] });
  }
  return links;
}

export function isExternalLink(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

/**
 * Relative Markdown link from one vault note to another, always with forward
 * slashes so the stored text is identical on every platform.
 */
export function relativeNoteLink(fromVaultPath: string, toVaultPath: string): string {
  const fromDir = posix.dirname(fromVaultPath);
  const rel = posix.relative(fromDir, toVaultPath);
  return rel.startsWith('.') ? rel : `./${rel}`;
}

export function markdownLink(label: string, fromVaultPath: string, toVaultPath: string): string {
  const target = relativeNoteLink(fromVaultPath, toVaultPath).replace(/ /g, '%20');
  return `[${label}](${target})`;
}

/** Resolve a link found inside `fromVaultPath` to a vault-relative posix path. */
export function resolveLinkTarget(fromVaultPath: string, target: string): string | undefined {
  if (isExternalLink(target)) return undefined;
  const withoutAnchor = target.split('#')[0] ?? '';
  if (withoutAnchor === '') return undefined;
  const decoded = decodeURIComponent(withoutAnchor);
  const fromDir = posix.dirname(fromVaultPath);
  return posix.normalize(posix.join(fromDir, decoded));
}
