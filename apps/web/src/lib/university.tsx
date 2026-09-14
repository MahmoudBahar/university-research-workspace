import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { WorkspaceStatus } from './api';

export type UniversitySelection = 'all' | string;
export const UNIVERSITY_STORAGE_KEY = 'urw.university';

type UniversitySummary = WorkspaceStatus['universities'][number];

interface UniversityContextValue {
  selection: UniversitySelection;
  university: UniversitySummary | null;
  universities: UniversitySummary[];
  setSelection: (next: UniversitySelection) => void;
  withUniversity: (path: string) => string;
}

const UniversityContext = createContext<UniversityContextValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(UNIVERSITY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  try {
    localStorage.setItem(UNIVERSITY_STORAGE_KEY, value);
  } catch {
    /* storage unavailable */
  }
}

/**
 * The university every list page filters by.
 *
 * Precedence on first render: the URL's `?university=` (so pasted links win),
 * then the remembered choice, then all universities. The context re-appends
 * the parameter after each navigation so links can stay plain.
 */
export function UniversityProvider({ universities, children }: { universities: UniversitySummary[]; children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const known = useCallback((id: string | null): id is string => !!id && (id === 'all' || universities.some((u) => u.id === id)), [universities]);

  const [selection, setSelectionState] = useState<UniversitySelection>(() => {
    const fromUrl = searchParams.get('university');
    if (known(fromUrl)) return fromUrl;
    const stored = readStored();
    if (known(stored)) return stored;
    return 'all';
  });

  // A stale id (workspace wiped) falls back to 'all' once the list is known.
  useEffect(() => {
    if (selection !== 'all' && universities.length > 0 && !known(selection)) {
      setSelectionState('all');
      writeStored('all');
    }
  }, [selection, universities, known]);

  // Pasted or back/forward URLs win over state.
  useEffect(() => {
    const fromUrl = searchParams.get('university');
    if (fromUrl && known(fromUrl) && fromUrl !== selection) {
      setSelectionState(fromUrl);
      writeStored(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Keep the URL in step with the selection after every navigation.
  useEffect(() => {
    const current = searchParams.get('university');
    if (selection !== 'all' && current !== selection) {
      setSearchParams(
        (previous) => {
          previous.set('university', selection);
          return previous;
        },
        { replace: true },
      );
    } else if (selection === 'all' && current !== null) {
      setSearchParams(
        (previous) => {
          previous.delete('university');
          return previous;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, selection, searchParams]);

  const setSelection = useCallback(
    (next: UniversitySelection) => {
      setSelectionState(next);
      writeStored(next);
      setSearchParams(
        (previous) => {
          if (next === 'all') previous.delete('university');
          else previous.set('university', next);
          return previous;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const withUniversity = useCallback(
    (path: string) => {
      if (selection === 'all') return path;
      const separator = path.includes('?') ? '&' : '?';
      return `${path}${separator}university=${encodeURIComponent(selection)}`;
    },
    [selection],
  );

  const value = useMemo<UniversityContextValue>(
    () => ({
      selection,
      university: selection === 'all' ? null : (universities.find((u) => u.id === selection) ?? null),
      universities,
      setSelection,
      withUniversity,
    }),
    [selection, universities, setSelection, withUniversity],
  );

  return <UniversityContext.Provider value={value}>{children}</UniversityContext.Provider>;
}

export function useUniversity(): UniversityContextValue {
  const value = useContext(UniversityContext);
  if (!value) throw new Error('useUniversity must be used inside UniversityProvider');
  return value;
}

/** `''` or `&university=<id>`, for template paths that already carry a query string. */
export function useUniversityQuery(): string {
  const { selection } = useUniversity();
  return selection === 'all' ? '' : `&university=${encodeURIComponent(selection)}`;
}
