import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'urw.theme';

/** Where the switch was triggered from, in viewport pixels; the reveal grows from there. */
export interface ThemeOrigin {
  x: number;
  y: number;
}

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (next: ThemePreference, origin?: ThemeOrigin) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function resolveTheme(preference: ThemePreference, dark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (dark ? 'dark' : 'light') : preference;
}

function applyAttribute(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/**
 * Light, dark or follow the system. The choice lives in localStorage and on
 * `<html data-theme>`. Switching between light and dark animates as a circle
 * growing from the control that was pressed (View Transitions API), falling
 * back to a colour cross-fade, and does nothing fancy when the person has
 * asked for reduced motion.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored);
  const [dark, setDark] = useState<boolean>(systemDark);
  const current = useRef<ThemePreference>(preference);
  current.current = preference;

  useEffect(() => {
    applyAttribute(preference);
  }, [preference]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference, origin?: ThemeOrigin) => {
    const persist = () => {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* storage unavailable; the choice lasts for this page */
      }
    };
    const before = resolveTheme(current.current, systemDark());
    const after = resolveTheme(next, systemDark());
    const commit = () => {
      applyAttribute(next);
      flushSync(() => setPreferenceState(next));
    };

    if (before === after || reducedMotion()) {
      applyAttribute(next);
      setPreferenceState(next);
      persist();
      return;
    }

    const root = document.documentElement;
    const doc = document as ViewTransitionDocument;
    if (typeof doc.startViewTransition === 'function') {
      const x = origin?.x ?? window.innerWidth - 40;
      const y = origin?.y ?? 28;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      root.style.setProperty('--vt-x', `${x}px`);
      root.style.setProperty('--vt-y', `${y}px`);
      root.style.setProperty('--vt-r', `${Math.ceil(radius)}px`);
      root.setAttribute('data-theme-switching', 'reveal');
      const transition = doc.startViewTransition(commit);
      transition.finished
        .catch(() => undefined)
        .finally(() => {
          root.removeAttribute('data-theme-switching');
          root.style.removeProperty('--vt-x');
          root.style.removeProperty('--vt-y');
          root.style.removeProperty('--vt-r');
        });
    } else {
      root.setAttribute('data-theme-switching', 'fallback');
      commit();
      window.setTimeout(() => root.removeAttribute('data-theme-switching'), 480);
    }
    persist();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved: resolveTheme(preference, dark), setPreference }),
    [preference, dark, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
