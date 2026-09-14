import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '@urw/server/app';
import { ensureLocalSession } from '@urw/server/security';
import {
  confirmSelection,
  getScopeForUniversity,
  startUniversityResearch,
  updateSelection,
  type Workspace,
} from '@urw/core';
import { makeWorkspace, runJob, seedApplicant, unitIdByName, personIdByName, programIdByTitle } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

let ws: Workspace;
let cleanup: () => void;
let server: Server;
let baseUrl: string;
let token: string;
let context: { universityId: string; scopeId: string; eceId: string; personId: string; programId: string; draftId: string };

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      ...(init.headers ?? {}),
    },
  });
}

async function mutate(path: string, body: unknown): Promise<Response> {
  return api(path, { method: 'POST', body: JSON.stringify(body), headers: { 'x-urw-session': token } });
}

before(async () => {
  const made = await makeWorkspace();
  ws = made.ws;
  cleanup = made.cleanup;
  seedApplicant(ws);

  const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
  runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
  const scope = getScopeForUniversity(ws, started.universityId) as { id: string };
  const eceId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
  updateSelection(ws, { scopeId: scope.id, expectedVersion: 0, decisions: [{ unitId: eceId, decision: 'included' }] });
  confirmSelection(ws, scope.id, 0);
  runJob(ws, { jobKind: 'research_programs', targetId: eceId, result: fx.programResearch(eceId) });
  runJob(ws, { jobKind: 'discover_people', targetId: eceId, result: fx.peopleDiscovery(eceId) });
  const programId = programIdByTitle(ws, 'Master of Applied Science in Electrical and Computer Engineering');
  const personId = personIdByName(ws, 'Dr Amara Osei');
  runJob(ws, { jobKind: 'map_person_sources', targetId: personId, result: fx.sourceMap(personId) });
  runJob(ws, { jobKind: 'research_person', targetId: personId, result: fx.personResearch(personId, { programId }) });
  const draft = runJob(ws, {
    jobKind: 'draft_outreach',
    targetId: personId,
    params: { programId },
    result: fx.outreachDraft(personId, programId),
  });

  const session = ensureLocalSession(ws);
  token = session.token;
  const port = 5100 + Math.floor(Math.random() * 400);
  const app = createApp({ workspace: ws, session, port, serveWeb: false });
  await new Promise<void>((resolve) => {
    server = app.listen(port, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${port}`;
  context = {
    universityId: started.universityId,
    scopeId: scope.id,
    eceId,
    personId,
    programId,
    draftId: String(draft.summary['outreachId']),
  };
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  cleanup();
});

describe('local API', () => {
  test('bootstrap reports the execution model honestly', async () => {
    const response = await api('/api/bootstrap');
    assert.equal(response.status, 200);
    const body = (await response.json()) as { session: string; execution: { mode: string; note: string } };
    assert.equal(body.session, token);
    assert.equal(body.execution.mode, 'interactive_claude_code');
    assert.match(body.execution.note, /never starts one/);
  });

  test('a request with a foreign Host or Origin is refused', async () => {
    // fetch() will not let a caller set Host, so the Host guard is exercised
    // with a raw request the way a DNS-rebinding attempt would arrive.
    const { request } = await import('node:http');
    const port = Number(new URL(baseUrl).port);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/api/status', method: 'GET', setHost: false, headers: { Host: 'example.com' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);

    const badOrigin = await fetch(`${baseUrl}/api/status`, { headers: { Origin: 'https://evil.invalid' } });
    assert.equal(badOrigin.status, 403);
  });

  test('mutations require the local session token', async () => {
    const withoutToken = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ job: '3', targetId: context.eceId }) });
    assert.equal(withoutToken.status, 403);
    const withToken = await mutate('/api/tasks', { job: '3', targetId: context.eceId });
    assert.equal(withToken.status, 200);
  });

  test('a mutation with the token but no browser provenance is refused', async () => {
    // Neither an allowed Origin nor Sec-Fetch-Site: same-origin -> not from a page on this app.
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-urw-session': token },
      body: JSON.stringify({ job: '3', targetId: context.eceId }),
    });
    assert.equal(response.status, 403);
    const sameSite = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-urw-session': token, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ job: '3', targetId: context.eceId }),
    });
    assert.equal(sameSite.status, 200);
  });

  test('list endpoints accept a university filter and are unchanged without it', async () => {
    const all = (await (await api('/api/people')).json()) as { entity_id: string }[];
    const filtered = (await (await api(`/api/people?university=${context.universityId}`)).json()) as { entity_id: string }[];
    assert.ok(filtered.some((p) => p.entity_id === context.personId));
    assert.ok(filtered.length > 0 && filtered.length <= all.length, 'the filter narrows, never widens');
    const none = (await (await api('/api/people?university=university-9999')).json()) as unknown[];
    assert.equal(none.length, 0);

    const programs = (await (await api('/api/programs')).json()) as { id: string }[];
    const programsFiltered = (await (await api(`/api/programs?university=${context.universityId}`)).json()) as { id: string }[];
    assert.deepEqual(programsFiltered.map((p) => p.id), programs.map((p) => p.id));
    assert.equal(((await (await api('/api/programs?university=university-9999')).json()) as unknown[]).length, 0);

    const labs = (await (await api(`/api/labs?university=${context.universityId}`)).json()) as unknown[];
    assert.ok(Array.isArray(labs));
    assert.equal(((await (await api('/api/labs?university=university-9999')).json()) as unknown[]).length, 0);

    const tasks = (await (await api(`/api/tasks?university=${context.universityId}`)).json()) as { tasks: unknown[] };
    assert.ok(tasks.tasks.length > 0);
    const noTasks = (await (await api('/api/tasks?university=university-9999')).json()) as { tasks: unknown[] };
    assert.equal(noTasks.tasks.length, 0);

    const drafts = (await (await api(`/api/outreach?university=${context.universityId}`)).json()) as { id: string }[];
    assert.ok(drafts.some((d) => d.id === context.draftId));
    assert.equal(((await (await api('/api/outreach?university=university-9999')).json()) as unknown[]).length, 0);

    const plans = (await (await api(`/api/send-plans?university=${context.universityId}`)).json()) as { rows: { outreachId: string }[] };
    assert.ok(plans.rows.some((r) => r.outreachId === context.draftId));
    const relationships = (await (await api(`/api/relationships?university=${context.universityId}&limit=50`)).json()) as unknown[];
    assert.ok(relationships.length > 0);
    assert.equal(((await (await api('/api/relationships?university=university-9999')).json()) as unknown[]).length, 0);
    const duplicates = await api(`/api/duplicates?university=${context.universityId}`);
    assert.equal(duplicates.status, 200);
  });

  test('search finds people, programs, units and drafts, escapes wildcards and honours the university filter', async () => {
    const hit = (await (await api('/api/search?q=Osei')).json()) as { results: { kind: string; id: string; href: string; title: string }[]; truncated: boolean };
    const person = hit.results.find((r) => r.kind === 'person');
    assert.ok(person);
    assert.equal(person.id, context.personId);
    assert.equal(person.href, `/people/${context.personId}`);
    assert.equal(hit.results[0]?.kind, 'person', 'prefix matches rank first');

    const program = (await (await api('/api/search?q=Master%20of%20Applied')).json()) as { results: { kind: string; href: string }[] };
    assert.ok(program.results.some((r) => r.kind === 'program' && r.href.startsWith('/programs?open=')));
    const unit = (await (await api('/api/search?q=Mechanical')).json()) as { results: { kind: string; href: string }[] };
    assert.ok(unit.results.some((r) => r.kind === 'unit' && r.href.startsWith('/scope?unit=')));
    const draft = (await (await api(`/api/search?q=${context.draftId}`)).json()) as { results: { kind: string; id: string }[] };
    assert.ok(draft.results.some((r) => r.kind === 'draft' && r.id === context.draftId));

    // A literal percent sign is not a wildcard.
    const wildcard = (await (await api('/api/search?q=%25%25%25')).json()) as { results: unknown[] };
    assert.equal(wildcard.results.length, 0);
    const underscore = (await (await api('/api/search?q=___________')).json()) as { results: unknown[] };
    assert.equal(underscore.results.length, 0);

    const scoped = (await (await api('/api/search?q=Osei&university=university-9999')).json()) as { results: unknown[] };
    assert.equal(scoped.results.length, 0);
    const limited = (await (await api('/api/search?q=e&limit=2')).json()) as { results: unknown[]; truncated: boolean };
    assert.equal(limited.results.length, 2);
    assert.equal(limited.truncated, true);
    const empty = await api('/api/search?q=');
    assert.equal(empty.status, 400);
  });

  test('unit progress and draft revisions are readable', async () => {
    const progress = (await (await api(`/api/units/progress?university=${context.universityId}`)).json()) as {
      units: { unitId: string; tasks: { total: number; complete: number }; people: { total: number }; programs: number }[];
    };
    const ece = progress.units.find((u) => u.unitId === context.eceId);
    assert.ok(ece);
    assert.ok(ece.tasks.total > 0);
    assert.ok(ece.tasks.complete > 0);
    assert.ok(ece.people.total > 0);
    assert.equal(ece.programs, 1);

    const revision = (await (await api(`/api/outreach/${context.draftId}/revisions/1`)).json()) as { revision: number; body: string; recipient: string; fingerprint: string };
    assert.equal(revision.revision, 1);
    assert.ok(revision.body.length > 0);
    assert.equal(revision.fingerprint.length, 64);
    assert.equal((await api(`/api/outreach/${context.draftId}/revisions/99`)).status, 404);
  });

  test('extracted text can be handed in through the API with its provenance', async () => {
    const imported = await mutate('/api/documents', {
      kind: 'transcript',
      originalFilename: 'transcript.pdf',
      contentBase64: Buffer.from('%PDF-1.4 fictional', 'utf8').toString('base64'),
    });
    const doc = (await imported.json()) as { documentId: string; version: number };
    const attempt = (await (await mutate(`/api/documents/${doc.documentId}/extract`, {})).json()) as { status: string; detail: string };
    assert.equal(attempt.status, 'unavailable');
    assert.match(attempt.detail, /import-document/);

    const pasted = (await (
      await mutate(`/api/documents/${doc.documentId}/extract`, { text: 'Fictional transcript text', method: 'manual_paste', pageCount: 1 })
    ).json()) as { status: string; method: string; textPath: string };
    assert.equal(pasted.status, 'extracted');
    assert.equal(pasted.method, 'manual_paste');

    const unreadable = (await (
      await mutate(`/api/documents/${doc.documentId}/extract`, { status: 'unavailable', method: 'claude_read', detail: 'Image-only scan.' })
    ).json()) as { status: string; method: string; detail: string };
    assert.equal(unreadable.status, 'unavailable');
    assert.equal(unreadable.method, 'claude_read');
    assert.match(unreadable.detail, /Image-only/);

    const listing = (await (await api('/api/documents')).json()) as { documents: { id: string; versions: { extraction: { method: string } | null }[] }[] };
    const entry = listing.documents.find((d) => d.id === doc.documentId);
    assert.equal(entry?.versions[0]?.extraction?.method, 'claude_read', 'the latest extraction record is exposed');
  });

  test('the unit tree and scope selection round-trip through the API', async () => {
    const response = await api(`/api/units?university=${context.universityId}`);
    const body = (await response.json()) as { tree: { officialName: string }[]; scope: { currentVersion: number } };
    assert.ok(body.tree.length > 0);
    assert.equal(body.scope.currentVersion, 1);

    const mechId = unitIdByName(ws, 'Department of Mechanical Engineering');
    const put = await api(`/api/scopes/${context.scopeId}/selection`, {
      method: 'PUT',
      headers: { 'x-urw-session': token },
      body: JSON.stringify({ expectedVersion: 1, decisions: [{ unitId: mechId, decision: 'included' }] }),
    });
    assert.equal(put.status, 200);
    const confirm = await mutate(`/api/scopes/${context.scopeId}/confirm`, { expectedVersion: 1, enqueue: true });
    assert.equal(confirm.status, 200);
    const confirmed = (await confirm.json()) as { report: { newVersion: number }; enqueued: { includedUnits: number } };
    assert.equal(confirmed.report.newVersion, 2);
    assert.equal(confirmed.enqueued.includedUnits, 2);
  });

  test('a stale expected version is rejected rather than applied', async () => {
    const response = await api(`/api/scopes/${context.scopeId}/selection`, {
      method: 'PUT',
      headers: { 'x-urw-session': token },
      body: JSON.stringify({ expectedVersion: 0, decisions: [{ unitId: context.eceId, decision: 'excluded' }] }),
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, 'revision_conflict');
  });

  test('person detail exposes profile, sources, publications and readiness', async () => {
    const response = await api(`/api/people/${context.personId}`);
    const body = (await response.json()) as {
      person: { full_name: string };
      readiness: { emailReady: boolean };
      sources: unknown[];
      publications: unknown[];
      profileNote: { text: string };
    };
    assert.equal(body.person.full_name, 'Dr Amara Osei');
    assert.equal(body.readiness.emailReady, true);
    assert.equal(body.sources.length, 7);
    assert.equal(body.publications.length, 3);
    assert.match(body.profileNote.text, /Adaptive filtering/);
  });

  test('the queue exposes the exact skill command to run', async () => {
    const response = await api('/api/queue/commands');
    const body = (await response.json()) as { byJob: { command: string }[]; resumeCommand: string; note: string };
    assert.equal(body.resumeCommand, '/research-university --resume');
    assert.match(body.note, /nothing starts by itself/);
  });

  test('approval, planning and mark-sent flow through the API', async () => {
    const detail = (await (await api(`/api/outreach/${context.draftId}`)).json()) as {
      content: { fingerprint: string };
      outreach: { state: string };
    };
    assert.equal(detail.outreach.state, 'needs_review');

    const badApprove = await mutate(`/api/outreach/${context.draftId}/approve`, { fingerprint: 'a'.repeat(64) });
    assert.equal(badApprove.status, 409);

    const approve = await mutate(`/api/outreach/${context.draftId}/approve`, { fingerprint: detail.content.fingerprint });
    assert.equal(approve.status, 200);

    const plan = await api(`/api/outreach/${context.draftId}/send-plan`, {
      method: 'PUT',
      headers: { 'x-urw-session': token },
      body: JSON.stringify({ date: '2026-11-01', time: '01:30', zone: 'America/Toronto' }),
    });
    assert.equal(plan.status, 400, 'an ambiguous local time must be refused until an occurrence is chosen');
    const ambiguous = (await plan.json()) as { detail: { code: string } };
    assert.equal(ambiguous.detail.code, 'ambiguous_local_time');

    const goodPlan = await api(`/api/outreach/${context.draftId}/send-plan`, {
      method: 'PUT',
      headers: { 'x-urw-session': token },
      body: JSON.stringify({ date: '2026-11-02', time: '09:00', zone: 'America/Toronto' }),
    });
    assert.equal(goodPlan.status, 200);

    const sent = await mutate(`/api/outreach/${context.draftId}/mark-sent`, { idempotencyKey: 'api-send-001' });
    assert.equal(sent.status, 200);
    const again = await mutate(`/api/outreach/${context.draftId}/mark-sent`, { idempotencyKey: 'api-send-001' });
    const againBody = (await again.json()) as { duplicate: boolean };
    assert.equal(againBody.duplicate, true);
  });

  test('documents are imported by payload and served by registered id only', async () => {
    const imported = await mutate('/api/documents', {
      kind: 'cv',
      originalFilename: 'cv.txt',
      contentBase64: Buffer.from('A fictional CV body.', 'utf8').toString('base64'),
    });
    assert.equal(imported.status, 200);
    const body = (await imported.json()) as { documentId: string; version: number };

    const content = await api(`/api/documents/${body.documentId}/content?version=${body.version}`);
    assert.equal(content.status, 200);
    assert.equal(await content.text(), 'A fictional CV body.');

    const missing = await api('/api/documents/doc-9999/content');
    assert.equal(missing.status, 404);

    const traversal = await api('/api/documents/..%2F..%2Fetc%2Fpasswd/content');
    assert.ok([400, 404].includes(traversal.status), 'a path-shaped id must not resolve to a file');
  });

  test('an unportable filename is refused by the API', async () => {
    const response = await mutate('/api/documents', {
      kind: 'other',
      originalFilename: 'bad:name.pdf',
      contentBase64: Buffer.from('x', 'utf8').toString('base64'),
    });
    assert.equal(response.status, 400);
  });

  test('the change feed reports activity', async () => {
    const response = await api('/api/events?since=0&limit=10');
    const body = (await response.json()) as { events: { kind: string }[]; latest: number };
    assert.ok(body.latest > 0);
    assert.ok(body.events.length > 0);
  });

  test('maintenance operations run against the real core', async () => {
    const reconcile = await mutate('/api/maintenance/reconcile', {});
    assert.equal(reconcile.status, 200);
    const links = await mutate('/api/maintenance/check-links', {});
    const linkBody = (await links.json()) as { problems: { kind: string }[] };
    assert.equal(linkBody.problems.filter((problem) => problem.kind === 'broken').length, 0);
    const backup = await mutate('/api/maintenance/backup', { label: 'api-test' });
    assert.equal(backup.status, 200);
  });
});
