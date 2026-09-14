import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export interface ShortcutRow {
  keys: string[][];
  description: string;
}

/** The table shown in the shortcuts dialog. `g` chords navigate. */
export const SHORTCUTS: ShortcutRow[] = [
  { keys: [['Ctrl', 'K'], ['/']], description: 'Open the search and command palette' },
  { keys: [['?']], description: 'Show keyboard shortcuts' },
  { keys: [['Esc']], description: 'Close a dialog or the navigation drawer' },
  { keys: [['g', 'o']], description: 'Go to Overview' },
  { keys: [['g', 'd']], description: 'Go to Departments' },
  { keys: [['g', 'p']], description: 'Go to People' },
  { keys: [['g', 'q']], description: 'Go to Queue' },
  { keys: [['g', 'r']], description: 'Go to Review' },
  { keys: [['g', 's']], description: 'Go to Sent history' },
];

const CHORDS: Record<string, string> = { o: '/', d: '/scope', p: '/people', q: '/queue', r: '/review', s: '/sent' };
const CHORD_WINDOW_MS = 800;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function dialogOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}

/**
 * Global keyboard shortcuts. Ignored while typing in a field or while a dialog
 * is open (dialogs handle Escape themselves). Ctrl/Cmd+K is intercepted before
 * the browser sees it.
 */
export function useGlobalShortcuts(handlers: { onPalette: () => void; onHelp: () => void; onEscape?: () => void }): void {
  const navigate = useNavigate();
  const latest = useRef(handlers);
  latest.current = handlers;
  const pendingChord = useRef<number | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      const palette = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key.toLowerCase() === 'k';
      if (palette) {
        event.preventDefault();
        if (!dialogOpen()) latest.current.onPalette();
        return;
      }
      if (key === 'Escape') {
        if (!dialogOpen()) latest.current.onEscape?.();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target) || dialogOpen()) return;

      if (key === '/') {
        event.preventDefault();
        latest.current.onPalette();
        return;
      }
      if (key === '?') {
        event.preventDefault();
        latest.current.onHelp();
        return;
      }
      if (pendingChord.current !== null) {
        const destination = CHORDS[key];
        window.clearTimeout(pendingChord.current);
        pendingChord.current = null;
        if (destination) {
          event.preventDefault();
          navigate(destination);
        }
        return;
      }
      if (key === 'g') {
        pendingChord.current = window.setTimeout(() => {
          pendingChord.current = null;
        }, CHORD_WINDOW_MS);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      if (pendingChord.current !== null) window.clearTimeout(pendingChord.current);
    };
  }, [navigate]);
}
