import { sha256Text } from '../util/hash.js';

/**
 * Generated sections are delimited by HTML comments so that Obsidian renders
 * nothing extra. The recorded hash lets reconciliation tell a machine-written
 * block apart from one the user has since edited by hand.
 */
const BEGIN = /<!--\s*urw:begin\s+id="([a-z0-9-]+)"\s+hash="([a-f0-9]{0,64})"\s*-->/g;

export interface ProtectedBlock {
  id: string;
  declaredHash: string;
  content: string;
  actualHash: string;
  edited: boolean;
  startIndex: number;
  endIndex: number;
}

export function beginMarker(id: string, hash: string): string {
  return `<!-- urw:begin id="${id}" hash="${hash}" -->`;
}

export function endMarker(id: string): string {
  return `<!-- urw:end id="${id}" -->`;
}

export function renderProtectedBlock(id: string, content: string): string {
  const normalised = content.replace(/^\n+|\n+$/g, '');
  return `${beginMarker(id, sha256Text(normalised))}\n${normalised}\n${endMarker(id)}`;
}

export function extractProtectedBlocks(body: string): ProtectedBlock[] {
  const blocks: ProtectedBlock[] = [];
  BEGIN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BEGIN.exec(body)) !== null) {
    const id = match[1] as string;
    const declaredHash = match[2] as string;
    const end = body.indexOf(endMarker(id), match.index);
    if (end === -1) continue;
    const contentStart = match.index + match[0].length;
    const content = body.slice(contentStart, end).replace(/^\n+|\n+$/g, '');
    const actualHash = sha256Text(content);
    blocks.push({
      id,
      declaredHash,
      content,
      actualHash,
      edited: declaredHash !== actualHash,
      startIndex: match.index,
      endIndex: end + endMarker(id).length,
    });
  }
  return blocks;
}

export function findProtectedBlock(body: string, id: string): ProtectedBlock | undefined {
  return extractProtectedBlocks(body).find((block) => block.id === id);
}

/**
 * Replace one generated block, preserving every byte outside it.
 * A missing block is appended so that new projections can be introduced to
 * notes the user created by hand.
 */
export function replaceProtectedBlock(body: string, id: string, content: string): string {
  const block = findProtectedBlock(body, id);
  const rendered = renderProtectedBlock(id, content);
  if (!block) {
    const separator = body.endsWith('\n') ? '\n' : '\n\n';
    return `${body}${separator}${rendered}\n`;
  }
  return body.slice(0, block.startIndex) + rendered + body.slice(block.endIndex);
}

export function protectedBlockMap(body: string): Record<string, { hash: string; edited: boolean }> {
  const out: Record<string, { hash: string; edited: boolean }> = {};
  for (const block of extractProtectedBlocks(body)) {
    out[block.id] = { hash: block.actualHash, edited: block.edited };
  }
  return out;
}

/** Body text with generated blocks removed, i.e. the user-authored content. */
export function userAuthoredBody(body: string): string {
  let out = body;
  for (const block of extractProtectedBlocks(body).sort((a, b) => b.startIndex - a.startIndex)) {
    out = out.slice(0, block.startIndex) + out.slice(block.endIndex);
  }
  return out;
}
