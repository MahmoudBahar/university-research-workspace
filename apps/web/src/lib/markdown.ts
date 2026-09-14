import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

/** Notes carry typed YAML frontmatter; it is metadata, not body text. */
export function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown ?? '');
  return match ? (markdown ?? '').slice(match[0].length) : (markdown ?? '');
}

/**
 * Render note Markdown for display.
 *
 * Note bodies contain text fetched from the web, so the HTML is sanitised
 * before it reaches the DOM: no scripts, no event handlers, no inline styles,
 * and no javascript: URLs.
 */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(stripFrontmatter(markdown), { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr', 'blockquote', 'pre', 'code',
      'ul', 'ol', 'li', 'strong', 'em', 'del',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan', 'align'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\.{0,2}\/)/i,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'img'],
    FORBID_ATTR: ['style', 'srcset', 'onerror', 'onload', 'onclick'],
  });
}

/** Plain-text preview of the copyable email body, with no HTML at all. */
export function plainText(text: string): string {
  return (text ?? '').replace(/\r\n/g, '\n');
}
