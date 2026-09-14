import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Clock,
  FlaskConical,
  GraduationCap,
  History,
  LayoutDashboard,
  ListChecks,
  Mail,
  Network,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Bootstrap, WorkspaceStatus } from '../lib/api';
import { AppNavLink } from './AppLink';
import { IconButton } from './IconButton';
import { Pill } from './ui';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: (status: WorkspaceStatus) => { value: number; tone: 'ok' | 'warn' | 'danger' | 'accent' } | null;
}

export interface NavGroup {
  id: 'research' | 'outreach' | 'workspace';
  label: string;
  items: NavItem[];
}

const count = (value: number | undefined, tone: 'ok' | 'warn' | 'danger' | 'accent') => (value && value > 0 ? { value, tone } : null);

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'research',
    label: 'Research',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/scope', label: 'Departments', icon: Network },
      { to: '/programs', label: 'Programs', icon: GraduationCap },
      { to: '/people', label: 'People', icon: Users, badge: (s) => count(s.readyCandidates.filter((row) => row.emailReady).length, 'ok') },
      { to: '/labs', label: 'Laboratories', icon: FlaskConical },
      { to: '/queue', label: 'Queue', icon: ListChecks, badge: (s) => count(s.blocked.length, 'warn') },
    ],
  },
  {
    id: 'outreach',
    label: 'Outreach',
    items: [
      { to: '/applicant', label: 'Applicant', icon: UserRound },
      { to: '/outreach', label: 'Email drafts', icon: Mail },
      { to: '/review', label: 'Review', icon: ShieldCheck, badge: (s) => count(s.outreach.byState['needs_review'], 'warn') },
      { to: '/planner', label: 'Send planner', icon: Clock, badge: (s) => count((s.outreach.due ?? 0) + (s.outreach.overdue ?? 0), 'danger') },
      { to: '/sent', label: 'Sent history', icon: History },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { to: '/connections', label: 'Connections', icon: Search },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const COLLAPSED_KEY = 'urw.sidebar.collapsed';

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Sidebar({ boot, open, onClose, returnFocusTo }: { boot: Bootstrap | undefined; open: boolean; onClose: () => void; returnFocusTo?: () => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const aside = useRef<HTMLElement>(null);
  const status = boot?.status;

  const toggleGroup = (id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  // Drawer behaviour under 900px: trap focus, close on Escape, restore focus.
  const isDrawer = useCallback(() => window.matchMedia('(max-width: 900px)').matches, []);
  useEffect(() => {
    if (!open || !isDrawer()) return;
    const element = aside.current;
    if (!element) return;
    const first = element.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const start = focusable[0] as HTMLElement;
      const end = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnFocusTo?.();
    };
  }, [open, onClose, isDrawer, returnFocusTo]);

  return (
    <>
      <button type="button" className="drawer-backdrop" data-open={open ? 'true' : 'false'} aria-label="Close navigation" tabIndex={-1} onClick={onClose} />
      <aside className="sidebar" ref={aside} data-open={open ? 'true' : 'false'} aria-label="Navigation" id="sidebar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen size={16} />
          </span>
          <div>
            <h1>Research workspace</h1>
            <p className="subtitle">Local. Manual sending only.</p>
          </div>
          <IconButton className="drawer-close" label="Close navigation" icon={X} onClick={onClose} size="small" />
        </div>
        <nav aria-label="Sections">
          {NAV_GROUPS.map((group) => {
            const isCollapsed = collapsed.has(group.id);
            const listId = `nav-group-${group.id}`;
            return (
              <div className="nav-group" key={group.id}>
                <button type="button" className="nav-group-header" aria-expanded={!isCollapsed} aria-controls={listId} onClick={() => toggleGroup(group.id)}>
                  <ChevronDown className="chevron" aria-hidden="true" />
                  {group.label}
                </button>
                <ul id={listId} hidden={isCollapsed}>
                  {group.items.map((item) => {
                    const badge = status && item.badge ? item.badge(status) : null;
                    return (
                      <li key={item.to}>
                        <AppNavLink to={item.to} end={item.end} onClick={onClose}>
                          <item.icon aria-hidden="true" />
                          <span className="label">{item.label}</span>
                          {badge ? <Pill tone={badge.tone}>{badge.value}</Pill> : null}
                        </AppNavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="spacer" />
        <p className="sidebar-foot">{boot ? `${boot.status.driver} · ${boot.status.universities.length} university/ies` : 'connecting…'}</p>
      </aside>
    </>
  );
}
