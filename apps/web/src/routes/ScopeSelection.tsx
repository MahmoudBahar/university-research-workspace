import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Building2, ChevronsDownUp, ChevronsUpDown, Network } from 'lucide-react';
import { api, type Bootstrap, type ScopeSummary, type UnitNode, type UnitProgressResponse } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { useToast } from '../lib/toast';
import { DataTable, ErrorBanner, Loading, Notice, Panel, Pill } from '../components/ui';
import { Tree, ancestorsOf, collectIds, subtreeMatches } from '../components/Tree';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState } from '../components/EmptyState';

type Decision = 'included' | 'excluded' | 'undecided';

interface UnitsResponse {
  scope: ScopeSummary | null;
  draftVersion: number | null;
  tree: UnitNode[];
}

function flatten(nodes: UnitNode[]): UnitNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const getId = (node: UnitNode) => node.id;
const getChildren = (node: UnitNode) => node.children;
const getLabel = (node: UnitNode) => node.officialName;

export default function ScopeSelection() {
  const boot = useOutletContext<Bootstrap>();
  const { selection, university, universities, setSelection } = useUniversity();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const universityId = university?.id ?? universities[0]?.id ?? '';
  const units = useResource<UnitsResponse>(universityId ? `/api/units?university=${encodeURIComponent(universityId)}` : null, [universityId]);
  const progress = useResource<UnitProgressResponse>(universityId ? `/api/units/progress?university=${encodeURIComponent(universityId)}` : null, [
    universityId,
    units.data?.scope?.currentVersion,
  ]);
  const [pending, setPending] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);

  const tree = units.data?.tree ?? [];

  useEffect(() => setPending({}), [universityId, units.data?.scope?.currentVersion]);

  // Faculties and their departments start open; deeper levels start closed.
  useEffect(() => {
    if (!units.data) return;
    setExpanded(new Set(collectIds(units.data.tree, getId, getChildren, 1)));
  }, [units.data]);

  // Deep link from search: expand ancestors, highlight, scroll once.
  const focusUnit = searchParams.get('unit');
  useEffect(() => {
    if (!focusUnit || tree.length === 0) return;
    const ancestors = ancestorsOf(tree, getId, getChildren, new Set([focusUnit]));
    setExpanded((previous) => new Set([...previous, ...ancestors]));
    setHighlight(focusUnit);
    window.setTimeout(() => document.getElementById(`tree-node-${focusUnit}`)?.scrollIntoView({ block: 'center' }), 50);
    setSearchParams(
      (previous) => {
        previous.delete('unit');
        return previous;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUnit, tree.length]);

  const matchIds = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return null;
    return new Set(flatten(tree).filter((unit) => `${unit.officialName} ${unit.unitType} ${unit.campus ?? ''} ${unit.id}`.toLowerCase().includes(needle)).map(getId));
  }, [filter, tree]);

  const effectiveExpanded = useMemo(() => {
    if (!matchIds) return expanded;
    return new Set([...ancestorsOf(tree, getId, getChildren, matchIds), ...matchIds, ...expanded]);
  }, [matchIds, expanded, tree]);

  const visibleIds = useMemo(() => (matchIds ? subtreeMatches(tree, getId, getChildren, matchIds) : null), [matchIds, tree]);
  const progressByUnit = useMemo(() => new Map((progress.data?.units ?? []).map((row) => [row.unitId, row])), [progress.data]);

  if (boot.status.universities.length === 0) {
    return (
      <>
        <header>
          <h2>Departments</h2>
        </header>
        <EmptyState icon={Building2} title="No university has been discovered yet." command={'/research-university "University name"'}>
          Run the command in Claude Code, then come back to choose departments.
        </EmptyState>
      </>
    );
  }

  const scope = units.data?.scope ?? null;
  const flat = flatten(tree);
  const effective = (unit: UnitNode): Decision => pending[unit.id] ?? unit.decision;

  const setDecision = (unitId: string, decision: Decision) => {
    setPending((previous) => ({ ...previous, [unitId]: decision }));
    setMessage(undefined);
  };

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const saveDraft = async () => {
    if (!scope) return;
    setBusy(true);
    setError(undefined);
    try {
      const decisions = Object.entries(pending).map(([unitId, decision]) => ({ unitId, decision }));
      const result = await api.put<{ draftVersion: number }>(`/api/scopes/${scope.scopeId}/selection`, {
        expectedVersion: scope.currentVersion,
        decisions,
      });
      setMessage(`Saved draft version ${result.draftVersion}. Confirm it to make it the current selection.`);
      setPending({});
      units.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!scope) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.post<{
        report: { newVersion: number; cancelledTasks: number; requeuedTasks: number; staleRunningTasks: number };
        enqueued: { enqueued: unknown[]; includedUnits: number } | null;
      }>(`/api/scopes/${scope.scopeId}/confirm`, { expectedVersion: scope.currentVersion, enqueue: true });
      setMessage(
        `Confirmed version ${result.report.newVersion}. Cancelled ${result.report.cancelledTasks} queued task(s), re-queued ${result.report.requeuedTasks}, ${result.report.staleRunningTasks} running task(s) marked stale. Queued ${result.enqueued?.enqueued.length ?? 0} task(s) across ${result.enqueued?.includedUnits ?? 0} included unit(s).`,
      );
      toast({ kind: 'ok', message: `Selection v${result.report.newVersion} confirmed.` });
      units.reload();
      progress.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = Object.keys(pending).length;

  return (
    <>
      <header>
        <h2>Departments</h2>
        <p className="lede">
          Choose which academic units are in scope. Explicit decisions on a child override anything inherited from its
          parent. Nothing is selected for you, and newly discovered units stay undecided.
        </p>
      </header>

      <ErrorBanner error={error} />
      {message ? <Notice kind="ok">{message}</Notice> : null}
      {selection === 'all' && universities.length > 1 ? (
        <Notice kind="info">
          Showing {university?.name ?? universities[0]?.name}. Choose a university in the top bar to switch.{' '}
          <button type="button" className="ghost" onClick={() => document.getElementById('university-switcher')?.focus()}>
            Choose
          </button>
        </Notice>
      ) : null}

      <Panel icon={Building2} title={university?.name ?? universities[0]?.name ?? 'University'}>
        {selection === 'all' && universities.length > 1 ? (
          <p className="small muted">
            Filtering all universities;{' '}
            <button type="button" className="ghost" onClick={() => setSelection(universityId)}>
              filter by this one
            </button>
            .
          </p>
        ) : null}
        {scope ? (
          <p className="small muted">
            Confirmed version {scope.currentVersion}
            {scope.confirmedAt ? ` on ${scope.confirmedAt.slice(0, 10)}` : ''} · {scope.explicitIncluded} explicit
            inclusions · {scope.explicitExcluded} explicit exclusions · {scope.totalUnits} units discovered
            {units.data?.draftVersion ? ` · unconfirmed draft v${units.data.draftVersion}` : ''}
          </p>
        ) : null}
        <div className="button-row">
          <button type="button" onClick={saveDraft} disabled={busy || pendingCount === 0}>
            Save {pendingCount} change(s) to draft
          </button>
          <button type="button" className="primary" onClick={confirm} disabled={busy || !units.data?.draftVersion}>
            Confirm selection {units.data?.draftVersion ? `as v${units.data.draftVersion}` : ''}
          </button>
          {busy ? <span className="muted small">working…</span> : null}
        </div>
        <p className="small muted">
          Confirming preserves everything already researched. Work that is no longer eligible is cancelled, and results
          produced against an older version cannot be committed as current.
        </p>
      </Panel>

      <Panel
        icon={Network}
        title="Organisational hierarchy"
        actions={
          <>
            <button type="button" className="ghost" onClick={() => setExpanded(new Set(collectIds(tree, getId, getChildren)))}>
              <ChevronsUpDown aria-hidden="true" />
              Expand all
            </button>
            <button type="button" className="ghost" onClick={() => setExpanded(new Set())}>
              <ChevronsDownUp aria-hidden="true" />
              Collapse all
            </button>
          </>
        }
      >
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="unit-filter">
            Find a unit <span className="optional">by name, type, campus or id</span>
          </label>
          <input id="unit-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="e.g. Mechanical" />
        </div>
        {units.loading && !units.data ? <Loading what="units" variant="table" columns={3} /> : null}
        {units.data && units.data.tree.length === 0 ? (
          <Notice kind="info">No units discovered yet for this university.</Notice>
        ) : null}
        {units.data && matchIds && visibleIds && visibleIds.size === 0 ? <p className="muted small">No unit matches “{filter}”.</p> : null}
        {units.data ? (
          <Tree<UnitNode>
            nodes={units.data.tree}
            getId={getId}
            getChildren={getChildren}
            getLabel={getLabel}
            expanded={effectiveExpanded}
            onToggle={toggle}
            visible={visibleIds ? (node) => visibleIds.has(node.id) : undefined}
            highlightId={highlight}
            renderRow={(node) => {
              const decision = effective(node);
              const changed = pending[node.id] !== undefined;
              const unitProgress = progressByUnit.get(node.id);
              return (
                <>
                  <span className="name">{node.officialName}</span>
                  <Pill>{node.unitType}</Pill>
                  {node.campus ? <span className="small muted">{node.campus}</span> : null}
                  {!node.explicit && decision !== 'undecided' ? <Pill>inherited</Pill> : null}
                  {changed ? <Pill tone="warn">unsaved</Pill> : null}
                  <span className="decision-group" role="group" aria-label={`Selection for ${node.officialName}`}>
                    {(['included', 'excluded', 'undecided'] as Decision[]).map((option) => (
                      <button key={option} type="button" aria-pressed={decision === option} onClick={() => setDecision(node.id, option)}>
                        {option === 'included' ? 'Include' : option === 'excluded' ? 'Exclude' : 'Undecided'}
                      </button>
                    ))}
                  </span>
                  {unitProgress && decision === 'included' && unitProgress.tasks.total > 0 ? (
                    <ProgressBar compact value={unitProgress.tasks.complete} max={unitProgress.tasks.total} label={`Progress for ${node.officialName}`} />
                  ) : null}
                  <span className="small mono muted">{node.id}</span>
                </>
              );
            }}
          />
        ) : null}
      </Panel>

      <Panel title="Flat list" hint="Every discovered unit, including ones you exclude. Their notes are kept either way.">
        <DataTable
          rows={flat}
          rowKey={(unit) => unit.id}
          empty="No units."
          loading={units.loading}
          columns={[
            { key: 'name', header: 'Unit', render: (unit) => unit.officialName, sortValue: (unit) => unit.officialName },
            { key: 'type', header: 'Type', render: (unit) => unit.unitType, sortValue: (unit) => unit.unitType },
            {
              key: 'decision',
              header: 'Decision',
              sortValue: (unit) => effective(unit),
              render: (unit) => {
                const decision = effective(unit);
                return (
                  <Pill tone={decision === 'included' ? 'ok' : decision === 'excluded' ? 'danger' : 'default'}>{decision}</Pill>
                );
              },
            },
            { key: 'note', header: 'Note', render: (unit) => <span className="mono small">{unit.notePath ?? '—'}</span> },
          ]}
        />
      </Panel>
    </>
  );
}
