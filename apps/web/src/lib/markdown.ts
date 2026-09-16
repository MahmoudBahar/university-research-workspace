import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

/** Notes carry typed YAML frontmatter; it is metadata, not body text. */
export function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown ?? '');
  return match ? (markdown ?? '').slice(match[0].length) : (markdown ?? '');
}

export interface NoteHeading {
  level: number;
  text: string;
  slug: string;
}

/**
 * Stable anchor id for a heading. Two headings with the same words get
 * suffixed so every entry in an outline addresses exactly one element.
 */
function slugger() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base =
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
}

/**
 * The headings of a note body, in document order, for building an outline.
 * Fenced code blocks are skipped so a shell comment is never read as a heading.
 */
export function noteHeadings(markdown: string): NoteHeading[] {
  const slug = slugger();
  const out: NoteHeading[] = [];
  let inFence = false;
  for (const line of stripFrontmatter(markdown).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = (match[2] as string).replace(/[*_`]/g, '').trim();
    if (!text) continue;
    out.push({ level: (match[1] as string).length, text, slug: slug(text) });
  }
  return out;
}

/**
 * Render note Markdown for display.
 *
 * Note bodies contain text fetched from the web, so the HTML is sanitised
 * before it reaches the DOM: no scripts, no event handlers, no inline styles,
 * and no javascript: URLs.
 */
export function renderMarkdown(markdown: string): string {
  const body = stripFrontmatter(markdown);
  // Same walk as noteHeadings, so the ids here and the outline's slugs agree.
  const slugs = noteHeadings(markdown).map((heading) => heading.slug);
  let index = 0;
  const renderer = new marked.Renderer();
  renderer.heading = function heading({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const slug = slugs[index++] ?? '';
    return `<h${depth} id="${slug}">${text}</h${depth}>\n`;
  };
  const html = marked.parse(body, { async: false, renderer }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr', 'blockquote', 'pre', 'code',
      'ul', 'ol', 'li', 'strong', 'em', 'del',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan', 'align', 'id'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\.{0,2}\/)/i,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'img'],
    FORBID_ATTR: ['style', 'srcset', 'onerror', 'onload', 'onclick'],
  });
}

/** Plain-text preview of the copyable email body, with no HTML at all. */
export function plainText(text: string): string {
  return (text ?? '').replace(/\r\n/g, '\n');
}
