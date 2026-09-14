import { useState } from 'react';
import { Network } from 'lucide-react';
import { api } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { useToast } from '../lib/toast';
import { DataTable, ErrorBanner, Panel, Pill } from '../components/ui';
import { AppLink } from '../components/AppLink';

interface RelationshipRow {
  id: string;
  from_id: string;
  from_title: string | null;
  from_kind: string | null;
  to_id: string;
  to_title: string | null;
  to_kind: string | null;
  rel_type: string;
  role: string;
  status: string;
  evidence_status: string;
  observed_at: string | null;
}

interface DuplicateRow {
  id: string;
  entity_id: string;
  entity_title: string | null;
  other_entity_id: string;
  other_title: string | null;
  reason: string;
  confidence: string;
}

function linkFor(kind: string | null, id: string): string | null {
  if (kind === 'person') return `/people/${id}`;
  if (kind === 'lab') return `/labs/${id}`;
  return null;
}

export default function Connections() {
  const { withUniversity, selection } = useUniversity();
  const { toast } = useToast();
  const relationships = useResource<RelationshipRow[]>(withUniversity('/api/relationships?limit=500'), [selection], { keepPrevious: true });
  const duplicates = useResource<DuplicateRow[]>(withUniversity('/api/duplicates'), [selection], { keepPrevious: true });
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const rows = (relationships.data ?? []).filter((row) =>
    filter.trim() === ''
      ? true
      : `${row.from_title ?? ''} ${row.to_title ?? ''} ${row.rel_type}`.toLowerCase().includes(filter.toLowerCase()),
  );

  const merge = async (keep: string, mergeId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.post('/api/duplicates/merge', { keep, merge: mergeId, reason: 'Merged from the connections screen.' });
      toast({ kind: 'ok', message: `Merged ${mergeId} into ${keep}. The merged record stays as a redirect.` });
      duplicates.reload();
      relationships.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header>
        <h2>Connections</h2>
        <p className="lede">
          Typed, sourced relationships between people, units, programs, laboratories and publications. The same links
          exist as real relative Markdown links inside the vault, so Obsidian shows them too.
        </p>
      </header>

      <ErrorBanner error={error} />

      <Panel title="Duplicate candidates" hint="A shared display name never merges records on its own. Confirm a merge yourself.">
        <DataTable
          rows={duplicates.data ?? []}
          rowKey={(row) => row.id}
          empty="No unresolved duplicate candidates."
          loading={duplicates.loading}
          columns={[
            { key: 'a', header: 'Record', render: (row) => `${row.entity_title ?? row.entity_id} (${row.entity_id})` },
            { key: 'b', header: 'Possible duplicate', render: (row) => `${row.other_title ?? row.other_entity_id} (${row.other_entity_id})` },
            { key: 'reason', header: 'Reason', render: (row) => row.reason.replace(/_/g, ' ') },
            { key: 'confidence', header: 'Confidence', render: (row) => <Pill>{row.confidence}</Pill> },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <div className="button-row">
                  <button type="button" disabled={busy} onClick={() => merge(row.entity_id, row.other_entity_id)}>
                    Keep {row.entity_id}
                  </button>
                  <button type="button" disabled={busy} onClick={() => merge(row.other_entity_id, row.entity_id)}>
                    Keep {row.other_entity_id}
                  </button>
                </div>
              ),
            },
          ]}
        />
      </Panel>

      <Panel icon={Network} title="Relationships">
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="rel-filter">Filter</label>
          <input id="rel-filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </div>
        {relationships.loading && relationships.data ? <div className="loading-bar" aria-hidden="true" /> : null}
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty="No relationships recorded."
          loading={relationships.loading}
          dense
          columns={[
            {
              key: 'from',
              header: 'From',
              sortValue: (row) => row.from_title ?? row.from_id,
              render: (row) => {
                const to = linkFor(row.from_kind, row.from_id);
                return to ? <AppLink to={to}>{row.from_title ?? row.from_id}</AppLink> : (row.from_title ?? row.from_id);
              },
            },
            {
              key: 'type',
              header: 'Relationship',
              sortValue: (row) => row.rel_type,
              render: (row) => `${row.rel_type.replace(/_/g, ' ')}${row.role ? ` (${row.role})` : ''}`,
            },
            {
              key: 'to',
              header: 'To',
              sortValue: (row) => row.to_title ?? row.to_id,
              render: (row) => {
                const to = linkFor(row.to_kind, row.to_id);
                return to ? <AppLink to={to}>{row.to_title ?? row.to_id}</AppLink> : (row.to_title ?? row.to_id);
              },
            },
            { key: 'status', header: 'Status', render: (row) => <Pill tone={row.status === 'current' ? 'ok' : 'default'}>{row.status}</Pill> },
            {
              key: 'evidence',
              header: 'Evidence',
              render: (row) =>
                row.evidence_status === 'needs_browser' ? (
                  <Pill tone="accent" title="Plain fetching returned no usable content. Enable Claude in Chrome and re-run the source map.">
                    needs browser
                  </Pill>
                ) : (
                  <Pill>{row.evidence_status}</Pill>
                ),
            },
            { key: 'observed', header: 'Observed', sortValue: (row) => row.observed_at, render: (row) => row.observed_at ?? <span className="muted">—</span> },
          ]}
        />
      </Panel>
    </>
  );
}
