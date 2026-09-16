import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { PersonRow } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { DataTable, ErrorBanner, Panel, Pill } from '../components/ui';
import { AppLink } from '../components/AppLink';
import { EmptyState } from '../components/EmptyState';

const ROLE_LABELS: Record<string, string> = {
  professor: 'Professor',
  associate_professor: 'Associate Professor',
  assistant_professor: 'Assistant Professor',
  research_assistant: 'Research assistant',
  graduate_student: 'Graduate student',
  postdoctoral_researcher: 'Postdoctoral researcher',
  administrative_staff: 'Administrative staff',
};

/** Laboratories listed inline per row before the rest collapse into a link. */
const LABS_SHOWN = 2;

function blockers(row: PersonRow) {
  return row.readiness.issues.filter((issue) => issue.severity === 'blocker');
}

export default function People() {
  const [searchParams] = useSearchParams();
  const { withUniversity, selection } = useUniversity();
  const [onlyReady, setOnlyReady] = useState(searchParams.get('ready') === 'true');
  const [filter, setFilter] = useState('');
  const people = useResource<PersonRow[]>(withUniversity(`/api/people${onlyReady ? '?ready=true' : ''}`), [onlyReady, selection], { keepPrevious: true });

  const rows = (people.data ?? []).filter((row) =>
    filter.trim() === ''
      ? true
      : `${row.full_name} ${row.official_title ?? ''} ${row.affiliations.map((a) => a.display_title).join(' ')}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
  );

  return (
    <>
      <header>
        <h2>People</h2>
        <p className="lede">
          One canonical record per person across departments and laboratories. Academic rank and normalised role are kept
          separate: an Assistant Professor is not a research assistant.
        </p>
      </header>

      <ErrorBanner error={people.error} />

      <Panel icon={Users} title="All people">
        <div className="field-row">
          <div className="field">
            <label htmlFor="people-filter">
              Filter <span className="optional">by name, title or department</span>
            </label>
            <input id="people-filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
          </div>
          <div className="field" style={{ flex: '0 0 auto', alignSelf: 'end' }}>
            <label htmlFor="only-ready" style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                id="only-ready"
                type="checkbox"
                style={{ width: 'auto' }}
                checked={onlyReady}
                onChange={(event) => setOnlyReady(event.target.checked)}
              />
              Only people ready for an email
            </label>
          </div>
        </div>

        {people.loading && people.data ? <div className="loading-bar" aria-hidden="true" /> : null}
        <DataTable
          rows={rows}
          rowKey={(row) => row.entity_id}
          empty="No people recorded yet."
          loading={people.loading}
          emptyState={
            filter.trim() || onlyReady ? undefined : (
              <EmptyState icon={Users} title="No people recorded yet." command="/discover-people">
                /discover-people finds faculty for included departments after you confirm a selection.
              </EmptyState>
            )
          }
          columns={[
            {
              key: 'name',
              header: 'Person',
              sortValue: (row) => row.full_name,
              render: (row) => (
                <>
                  <AppLink to={`/people/${row.entity_id}`}>{row.full_name}</AppLink>
                  <div className="small muted">{row.official_title ?? '—'}</div>
                </>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              sortValue: (row) => row.role_category,
              render: (row) => ROLE_LABELS[row.role_category] ?? row.role_category.replace(/_/g, ' '),
            },
            {
              key: 'units',
              header: 'Departments',
              render: (row) => {
                if (row.affiliations.length === 0) return <span className="muted">—</span>;
                const titles = row.affiliations.map((unit) => unit.display_title).join(', ');
                return (
                  <span className="cell-truncate" title={titles}>
                    {titles}
                  </span>
                );
              },
            },
            {
              key: 'labs',
              header: 'Laboratories',
              render: (row) => {
                if (row.labs.length === 0) return <span className="muted">—</span>;
                // A person with many affiliations would otherwise stretch the row far
                // taller than every other one. The person page lists them all.
                const shown = row.labs.slice(0, LABS_SHOWN);
                const hidden = row.labs.length - shown.length;
                return (
                  <>
                    {shown.map((lab) => (
                      <div key={lab.lab_id} className="cell-truncate" title={lab.display_title}>
                        <AppLink to={`/labs/${lab.lab_id}`}>{lab.display_title}</AppLink>
                        {lab.rel_type === 'directs_lab' ? ' (director)' : ''}
                      </div>
                    ))}
                    {hidden > 0 ? (
                      <div className="small muted">
                        <AppLink to={`/people/${row.entity_id}`}>+{hidden} more</AppLink>
                      </div>
                    ) : null}
                  </>
                );
              },
            },
            {
              key: 'research',
              header: 'Research',
              sortValue: (row) => row.research_complete,
              render: (row) => (
                <Pill tone={row.research_complete ? 'ok' : row.readiness.researchHeld ? 'warn' : 'default'}>
                  {row.research_complete ? 'complete' : row.readiness.researchHeld ? 'held' : 'not started'}
                </Pill>
              ),
            },
            {
              key: 'email',
              header: 'Email ready',
              sortValue: (row) => (row.readiness.emailReady ? -1 : blockers(row).length),
              render: (row) =>
                row.readiness.emailReady ? (
                  <Pill tone="ok">ready</Pill>
                ) : (
                  <Pill tone="warn" title={blockers(row).map((issue) => issue.message).join(' ')}>
                    {blockers(row).length} blocker(s)
                  </Pill>
                ),
            },
            {
              key: 'contact',
              header: 'Contact rule',
              sortValue: (row) => row.contact_rule ?? 'unknown',
              render: (row) => (
                <Pill tone={row.contact_rule === 'email_ok' ? 'ok' : row.contact_rule === 'unknown' || !row.contact_rule ? 'default' : 'danger'}>
                  {(row.contact_rule ?? 'unknown').replace(/_/g, ' ')}
                </Pill>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
