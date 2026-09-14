import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, type LucideIcon } from 'lucide-react';
import { renderMarkdown } from '../lib/markdown';
import { useCountUp } from '../lib/useCountUp';
import { AppLink } from './AppLink';
import { PanelSkeleton, TableSkeleton } from './Skeleton';

export function Panel({
  title,
  hint,
  children,
  actions,
  icon: Icon,
  id,
  className,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  id?: string;
  className?: string;
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`} id={id}>
      {title ? (
        <div className="panel-head">
          <h3>
            {Icon ? <Icon className="panel-icon" aria-hidden="true" /> : null}
            {title}
          </h3>
          <span className="spacer" />
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </section>
  );
}

export function Notice({ kind = 'info', title, children }: { kind?: 'info' | 'ok' | 'warn' | 'danger'; title?: string; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'danger' ? 'alert' : 'status'}>
      {title ? <strong>{title}</strong> : null}
      {title ? ' ' : null}
      {children}
    </div>
  );
}

export function Pill({ tone = 'default', children, title }: { tone?: 'default' | 'ok' | 'warn' | 'danger' | 'accent'; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${tone === 'default' ? '' : tone}`} title={title}>
      {children}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  const tone =
    state === 'complete' || state === 'approved' || state === 'sent'
      ? 'ok'
      : state === 'blocked' || state === 'failed' || state === 'stale'
        ? 'danger'
        : state === 'running' || state === 'needs_review' || state === 'partial' || state === 'retryable_failed'
          ? 'warn'
          : 'default';
  return <Pill tone={tone}>{state.replace(/_/g, ' ')}</Pill>;
}

/**
 * A loading state. The visually hidden text keeps `role="status"` for assistive
 * technology while a skeleton shows the shape of what is coming.
 */
export function Loading({ what, variant = 'text', rows, columns }: { what: string; variant?: 'text' | 'table' | 'panel'; rows?: number; columns?: number }) {
  if (variant === 'text') {
    return (
      <p className="muted small" role="status">
        Loading {what}…
      </p>
    );
  }
  return (
    <div role="status">
      <span className="visually-hidden">Loading {what}…</span>
      {variant === 'table' ? <TableSkeleton rows={rows} columns={columns} /> : <PanelSkeleton />}
    </div>
  );
}

export function ErrorBanner({ error }: { error: Error | undefined }) {
  if (!error) return null;
  const detail = (error as { detail?: Record<string, unknown> }).detail;
  return (
    <Notice kind="danger" title="Something went wrong.">
      {error.message}
      {detail && Object.keys(detail).length > 0 ? <pre>{JSON.stringify(detail, null, 2)}</pre> : null}
    </Notice>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}

/** Markdown is sanitised in one place before it is ever inserted into the DOM. */
export function Markdown({ text }: { text: string }) {
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

export function Stat({
  value,
  label,
  tone,
  icon: Icon,
  hint,
  to,
}: {
  value: ReactNode;
  label: string;
  tone?: 'ok' | 'warn' | 'danger';
  icon?: LucideIcon;
  hint?: string;
  to?: string;
}) {
  const inner = (
    <>
      {Icon ? <Icon className="stat-icon" aria-hidden="true" /> : null}
      <div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </div>
      <div className="label">{label}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </>
  );
  return to ? (
    <AppLink className="stat" to={to}>
      {inner}
    </AppLink>
  ) : (
    <div className="stat">{inner}</div>
  );
}

/** A number that counts up to its value when it appears or changes. */
export function AnimatedNumber({ value }: { value: number }) {
  const shown = useCountUp(value);
  return <span data-counting={shown !== value ? 'true' : undefined}>{shown}</span>;
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** When present the column is sortable by this value. */
  sortValue?: (row: T) => string | number | null | undefined;
}

type SortDirection = 'asc' | 'desc';

function compareValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const aMissing = a === null || a === undefined || a === '';
  const bMissing = b === null || b === undefined || b === '';
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  empty,
  rowKey,
  defaultSort,
  loading,
  emptyState,
  dense,
}: {
  caption?: string;
  columns: Column<T>[];
  rows: T[];
  empty: string;
  rowKey: (row: T) => string;
  defaultSort?: { key: string; dir: SortDirection };
  loading?: boolean;
  emptyState?: ReactNode;
  dense?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDirection } | null>(defaultSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const getter = column.sortValue;
    const copy = rows.map((row, index) => ({ row, index }));
    copy.sort((x, y) => {
      const result = compareValues(getter(x.row), getter(y.row));
      if (result !== 0) return sort.dir === 'asc' ? result : -result;
      return x.index - y.index;
    });
    return copy.map((entry) => entry.row);
  }, [rows, sort, columns]);

  if (loading && rows.length === 0) return <TableSkeleton columns={columns.length} />;
  if (rows.length === 0) return emptyState ? <>{emptyState}</> : <Empty>{empty}</Empty>;

  const toggle = (key: string) => {
    setSort((previous) => {
      if (!previous || previous.key !== key) return { key, dir: 'asc' };
      if (previous.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };

  return (
    <div className="table-scroll">
      <table className={dense ? 'dense' : undefined}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key ? sort.dir : null;
              const ariaSort = active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : undefined;
              return (
                <th key={column.key} scope="col" aria-sort={ariaSort}>
                  {column.sortValue ? (
                    <button type="button" className="th-sort" onClick={() => toggle(column.key)}>
                      {column.header}
                      {active === 'asc' ? <ArrowUp aria-hidden="true" /> : active === 'desc' ? <ArrowDown aria-hidden="true" /> : <ArrowUpDown aria-hidden="true" />}
                      <span className="visually-hidden">{active ? `, sorted ${active === 'asc' ? 'ascending' : 'descending'}` : ', sortable'}</span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={rowKey(row)} style={{ '--i': index } as CSSProperties}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CommandHint({ command, note }: { command: string; note?: string }) {
  return (
    <Notice kind="info">
      Run this in your Claude Code session: <code>{command}</code>
      {note ? <div className="small muted">{note}</div> : null}
    </Notice>
  );
}

export function IssueList({ issues }: { issues: { code: string; message: string; severity: 'blocker' | 'warning' }[] }) {
  if (issues.length === 0) return <Notice kind="ok">No outstanding issues.</Notice>;
  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return (
    <>
      {blockers.length > 0 ? (
        <Notice kind="danger" title="Blocked:">
          <ul>
            {blockers.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {warnings.length > 0 ? (
        <Notice kind="warn" title="Worth knowing:">
          <ul>
            {warnings.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </>
  );
}
