import { useNavigate, useParams } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { DataTable, ErrorBanner, Loading, Markdown, Notice, Panel, Pill } from '../components/ui';
import { AppLink } from '../components/AppLink';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { EmptyState } from '../components/EmptyState';

interface LabRow {
  entity_id: string;
  official_name: string;
  url: string | null;
  timezone: string | null;
  timezone_basis: string | null;
  canonical_path: string | null;
  member_count: number;
}

interface LabDetail {
  lab: LabRow | undefined;
  note: { path: string; text: string } | null;
  members: {
    person_id: string;
    display_title: string;
    role: string;
    status: string;
    rel_type: string;
    observed_at: string | null;
    evidence_status: string;
  }[];
}

export default function Labs() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { withUniversity, selection } = useUniversity();
  const labs = useResource<LabRow[]>(withUniversity('/api/labs'), [selection], { keepPrevious: true });
  const detail = useResource<LabDetail>(id ? `/api/labs/${encodeURIComponent(id)}` : null, [id]);

  return (
    <>
      <header>
        {id ? <Breadcrumbs items={[{ label: 'Laboratories', to: '/labs' }, { label: detail.data?.lab?.official_name ?? id }]} /> : null}
        <h2>Laboratories</h2>
        <p className="lede">
          Membership carries evidence and observed dates. Absence from a current roster is not evidence that somebody
          left, and an active page is not evidence of a funded opening.
        </p>
      </header>

      <ErrorBanner error={labs.error} />

      <Panel icon={FlaskConical} title="All laboratories">
        {labs.loading && labs.data ? <div className="loading-bar" aria-hidden="true" /> : null}
        <DataTable
          rows={labs.data ?? []}
          rowKey={(lab) => lab.entity_id}
          empty="No laboratories recorded yet."
          loading={labs.loading}
          emptyState={
            <EmptyState icon={FlaskConical} title="No laboratories recorded yet." command="/research-labs --university <id>">
              Laboratories appear when people research finds them, or when you research one from a URL.
            </EmptyState>
          }
          columns={[
            {
              key: 'name',
              header: 'Laboratory',
              sortValue: (lab) => lab.official_name,
              render: (lab) => <AppLink to={`/labs/${lab.entity_id}`}>{lab.official_name}</AppLink>,
            },
            {
              key: 'url',
              header: 'Site',
              render: (lab) =>
                lab.url ? (
                  <a href={lab.url} rel="noreferrer noopener nofollow" target="_blank">
                    {lab.url}
                  </a>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            { key: 'members', header: 'Members', sortValue: (lab) => lab.member_count, render: (lab) => lab.member_count },
            {
              key: 'zone',
              header: 'Time zone',
              sortValue: (lab) => lab.timezone,
              render: (lab) => (
                <>
                  {lab.timezone ?? <span className="muted">unknown</span>}{' '}
                  {lab.timezone_basis ? <Pill>{lab.timezone_basis.replace(/_/g, ' ')}</Pill> : null}
                </>
              ),
            },
          ]}
        />
      </Panel>

      {id ? (
        <Panel
          title={detail.data?.lab?.official_name ?? 'Laboratory'}
          actions={<button type="button" onClick={() => navigate('/labs')}>Close</button>}
        >
          {detail.loading ? <Loading what="laboratory" variant="panel" /> : null}
          <ErrorBanner error={detail.error} />
          {detail.data ? (
            <>
              <DataTable
                caption="Membership, with the evidence that supports it"
                rows={detail.data.members}
                rowKey={(member) => `${member.person_id}:${member.rel_type}`}
                empty="No membership recorded."
                dense
                columns={[
                  {
                    key: 'person',
                    header: 'Person',
                    sortValue: (member) => member.display_title,
                    render: (member) => <AppLink to={`/people/${member.person_id}`}>{member.display_title}</AppLink>,
                  },
                  { key: 'role', header: 'Role', render: (member) => member.role || member.rel_type.replace(/_/g, ' ') },
                  {
                    key: 'status',
                    header: 'Status',
                    sortValue: (member) => member.status,
                    render: (member) => <Pill tone={member.status === 'current' ? 'ok' : 'default'}>{member.status}</Pill>,
                  },
                  { key: 'observed', header: 'Observed', sortValue: (member) => member.observed_at, render: (member) => member.observed_at ?? <span className="muted">—</span> },
                  { key: 'evidence', header: 'Evidence', render: (member) => <Pill>{member.evidence_status}</Pill> },
                ]}
              />
              {detail.data.note ? <Markdown text={detail.data.note.text} /> : <Notice kind="warn">No lab note yet.</Notice>}
            </>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}
