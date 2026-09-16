import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { api, type Readiness } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useToast } from '../lib/toast';
import { DataTable, ErrorBanner, IssueList, Loading, Markdown, Notice, Panel, Pill, StateBadge } from '../components/ui';
import { AppLink as Link } from '../components/AppLink';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CommandHint } from '../components/ui';
import { CopyButton } from '../components/CopyButton';
import { NoteOutline } from '../components/NoteOutline';

interface PersonDetailResponse {
  person: {
    entity_id: string;
    full_name: string;
    official_title: string | null;
    role_category: string;
    email: string | null;
    email_evidence: string | null;
    contact_rule: string | null;
    timezone: string | null;
    timezone_basis: string | null;
    research_complete: number;
  } | undefined;
  entity: { canonical_path: string | null; identity_confidence: string } | undefined;
  readiness: Readiness;
  profileNote: { path: string; sha256: string; text: string } | null;
  sourceMapNote: { path: string; sha256: string; text: string } | null;
  sources: {
    source_id: string;
    url: string;
    title: string | null;
    source_category: string;
    identity_confidence: string;
    access_status: string;
    fetch_method?: string | null;
    investigated: number;
    latest_access: string | null;
    latest_observed_at: string | null;
  }[];
  publications: {
    entity_id: string;
    title: string;
    doi: string | null;
    venue: string | null;
    published_date: string | null;
    accessibility: string;
    summary_basis: string;
    canonical_path: string | null;
  }[];
  relationships: { to_id: string; to_title: string | null; to_kind: string | null; rel_type: string; role: string; status: string; evidence_status: string }[];
  tasks: { id: string; job_kind: string; state: string; blocked_reason: string | null; updated_at: string }[];
}

const TABS = ['profile', 'sources', 'publications', 'relationships', 'workflow'] as const;
type Tab = (typeof TABS)[number];

/**
 * The command for this person's next unfinished job. It mirrors the per-record
 * prerequisites: /research-person needs a source map (a finished /map-person run
 * or mapped sources), and /draft-outreach needs research marked complete.
 */
function nextPersonCommand(personId: string, data: PersonDetailResponse): { lead: string; command: string | null } {
  const mapped = data.tasks.some((task) => task.job_kind === 'map_person_sources' && task.state === 'complete') || data.sources.length > 0;
  if (!mapped) return { lead: 'Map the sources first. Run', command: `/map-person ${personId}` };
  if (!data.person?.research_complete) {
    // research_complete is withheld when verification records blocking issues, so
    // a finished /research-person run can still leave the flag clear. Re-running it would change
    // nothing; the blockers above are what needs resolving.
    const researchTaskDone = data.tasks.some((task) => task.job_kind === 'research_person' && task.state === 'complete');
    if (researchTaskDone) {
      return {
        lead: '/research-person has already run. Running it again will not clear the blockers listed under Contact and readiness.',
        command: null,
      };
    }
    return { lead: 'Next, run', command: `/research-person ${personId}` };
  }
  return { lead: 'Next, run', command: `/draft-outreach ${personId}` };
}

export default function PersonDetail() {
  const { id } = useParams();
  const detail = useResource<PersonDetailResponse>(id ? `/api/people/${encodeURIComponent(id)}` : null, [id]);
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('profile');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const enqueue = async (job: string) => {
    if (!id) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.post<{ taskId: string; created: boolean; state: string }>('/api/tasks', { job, targetId: id });
      toast({
        kind: 'ok',
        title: result.created ? 'Queued' : 'Already queued',
        message: `${result.taskId} (${result.state}). Run it from Claude Code; this interface does not start research.`,
      });
      detail.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  if (detail.loading && !detail.data) return <Loading what="person" variant="panel" />;
  if (detail.error) return <ErrorBanner error={detail.error} />;
  const data = detail.data;
  if (!data?.person) return <Notice kind="warn">No person record for {id}.</Notice>;

  const person = data.person;
  const nextCommand = nextPersonCommand(person.entity_id, data);

  return (
    <>
      <header>
        <Breadcrumbs items={[{ label: 'People', to: '/people' }, { label: person.full_name }]} />
        <h2>{person.full_name}</h2>
        <p className="lede">
          {person.official_title ?? 'Title not recorded'} · role category {person.role_category.replace(/_/g, ' ')} ·
          identity {data.entity?.identity_confidence ?? 'unknown'}
        </p>
      </header>

      <ErrorBanner error={error} />

      <div className="split">
        <Panel icon={UserRound} title="Contact and readiness">
          <dl className="meta-list">
            <dt>Email</dt>
            <dd>
              {person.email ?? <span className="muted">not recorded</span>}{' '}
              <Pill tone={person.email_evidence === 'confirmed' ? 'ok' : 'warn'}>{person.email_evidence ?? 'unknown'}</Pill>
            </dd>
            <dt>Contact rule</dt>
            <dd>
              <Pill tone={person.contact_rule === 'email_ok' ? 'ok' : person.contact_rule && person.contact_rule !== 'unknown' ? 'danger' : 'default'}>
                {(person.contact_rule ?? 'unknown').replace(/_/g, ' ')}
              </Pill>
            </dd>
            <dt>Time zone</dt>
            <dd>
              {person.timezone ? (
                <>
                  {person.timezone} <Pill>{(person.timezone_basis ?? 'unknown').replace(/_/g, ' ')}</Pill>
                  {person.timezone_basis === 'campus_inferred' ? (
                    <div className="dd-note">Inferred from the campus location. It does not say where the person is now.</div>
                  ) : null}
                </>
              ) : (
                /* With no zone recorded there is no basis to qualify, so one "unknown" says it. */
                <span className="muted">unknown</span>
              )}
            </dd>
            <dt>Research</dt>
            <dd>
              <Pill tone={person.research_complete ? 'ok' : data.readiness.researchHeld ? 'warn' : 'default'}>
                {person.research_complete ? 'complete' : data.readiness.researchHeld ? 'held by verification' : 'not started'}
              </Pill>
              {data.readiness.researchHeld ? (
                <div className="dd-note">The research ran. Verification withheld completeness until the blockers below are resolved.</div>
              ) : null}
            </dd>
          </dl>
          <div className="issue-block">
            <IssueList issues={data.readiness.issues} />
          </div>
        </Panel>

        <Panel title="Queue work for this person" hint="Queued tasks wait for a Claude Code session.">
          <div className="button-row">
            <button type="button" onClick={() => enqueue('4')} disabled={busy}>
              /map-person
            </button>
            <button type="button" onClick={() => enqueue('5')} disabled={busy}>
              /research-person
            </button>
            <button type="button" onClick={() => enqueue('7')} disabled={busy}>
              /draft-outreach
            </button>
          </div>
          <p className="small muted command-line">
            {nextCommand.command ? (
              <>
                {nextCommand.lead} <code>{nextCommand.command}</code>
                <CopyButton value={nextCommand.command} label="command" size="small" /> directly in Claude Code.
              </>
            ) : (
              nextCommand.lead
            )}
          </p>
          <DataTable
            caption="Tasks for this person"
            rows={data.tasks}
            rowKey={(task) => task.id}
            empty="No tasks yet."
            columns={[
              { key: 'job', header: 'Job', render: (task) => task.job_kind.replace(/_/g, ' ') },
              { key: 'state', header: 'State', render: (task) => <StateBadge state={task.state} /> },
              { key: 'reason', header: 'Note', render: (task) => task.blocked_reason ?? <span className="muted">—</span> },
            ]}
          />
        </Panel>
      </div>

      <Panel
        title="Research"
        actions={
          <div className="button-row" role="tablist" aria-label="Person sections">
            {TABS.map((name) => (
              <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
                {name}
              </button>
            ))}
          </div>
        }
      >
        {tab === 'profile' ? (
          data.profileNote ? (
            <div className="note-with-outline">
              <div id="profile-note">
                <p className="small muted mono">{data.profileNote.path}</p>
                <Markdown text={data.profileNote.text} />
              </div>
              <NoteOutline text={data.profileNote.text} containerId="profile-note" />
            </div>
          ) : (
            <Notice kind="warn">No profile note exists yet.</Notice>
          )
        ) : null}

        {tab === 'sources' ? (
          <>
            <DataTable
              caption="Mapped sources and what happened when they were fetched"
              rows={data.sources}
              rowKey={(source) => source.source_id}
              empty="No sources mapped. /map-person builds this map."
              columns={[
                { key: 'category', header: 'Category', render: (source) => source.source_category.replace(/_/g, ' ') },
                {
                  key: 'url',
                  header: 'URL',
                  render: (source) => (
                    <a href={source.url} rel="noreferrer noopener nofollow" target="_blank">
                      {source.title ?? source.url}
                    </a>
                  ),
                },
                { key: 'identity', header: 'Identity', render: (source) => <Pill>{source.identity_confidence}</Pill> },
                {
                  key: 'access',
                  header: 'Access',
                  render: (source) =>
                    source.access_status === 'needs_browser' ? (
                      <Pill tone="accent" title="Plain fetching returned no usable content. The browser can read this page.">
                        needs browser
                      </Pill>
                    ) : (
                      <Pill tone={source.access_status === 'accessible' ? 'ok' : 'warn'}>{source.access_status.replace(/_/g, ' ')}</Pill>
                    ),
                },
                {
                  key: 'method',
                  header: 'Fetched via',
                  render: (source) => (source.fetch_method && source.fetch_method !== 'none' ? source.fetch_method.replace(/_/g, ' ') : <span className="muted">—</span>),
                },
                {
                  key: 'investigated',
                  header: 'Investigated',
                  render: (source) => (source.investigated ? 'yes' : 'no'),
                },
              ]}
            />
            {data.sources.some((source) => source.access_status === 'needs_browser') ? (
              <CommandHint
                command={`/map-person ${person.entity_id} --retry-blocked`}
                note="Some pages returned no usable content to a plain fetch. Enable Claude in Chrome, keep Chrome open, then re-run the source map so the browser reads them."
              />
            ) : null}
            {data.sourceMapNote ? <Markdown text={data.sourceMapNote.text} /> : null}
          </>
        ) : null}

        {tab === 'publications' ? (
          <DataTable
            caption="One note per paper, shared between co-authors"
            rows={data.publications}
            rowKey={(publication) => publication.entity_id}
            empty="No publications recorded."
            columns={[
              { key: 'title', header: 'Title', render: (publication) => publication.title },
              { key: 'venue', header: 'Venue', render: (publication) => publication.venue ?? <span className="muted">—</span> },
              { key: 'date', header: 'Date', render: (publication) => publication.published_date ?? <span className="muted">—</span> },
              {
                key: 'access',
                header: 'Accessibility',
                render: (publication) => <Pill tone={publication.accessibility === 'accessible' ? 'ok' : 'warn'}>{publication.accessibility.replace(/_/g, ' ')}</Pill>,
              },
              {
                key: 'basis',
                header: 'Summary basis',
                render: (publication) => (
                  <Pill tone={publication.summary_basis === 'full_text' ? 'ok' : publication.summary_basis === 'abstract_only' ? 'warn' : 'default'}>
                    {publication.summary_basis.replace(/_/g, ' ')}
                  </Pill>
                ),
              },
              { key: 'doi', header: 'DOI', render: (publication) => <span className="mono small">{publication.doi ?? '—'}</span> },
            ]}
          />
        ) : null}

        {tab === 'relationships' ? (
          <DataTable
            rows={data.relationships}
            rowKey={(relationship) => `${relationship.rel_type}:${relationship.to_id}:${relationship.role}`}
            empty="No relationships recorded."
            columns={[
              { key: 'type', header: 'Relationship', render: (relationship) => relationship.rel_type.replace(/_/g, ' ') },
              {
                key: 'target',
                header: 'With',
                render: (relationship) =>
                  relationship.to_kind === 'person' ? (
                    <Link to={`/people/${relationship.to_id}`}>{relationship.to_title ?? relationship.to_id}</Link>
                  ) : relationship.to_kind === 'lab' ? (
                    <Link to={`/labs/${relationship.to_id}`}>{relationship.to_title ?? relationship.to_id}</Link>
                  ) : (
                    (relationship.to_title ?? relationship.to_id)
                  ),
              },
              { key: 'role', header: 'Role', render: (relationship) => relationship.role || <span className="muted">—</span> },
              { key: 'status', header: 'Status', render: (relationship) => <Pill>{relationship.status}</Pill> },
              { key: 'evidence', header: 'Evidence', render: (relationship) => <Pill>{relationship.evidence_status}</Pill> },
            ]}
          />
        ) : null}

        {tab === 'workflow' ? (
          <DataTable
            rows={data.tasks}
            rowKey={(task) => task.id}
            empty="No tasks."
            columns={[
              { key: 'id', header: 'Task', render: (task) => <span className="mono small">{task.id}</span> },
              { key: 'job', header: 'Job', render: (task) => task.job_kind },
              { key: 'state', header: 'State', render: (task) => <StateBadge state={task.state} /> },
              { key: 'updated', header: 'Updated', render: (task) => task.updated_at },
            ]}
          />
        ) : null}
      </Panel>
    </>
  );
}
