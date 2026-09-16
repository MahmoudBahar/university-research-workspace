import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { DataTable, ErrorBanner, Loading, Markdown, Notice, Panel, Pill } from '../components/ui';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { EmptyState } from '../components/EmptyState';

interface ProgramRow {
  id: string;
  official_title: string;
  award: string | null;
  degree_family: string | null;
  campus: string | null;
  canonical_path: string | null;
  frontmatter_json: string | null;
  checked_at: string | null;
}

interface ProgramDetail {
  program: { entity_id: string; official_title: string; award: string | null } | undefined;
  note: { path: string; sha256: string; text: string; frontmatter: Record<string, unknown> } | null;
  claims: { claim_key: string; claim_value: string | null; evidence_status: string; checked_at: string | null; freshness_class: string }[];
  units: { unit_id: string; display_title: string }[];
}

export default function Programs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { withUniversity, selection } = useUniversity();
  const programs = useResource<ProgramRow[]>(withUniversity('/api/programs'), [selection], { keepPrevious: true });
  const [selected, setSelected] = useState<string | null>(searchParams.get('open'));
  const [filter, setFilter] = useState('');
  const detail = useResource<ProgramDetail>(selected ? `/api/programs/${encodeURIComponent(selected)}` : null, [selected]);

  // `?open=<id>` arrives from the command palette; consume it once.
  const open = searchParams.get('open');
  useEffect(() => {
    if (!open) return;
    setSelected(open);
    setSearchParams(
      (previous) => {
        previous.delete('open');
        return previous;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rows = (programs.data ?? []).filter((row) =>
    filter.trim() === '' ? true : `${row.official_title} ${row.award ?? ''} ${row.campus ?? ''}`.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <>
      <header>
        {selected && detail.data?.program ? <Breadcrumbs items={[{ label: 'Programs', to: '/programs' }, { label: detail.data.program.official_title }]} /> : null}
        <h2>Programs</h2>
        <p className="lede">
          Program facts as recorded, with the academic year or intake they apply to. Exact official degree names are kept
          verbatim; nothing is substituted when none of the configured primary degrees exists.
        </p>
      </header>

      <ErrorBanner error={programs.error} />

      <Panel icon={GraduationCap} title="All programs">
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="program-filter">
            Filter <span className="optional">by title, award or campus</span>
          </label>
          <input id="program-filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </div>
        {programs.loading && programs.data ? <div className="loading-bar" aria-hidden="true" /> : null}
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty="No programs recorded yet. /research-programs runs for included units after you confirm a selection."
          loading={programs.loading}
          emptyState={
            filter.trim() ? undefined : (
              <EmptyState icon={GraduationCap} title="No programs recorded yet." command="/research-programs">
                /research-programs runs for included units after you confirm a selection.
              </EmptyState>
            )
          }
          columns={[
            {
              key: 'title',
              header: 'Program',
              sortValue: (row) => row.official_title,
              render: (row) => (
                <button type="button" className="button" onClick={() => setSelected(row.id)}>
                  {row.official_title}
                </button>
              ),
            },
            { key: 'award', header: 'Award', sortValue: (row) => row.award, render: (row) => row.award ?? <span className="muted">—</span> },
            { key: 'campus', header: 'Campus', sortValue: (row) => row.campus, render: (row) => row.campus ?? <span className="muted">—</span> },
            { key: 'checked', header: 'Checked', sortValue: (row) => row.checked_at, render: (row) => row.checked_at ?? <span className="muted">—</span> },
          ]}
        />
      </Panel>

      {selected ? (
        <Panel title="Program detail" id="program-detail" actions={<button type="button" onClick={() => setSelected(null)}>Close</button>}>
          {detail.loading ? <Loading what="program" variant="panel" /> : null}
          <ErrorBanner error={detail.error} />
          {detail.data ? (
            <>
              <p className="small muted">
                Administered by {detail.data.units.map((unit) => unit.display_title).join(', ') || 'unrecorded unit'} ·
                note <span className="mono">{detail.data.note?.path ?? 'missing'}</span>
              </p>
              {detail.data.claims.length > 0 ? (
                <DataTable
                  caption="Critical claims and when they were last checked"
                  rows={detail.data.claims}
                  rowKey={(claim) => claim.claim_key}
                  empty="No claims recorded."
                  dense
                  columns={[
                    { key: 'key', header: 'Claim', render: (claim) => claim.claim_key.replace(/_/g, ' ') },
                    { key: 'status', header: 'Evidence', render: (claim) => <Pill>{claim.evidence_status}</Pill> },
                    { key: 'freshness', header: 'Freshness', render: (claim) => claim.freshness_class },
                    { key: 'checked', header: 'Checked', render: (claim) => claim.checked_at ?? '—' },
                  ]}
                />
              ) : null}
              {detail.data.note ? <Markdown text={detail.data.note.text} /> : <Notice kind="warn">The program note is missing from the vault.</Notice>}
            </>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}
