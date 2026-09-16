import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  approveDraft,
  confirmSelection,
  findTaskForRevert,
  getScopeForUniversity,
  getTask,
  listFilesRecursive,
  listTasks,
  markSent,
  openIssues,
  prepareCommit,
  readDraft,
  reconcileVault,
  recoverCommits,
  revertTask,
  revisionStorePathFor,
  sha256Text,
  startUniversityResearch,
  updateSelection,
  vaultFilePath,
  type Workspace,
} from '@urw/core';
import { makeWorkspace, runJob, seedApplicant, unitIdByName, personIdByName, programIdByTitle } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

const ECE = 'Department of Electrical and Computer Engineering';
const MECH = 'Department of Mechanical Engineering';
const PROGRAM = 'Master of Applied Science in Electrical and Computer Engineering';

async function pipeline(t: { after: (fn: () => void) => void }, options: { people?: boolean; mech?: boolean } = {}) {
  const { ws, cleanup } = await makeWorkspace();
  t.after(cleanup);
  seedApplicant(ws);
  const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
  runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
  const scope = getScopeForUniversity(ws, started.universityId) as { id: string };
  const eceId = unitIdByName(ws, ECE);
  const mechId = unitIdByName(ws, MECH);
  updateSelection(ws, {
    scopeId: scope.id,
    expectedVersion: 0,
    decisions: [
      { unitId: eceId, decision: 'included' },
      ...(options.mech ? [{ unitId: mechId, decision: 'included' as const }] : []),
    ],
  });
  confirmSelection(ws, scope.id, 0);
  runJob(ws, { jobKind: 'research_programs', targetId: eceId, result: fx.programResearch(eceId) });
  const programId = programIdByTitle(ws, PROGRAM);
  if (options.people !== false) runJob(ws, { jobKind: 'discover_people', targetId: eceId, result: fx.peopleDiscovery(eceId) });
  return { ws, universityId: started.universityId, eceId, mechId, programId };
}

function count(ws: Workspace, sql: string, ...params: (string | number)[]): number {
  return ws.db.get<{ n: number }>(sql, ...params)?.n ?? 0;
}

function snapshot(ws: Workspace): string {
  const tables = ['entities', 'entity_aliases', 'programs', 'people', 'relationships', 'tasks', 'note_index', 'note_revisions', 'artifact_commits', 'person_sources', 'outreach'];
  const counts = tables.map((table) => `${table}=${count(ws, `SELECT COUNT(*) AS n FROM ${table}`)}`);
  const files = listFilesRecursive(ws.paths.vault, (p) => p.endsWith('.md'))
    .map((abs) => `${abs}:${sha256Text(readFileSync(abs, 'utf8'))}`)
    .sort();
  return [...counts, ...files].join('\n');
}

describe('reverting a finished job', () => {
  test('a program research job is undone and can run again', async (t) => {
    const { ws, eceId, programId } = await pipeline(t, { people: false });
    const task = findTaskForRevert(ws, 'research_programs', eceId);
    const tokenBefore = task.fencing_token;
    const notePath = join(ws.paths.vault, 'programs', `${programId}.md`);

    const dry = revertTask(ws, task.id, {});
    assert.equal(dry.applied, false);
    assert.equal(dry.plan.applicable, true);
    assert.deepEqual(dry.plan.order.map((s) => s.taskId), [task.id]);
    assert.deepEqual(dry.plan.order[0]?.files.map((f) => [f.action, f.path]), [['remove', vaultFilePath(`programs/${programId}.md`)]]);
    assert.deepEqual(dry.plan.order[0]?.entitiesDeleted.map((e) => e.id), [programId]);
    assert.ok(existsSync(notePath), 'a dry run changes nothing');

    const report = revertTask(ws, task.id, { apply: true });
    assert.equal(report.applied, true);
    assert.equal(existsSync(notePath), false);
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM programs'), 0);
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM entities WHERE id = ?', programId), 0);
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM entity_aliases WHERE entity_id = ?', programId), 0);
    assert.equal(count(ws, "SELECT COUNT(*) AS n FROM relationships WHERE rel_type = 'administers_program'"), 0);
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM note_index WHERE path = ?', vaultFilePath(`programs/${programId}.md`)), 0);
    const after = getTask(ws, task.id);
    assert.equal(after.state, 'pending');
    assert.ok(after.fencing_token > tokenBefore, 'a stale worker is fenced out');
    assert.equal(after.current_run_id, null);
    assert.equal(count(ws, "SELECT COUNT(*) AS n FROM artifact_commits WHERE task_id = ? AND state = 'reverted'", task.id), 1);
    assert.equal(count(ws, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'task.revert'"), 1);
    assert.equal(report.rerun, `/research-programs --unit ${eceId}`);

    // The revision store still holds the removed bytes.
    const originalManifest = JSON.parse(readFileSync(join(ws.paths.commits, report.plan.order[0]?.commits[0] as string, 'manifest.json'), 'utf8')) as { files: { sha256: string }[] };
    assert.ok(existsSync(revisionStorePathFor(ws, originalManifest.files[0]?.sha256 as string)));

    // Running the job again produces a fresh record and a clean reconcile.
    const rerun = runJob(ws, { jobKind: 'research_programs', targetId: eceId, result: fx.programResearch(eceId) });
    assert.equal(rerun.state, 'complete');
    const again = programIdByTitle(ws, PROGRAM);
    assert.notEqual(again, programId, 'identifiers are never reused');
    assert.ok(existsSync(join(ws.paths.vault, 'programs', `${again}.md`)));
    reconcileVault(ws);
    assert.deepEqual(openIssues(ws).filter((i) => i['kind'] === 'file_missing'), []);
  });

  test('people discovery with a completed dependent needs --cascade, then unwinds both', async (t) => {
    const { ws, eceId } = await pipeline(t);
    const oseiId = personIdByName(ws, 'Dr Amara Osei');
    const unitNote = join(ws.paths.vault, 'units', `${eceId}.md`);
    const unitBeforeJob3 = ws.db.get<{ sha256: string }>(
      'SELECT sha256 FROM note_revisions WHERE path = ? ORDER BY revision ASC LIMIT 1',
      vaultFilePath(`units/${eceId}.md`),
    )?.sha256;
    runJob(ws, { jobKind: 'map_person_sources', targetId: oseiId, result: fx.sourceMap(oseiId) });
    assert.ok(count(ws, 'SELECT COUNT(*) AS n FROM person_sources WHERE person_id = ?', oseiId) > 0);

    const job3 = findTaskForRevert(ws, 'discover_people', eceId);
    const job4 = findTaskForRevert(ws, 'map_person_sources', oseiId);
    const refused = revertTask(ws, job3.id, { apply: true });
    assert.equal(refused.applied, false);
    assert.deepEqual(refused.plan.dependentsNeedingCascade.map((d) => d.id), [job4.id]);
    assert.ok(existsSync(join(ws.paths.vault, 'people', oseiId, 'source-map.md')), 'nothing changed');

    const report = revertTask(ws, job3.id, { cascade: true, apply: true });
    assert.equal(report.applied, true, JSON.stringify(report.plan.blockers.concat(report.plan.conflicts as never)));
    assert.deepEqual(report.plan.order.map((s) => s.taskId), [job4.id, job3.id], 'the dependent goes first');
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM people'), 0);
    assert.equal(existsSync(join(ws.paths.vault, 'people', oseiId)), false, 'the record directory is gone');
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM person_sources'), 0);
    assert.equal(sha256Text(readFileSync(unitNote, 'utf8')), unitBeforeJob3, 'the unit note is back to its Job 1 bytes');
    assert.equal(listTasks(ws, { jobKind: 'map_person_sources' }).length, 0, 'queued and reverted mapping tasks are deleted');
    assert.equal(getTask(ws, job3.id).state, 'pending');
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM discovery_queue WHERE discovered_by = ?', job3.id), 0, 'its discoveries are withdrawn');
    reconcileVault(ws);
    assert.deepEqual(openIssues(ws).filter((i) => i['kind'] === 'file_missing'), []);
  });

  test('deep research on a person is undone without deleting the person or shared publications', async (t) => {
    const { ws, programId } = await pipeline(t);
    const oseiId = personIdByName(ws, 'Dr Amara Osei');
    const kaltsasId = personIdByName(ws, 'Dr Ruben Kaltsas');
    for (const personId of [oseiId, kaltsasId]) {
      runJob(ws, { jobKind: 'map_person_sources', targetId: personId, result: fx.sourceMap(personId) });
      runJob(ws, { jobKind: 'research_person', targetId: personId, result: fx.personResearch(personId, { programId }) });
    }
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM publications'), 3, 'the same papers are one record each');
    assert.equal(ws.db.get<{ research_complete: number }>('SELECT research_complete FROM people WHERE entity_id = ?', oseiId)?.research_complete, 1);

    const job5 = findTaskForRevert(ws, 'research_person', oseiId);
    const report = revertTask(ws, job5.id, { apply: true });
    assert.equal(report.applied, true, JSON.stringify({ blockers: report.plan.blockers, conflicts: report.plan.conflicts, cascade: report.plan.dependentsNeedingCascade }));

    const person = ws.db.get<{ research_complete: number; full_name: string; email: string | null }>('SELECT research_complete, full_name, email FROM people WHERE entity_id = ?', oseiId);
    assert.ok(person, 'the person record created by Job 3 survives');
    assert.equal(person.research_complete, 0);
    assert.equal(person.full_name, 'Dr Amara Osei');
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM publications'), 3, 'publications shared with another researched person survive');
    const step = report.plan.order.find((s) => s.taskId === job5.id);
    assert.ok(step?.entitiesKept.some((e) => e.kind === 'publication' && e.reason === 'shared'));
    const profile = readFileSync(join(ws.paths.vault, 'people', oseiId, 'profile.md'), 'utf8');
    assert.match(profile, /Job 5 has not run for this person yet/, 'the Job 3 stub is restored');
    assert.equal(getTask(ws, job5.id).state, 'pending');
    assert.equal(listTasks(ws, { jobKind: 'verify_person', targetId: oseiId }).length, 0, 'the verification it queued is gone');
    assert.equal(count(ws, "SELECT COUNT(*) AS n FROM relationships WHERE from_id = ? AND rel_type = 'authored'", oseiId), 0);
  });

  test('reverting one unit keeps a cross-appointed person and the other unit’s affiliation', async (t) => {
    const { ws, eceId, mechId } = await pipeline(t, { mech: true });
    const oseiId = personIdByName(ws, 'Dr Amara Osei');
    const crossListed = fx.peopleDiscovery(mechId);
    crossListed.people = [crossListed.people[0] as never];
    runJob(ws, { jobKind: 'discover_people', targetId: mechId, result: crossListed });
    assert.equal(count(ws, "SELECT COUNT(*) AS n FROM relationships WHERE from_id = ? AND rel_type = 'affiliated_with'", oseiId), 2);

    const report = revertTask(ws, findTaskForRevert(ws, 'discover_people', mechId).id, { cascade: true, apply: true });
    assert.equal(report.applied, true, JSON.stringify(report.plan.blockers));
    assert.ok(ws.db.get('SELECT entity_id FROM people WHERE entity_id = ?', oseiId), 'the person is kept');
    assert.deepEqual(
      ws.db.all<{ to_id: string }>("SELECT to_id FROM relationships WHERE from_id = ? AND rel_type = 'affiliated_with'", oseiId).map((r) => r.to_id),
      [eceId],
    );
    const unitAnchors = ws.db.all<{ anchor_value: string }>("SELECT anchor_value FROM entity_aliases WHERE entity_id = ? AND anchor_kind = 'name_in_unit'", oseiId);
    assert.equal(unitAnchors.length, 1);
    assert.match(unitAnchors[0]?.anchor_value ?? '', new RegExp(`^${eceId.replace(/-/g, ' ')}`));
    assert.ok(existsSync(join(ws.paths.vault, 'people', oseiId, 'profile.md')));
  });

  test('sent or approved outreach blocks a revert, even with --force', async (t) => {
    const { ws, eceId, programId } = await pipeline(t);
    const oseiId = personIdByName(ws, 'Dr Amara Osei');
    runJob(ws, { jobKind: 'map_person_sources', targetId: oseiId, result: fx.sourceMap(oseiId) });
    runJob(ws, { jobKind: 'research_person', targetId: oseiId, result: fx.personResearch(oseiId, { programId }) });
    const draft = runJob(ws, { jobKind: 'draft_outreach', targetId: oseiId, params: { programId }, result: fx.outreachDraft(oseiId, programId) });
    const draftId = String(draft.summary['outreachId']);
    const content = readDraft(ws, draftId);
    approveDraft(ws, { outreachId: draftId, expectedFingerprint: content.fingerprint, actor: 'test' });
    markSent(ws, { outreachId: draftId, idempotencyKey: 'sent-revert-1', actor: 'test' });

    const before = snapshot(ws);
    const report = revertTask(ws, findTaskForRevert(ws, 'discover_people', eceId).id, { cascade: true, force: true, apply: true });
    assert.equal(report.applied, false);
    assert.ok(report.plan.blockers.some((b) => b.code === 'outreach_history'), JSON.stringify(report.plan.blockers));
    assert.equal(snapshot(ws), before, 'nothing changed');
  });

  test('university discovery cannot be reverted once a selection is confirmed', async (t) => {
    const { ws, universityId } = await pipeline(t, { people: false });
    const report = revertTask(ws, findTaskForRevert(ws, 'discover_university', universityId).id, { cascade: true, apply: true });
    assert.equal(report.applied, false);
    assert.ok(report.plan.blockers.some((b) => b.code === 'scope_confirmed'));
  });

  test('a note edited by hand after the job is a conflict unless forced, and its bytes are kept', async (t) => {
    const { ws, eceId, programId } = await pipeline(t, { people: false });
    const notePath = join(ws.paths.vault, 'programs', `${programId}.md`);
    const edited = `${readFileSync(notePath, 'utf8')}\nMy own remark.\n`;
    writeFileSync(notePath, edited, 'utf8');
    reconcileVault(ws);
    const task = findTaskForRevert(ws, 'research_programs', eceId);

    const refused = revertTask(ws, task.id, { apply: true });
    assert.equal(refused.applied, false);
    assert.equal(refused.plan.applicable, false);
    assert.ok(refused.plan.conflicts.length > 0);
    assert.ok(existsSync(notePath));

    const forced = revertTask(ws, task.id, { apply: true, force: true });
    assert.equal(forced.applied, true);
    assert.equal(existsSync(notePath), false);
    assert.ok(existsSync(revisionStorePathFor(ws, sha256Text(edited))), 'the hand-edited bytes remain in the revision store');
  });

  test('a dry run changes nothing on disk or in the database', async (t) => {
    const { ws, eceId } = await pipeline(t);
    const oseiId = personIdByName(ws, 'Dr Amara Osei');
    runJob(ws, { jobKind: 'map_person_sources', targetId: oseiId, result: fx.sourceMap(oseiId) });
    const before = snapshot(ws);
    const report = revertTask(ws, findTaskForRevert(ws, 'discover_people', eceId).id, { cascade: true });
    assert.equal(report.applied, false);
    assert.equal(report.plan.applicable, true);
    assert.equal(snapshot(ws), before);
  });

  test('an interrupted removal is replayed by recovery', async (t) => {
    const { ws, programId } = await pipeline(t, { people: false });
    const path = vaultFilePath(`programs/${programId}.md`);
    const abs = join(ws.paths.root, path);
    const manifest = prepareCommit(ws, {
      lockKey: programId,
      description: 'interrupted revert',
      files: [{ path, content: '', remove: true, source: 'revert' }],
      dbOps: [{ kind: 'note.forget', payload: { path } }],
    });
    ws.db.run("UPDATE artifact_commits SET state = 'applying' WHERE id = ?", manifest.id);
    assert.ok(existsSync(abs));

    const recovery = recoverCommits(ws);
    assert.deepEqual(recovery.recovered, [manifest.id]);
    assert.equal(existsSync(abs), false);
    assert.equal(count(ws, 'SELECT COUNT(*) AS n FROM note_index WHERE path = ?', path), 0);
    assert.equal(recoverCommits(ws).recovered.length, 0, 'replay is idempotent');
  });
});
