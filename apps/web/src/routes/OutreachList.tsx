import { Mail } from 'lucide-react';
import type { OutreachRow } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useUniversity } from '../lib/university';
import { DataTable, ErrorBanner, Notice, Panel, StateBadge } from '../components/ui';
import { AppLink } from '../components/AppLink';
import { EmptyState } from '../components/EmptyState';

export default function OutreachList() {
  const { withUniversity, selection } = useUniversity();
  const outreach = useResource<OutreachRow[]>(withUniversity('/api/outreach'), [selection], { keepPrevious: true });

  return (
    <>
      <header>
        <h2>Email drafts</h2>
        <p className="lede">
          One package per person, purpose, program and campaign. Every message is for you to send by hand; this system
          has no mail transport of any kind.
        </p>
      </header>

      <ErrorBanner error={outreach.error} />
      <Panel icon={Mail} title="All drafts">
        {outreach.loading && outreach.data ? <div className="loading-bar" aria-hidden="true" /> : null}
        <DataTable
          rows={outreach.data ?? []}
          rowKey={(row) => row.id}
          empty="No drafts yet. /draft-outreach creates them for people whose research is complete and whose contact route is verified."
          loading={outreach.loading}
          emptyState={
            <EmptyState icon={Mail} title="No drafts yet." command="/draft-outreach --ready">
              /draft-outreach creates them for people whose research is complete and whose contact route is verified.
            </EmptyState>
          }
          columns={[
            { key: 'id', header: 'Draft', sortValue: (row) => row.id, render: (row) => <AppLink to={`/outreach/${row.id}`}>{row.id}</AppLink> },
            { key: 'person', header: 'Person', sortValue: (row) => row.person_title ?? row.person_id, render: (row) => row.person_title ?? row.person_id },
            { key: 'purpose', header: 'Purpose', render: (row) => row.purpose.replace(/_/g, ' ') },
            { key: 'program', header: 'Program', render: (row) => row.program_id || <span className="muted">—</span> },
            { key: 'state', header: 'State', sortValue: (row) => row.state, render: (row) => <StateBadge state={row.state} /> },
            { key: 'revision', header: 'Revision', sortValue: (row) => row.current_revision, render: (row) => row.current_revision },
            { key: 'sent', header: 'Recorded sends', sortValue: (row) => row.sent_count, render: (row) => row.sent_count },
          ]}
        />
      </Panel>
      <Notice kind="info">
        Nothing here schedules or transmits a message. A planned time only produces a due or overdue view.
      </Notice>
    </>
  );
}
