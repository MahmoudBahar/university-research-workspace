import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  FileText,
  FlaskConical,
  GraduationCap,
  ListChecks,
  Mail,
  Network,
  Search,
  SunMoon,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { api, type SearchResponse, type SearchResult } from '../lib/api';
import { useReducedMotion } from '../lib/motion';
import { useTheme } from '../lib/theme';
import { useUniversity } from '../lib/university';
import { Dialog } from './Dialog';
import { Kbd } from './Kbd';
import { NAV_GROUPS } from './Sidebar';

interface PaletteItem {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  run: () => void;
  href?: string;
}

const KIND_ICONS: Record<SearchResult['kind'], LucideIcon> = {
  person: UserRound,
  program: GraduationCap,
  lab: FlaskConical,
  unit: Network,
  draft: Mail,
  task: ListChecks,
  note: FileText,
  university: Building2,
};

const KIND_LABELS: Record<SearchResult['kind'], string> = {
  person: 'People',
  program: 'Programs',
  lab: 'Laboratories',
  unit: 'Departments',
  draft: 'Drafts',
  task: 'Tasks',
  note: 'Notes',
  university: 'Universities',
};

const RECENT_KEY = 'urw.palette.recent';

function readRecent(): { title: string; href: string; kind: string }[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as { title: string; href: string; kind: string }[]) : [];
  } catch {
    return [];
  }
}

function pushRecent(entry: { title: string; href: string; kind: string }): void {
  try {
    const next = [entry, ...readRecent().filter((item) => item.href !== entry.href)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const { setPreference, resolved } = useTheme();
  const { withUniversity, universities, setSelection } = useUniversity();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<SearchResult[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setRemote([]);
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const go = useCallback(
    (href: string, title: string, kind: string) => {
      pushRecent({ title, href, kind });
      onClose();
      navigate(href, { viewTransition: !reduced });
    },
    [navigate, onClose, reduced],
  );

  // Remote search, debounced.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setRemote([]);
      setTruncated(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = (requestId.current += 1);
    const timer = window.setTimeout(() => {
      api
        .get<SearchResponse>(withUniversity(`/api/search?q=${encodeURIComponent(trimmed)}&limit=20`))
        .then((response) => {
          if (id !== requestId.current) return;
          setRemote(response.results);
          setTruncated(response.truncated);
        })
        .catch(() => {
          if (id === requestId.current) setRemote([]);
        })
        .finally(() => {
          if (id === requestId.current) setSearching(false);
        });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query, open, withUniversity]);

  const items = useMemo<PaletteItem[]>(() => {
    const trimmed = query.trim().toLowerCase();
    const list: PaletteItem[] = [];
    if (trimmed === '') {
      for (const recent of readRecent()) {
        list.push({
          id: `recent:${recent.href}`,
          group: 'Recent',
          title: recent.title,
          subtitle: recent.kind,
          icon: KIND_ICONS[recent.kind as SearchResult['kind']] ?? Search,
          href: recent.href,
          run: () => go(recent.href, recent.title, recent.kind),
        });
      }
    }
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (trimmed !== '' && !item.label.toLowerCase().includes(trimmed)) continue;
        list.push({ id: `page:${item.to}`, group: 'Pages', title: item.label, icon: item.icon, href: item.to, run: () => go(item.to, item.label, 'page') });
      }
    }
    const actions: PaletteItem[] = [
      {
        id: 'action:theme',
        group: 'Actions',
        title: `Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`,
        icon: SunMoon,
        run: () => {
          setPreference(resolved === 'dark' ? 'light' : 'dark');
          onClose();
        },
      },
      ...universities.map<PaletteItem>((university) => ({
        id: `action:university:${university.id}`,
        group: 'Actions',
        title: `Filter by ${university.name}`,
        icon: Building2,
        run: () => {
          setSelection(university.id);
          onClose();
        },
      })),
      {
        id: 'action:university:all',
        group: 'Actions',
        title: 'Show all universities',
        icon: Building2,
        run: () => {
          setSelection('all');
          onClose();
        },
      },
    ];
    for (const action of actions) if (trimmed === '' || action.title.toLowerCase().includes(trimmed)) list.push(action);
    for (const result of remote) {
      list.push({
        id: `${result.kind}:${result.id}`,
        group: KIND_LABELS[result.kind] ?? result.kind,
        title: result.title,
        ...(result.subtitle ? { subtitle: result.subtitle } : {}),
        icon: KIND_ICONS[result.kind] ?? Search,
        href: result.href,
        run: () => go(result.href, result.title, result.kind),
      });
    }
    return list;
  }, [query, remote, go, resolved, setPreference, onClose, universities, setSelection]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (items.length === 0 ? 0 : (current + 1) % items.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (items.length === 0 ? 0 : (current - 1 + items.length) % items.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      items[active]?.run();
    }
  };

  const grouped = items.reduce<{ group: string; items: PaletteItem[] }[]>((accumulator, item) => {
    const last = accumulator[accumulator.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else accumulator.push({ group: item.group, items: [item] });
    return accumulator;
  }, []);

  let index = -1;

  return (
    <Dialog open={open} onClose={onClose} label="Search and commands" className="palette" showHeader={false}>
      <div className="palette-input">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="palette-list"
          aria-activedescendant={items[active] ? `palette-option-${index + 1 + active}` : undefined}
          aria-autocomplete="list"
          aria-label="Search people, programs, laboratories, departments, drafts and tasks"
          placeholder="Search or jump to…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {searching ? <span className="small muted">searching…</span> : null}
      </div>
      <ul id="palette-list" role="listbox" className="palette-list" aria-label="Results">
        {grouped.map((section) => (
          <li key={section.group} role="presentation">
            <div className="palette-group" role="presentation">
              {section.group}
            </div>
            <ul role="group" aria-label={section.group} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {section.items.map((item) => {
                index += 1;
                const position = index;
                return (
                  <li
                    key={item.id}
                    id={`palette-option-${position}`}
                    role="option"
                    aria-selected={position === active}
                    onMouseEnter={() => setActive(position)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => item.run()}
                  >
                    <item.icon aria-hidden="true" />
                    <span className="opt-title">{item.title}</span>
                    {item.subtitle ? <span className="opt-sub">{item.subtitle}</span> : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {items.length === 0 ? <li className="palette-empty">{query.trim() ? 'Nothing matches.' : 'Type to search, or pick a page.'}</li> : null}
      </ul>
      <div className="palette-foot">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
        </span>
        <span>
          <Kbd>↵</Kbd> open
        </span>
        <span>
          <Kbd>Esc</Kbd> close
        </span>
        {truncated ? <span className="spacer" /> : null}
        {truncated ? <span>More results exist; refine the search.</span> : null}
      </div>
    </Dialog>
  );
}
