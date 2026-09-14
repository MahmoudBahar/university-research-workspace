import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  approveDraft,
  confirmSelection,
  createBackup,
  getScopeForUniversity,
  listTasks,
  markSent,
  openWorkspace,
  readDraft,
  restoreBackup,
  setSendPlan,
  startUniversityResearch,
  updateSelection,
  workspaceStatus,
} from '@urw/core';
import { makeWorkspace, runJob, seedApplicant, unitIdByName, personIdByName, programIdByTitle } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

describe('backup and restore', () => {
  test('a backup captures notes, relationships, revisions and workflow state', async (t) => {
    const { ws, cleanup, root } = await makeWorkspace();
    t.after(cleanup);
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
    const draftId = String(draft.summary['outreachId']);
    const content = readDraft(ws, draftId);
    approveDraft(ws, { outreachId: draftId, expectedFingerprint: content.fingerprint, actor: 'test' });
    setSendPlan(ws, { outreachId: draftId, date: '2026-09-15', time: '09:00', zone: 'America/Toronto', actor: 'test' });
    markSent(ws, { outreachId: draftId, idempotencyKey: 'backup-send', actor: 'test' });

    const before = workspaceStatus(ws);
    const relationshipsBefore = ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM relationships')?.n ?? 0;
    const tasksBefore = listTasks(ws, {}).length;
    const revisionsBefore = ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM note_revisions')?.n ?? 0;
    const profileText = readFileSync(join(ws.paths.vault, 'people', personId, 'profile.md'), 'utf8');

    const backup = await createBackup(ws, { label: 'test' });
    assert.ok(existsSync(join(backup.path, 'research.sqlite')));
    assert.ok(backup.manifest.contents.includes('vault'));
    assert.ok(backup.manifest.contents.includes('applicant'));
    assert.ok(backup.manifest.contents.includes('data/revisions'));
    assert.equal(backup.manifest.databaseSha256.length, 64);

    // Destroy the live workspace, then restore into it.
    ws.close();
    for (const target of ['data/research.sqlite', 'vault', 'applicant', 'data/revisions']) {
      rmSync(join(root, ...target.split('/')), { recursive: true, force: true });
    }
    const report = restoreBackup(root, backup.path, { force: true });
    assert.equal(report.databaseRestored, true);
    assert.ok(report.restored.includes('vault'));

    const restored = await openWorkspace({ root });
    t.after(() => restored.close());
    assert.equal(restored.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM relationships')?.n, relationshipsBefore);
    assert.equal(restored.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM note_revisions')?.n, revisionsBefore);
    assert.equal(readFileSync(join(restored.paths.vault, 'people', personId, 'profile.md'), 'utf8'), profileText);

    const after = workspaceStatus(restored);
    assert.equal(after.outreach.sent, before.outreach.sent);
    assert.deepEqual(
      after.jobs.map((job) => job.counts),
      before.jobs.map((job) => job.counts),
      'workflow state survives the round trip',
    );
    assert.equal(listTasks(restored, {}).length, tasksBefore, 'the task queue is restored intact');

    const plan = restored.db.get<{ utc_instant: string }>('SELECT utc_instant FROM send_plans WHERE outreach_id = ?', draftId);
    assert.equal(plan?.utc_instant, '2026-09-15T13:00:00Z', 'planned times keep their resolved instant');
    const sent = restored.db.get<{ was_approved: number }>('SELECT was_approved FROM sent_events WHERE outreach_id = ?', draftId);
    assert.equal(sent?.was_approved, 1);
  });

  test('restoring over an existing workspace requires force', async (t) => {
    const { ws, cleanup, root } = await makeWorkspace();
    t.after(cleanup);
    startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME });
    const backup = await createBackup(ws, { label: 'guard' });
    ws.close();

    assert.throws(
      () => restoreBackup(root, backup.path, {}),
      (error: unknown) => (error as { code?: string }).code === 'conflict',
    );
  });
});
