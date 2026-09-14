import YAML from 'yaml';
import { AppError } from '../util/errors.js';

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Raw frontmatter text, kept so a repair can show exactly what failed to parse. */
  frontmatterText: string;
  hasFrontmatter: boolean;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse a note into typed frontmatter plus body.
 *
 * Invalid YAML raises `invalid_input` with the offending text attached. Callers
 * must surface a repairable error and leave the file bytes untouched.
 */
export function parseNote(text: string): ParsedNote {
  const match = FENCE.exec(text);
  if (!match) {
    return { frontmatter: {}, body: text, frontmatterText: '', hasFrontmatter: false };
  }
  const frontmatterText = match[1] ?? '';
  let parsed: unknown;
  try {
    parsed = YAML.parse(frontmatterText, { prettyErrors: true });
  } catch (error) {
    throw new AppError('invalid_input', `Invalid YAML frontmatter: ${(error as Error).message}`, {
      frontmatterText,
      repairable: true,
    });
  }
  if (parsed === null || parsed === undefined) parsed = {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('invalid_input', 'Frontmatter must be a YAML mapping', { frontmatterText, repairable: true });
  }
  return {
    frontmatter: parsed as Record<string, unknown>,
    body: text.slice(match[0].length),
    frontmatterText,
    hasFrontmatter: true,
  };
}

export function serializeNote(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = YAML.stringify(frontmatter, { lineWidth: 0 }).replace(/\n$/, '');
  const normalisedBody = body.startsWith('\n') ? body.slice(1) : body;
  return `---\n${yaml}\n---\n\n${normalisedBody.replace(/\s*$/, '')}\n`;
}

/** Replace frontmatter while leaving the body bytes untouched. */
export function withFrontmatter(text: string, frontmatter: Record<string, unknown>): string {
  const parsed = parseNote(text);
  return serializeNote(frontmatter, parsed.body);
}
