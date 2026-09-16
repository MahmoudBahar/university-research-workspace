import { useEffect, useState } from 'react';
import { noteHeadings } from '../lib/markdown';

/**
 * A section list for a long note.
 *
 * Profiles run to hundreds of lines, so the outline is how you find the
 * publication inventory without scrolling past the evidence record. Headings
 * come from the Markdown source, and the ids they scroll to are written by the
 * same walk in renderMarkdown, so the two cannot drift apart.
 */
export function NoteOutline({ text, containerId }: { text: string; containerId: string }) {
  const headings = noteHeadings(text).filter((heading) => heading.level >= 2 && heading.level <= 3);
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    if (headings.length === 0) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    const targets = headings
      .map((heading) => container.querySelector<HTMLElement>(`#${CSS.escape(heading.slug)}`))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;

    // Track the last heading to have crossed the top of the viewport, which is
    // the section being read. An observer alone reports whatever is visible,
    // and a long section with no heading on screen would clear the highlight.
    const observer = new IntersectionObserver(
      () => {
        const scrolled = targets.filter((element) => element.getBoundingClientRect().top <= 120);
        const current = scrolled.length > 0 ? scrolled[scrolled.length - 1] : targets[0];
        if (current) setActive(current.id);
      },
      { rootMargin: '-100px 0px -60% 0px', threshold: [0, 1] },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [text, containerId, headings.length]);

  if (headings.length === 0) return null;

  return (
    <nav className="note-outline" aria-label="Sections in this note">
      <div className="note-outline-title">Sections</div>
      <ul>
        {headings.map((heading) => (
          <li key={heading.slug} className={`lvl-${heading.level}${active === heading.slug ? ' is-active' : ''}`}>
            <a
              href={`#${heading.slug}`}
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(heading.slug);
                if (!target) return;
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActive(heading.slug);
                // Move keyboard focus with the scroll, or tabbing resumes from
                // wherever the reader was before clicking.
                target.setAttribute('tabindex', '-1');
                target.focus({ preventScroll: true });
              }}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
