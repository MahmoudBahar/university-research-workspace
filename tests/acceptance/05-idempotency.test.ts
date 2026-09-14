import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  claimTask,
  confirmSelection,
  enqueueTask,
  getScopeForUniversity,
  markSent,
  startUniversityResearch,
  updateSelection,
  approveDraft,
  readDraft,
  setSendPlan,
  sentHistory,
} from '@urw/core';
import { makeWorkspace, runJob, seedApplicant, unitIdByName, personIdByName, programIdByTitle } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

async function readyDraft(t: { after: (fn: () => void) => void }) {
  const { ws, cleanup } = await makeWorkspace();
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
  return { ws, personId, programId, eceId, draftId: String(draft.summary['outreachId']) };
}

describe('idempotency', () => {
  test('repeating an identical task request does not create a second unit of work', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);
    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME });

    const again = enqueueTask(ws, { jobKind: 'discover_university', targetId: started.universityId, requestedBy: 'test' });
    assert.equal(again.created, false);
    assert.equal(again.taskId, started.taskId);
    assert.equal(ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')?.n, 1);

    runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
    const unitsAfterFirst = ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academic_units')?.n;

    // Re-running the same job needs an explicit refresh, and must not duplicate records.
    const repeat = enqueueTask(ws, { jobKind: 'discover_university', targetId: started.universityId, requestedBy: 'test' });
    assert.equal(repeat.taskId, started.taskId);
    assert.equal(repeat.state, 'complete', 'a completed task is not silently re-opened by re-enqueueing');
    const { retryTask } = await import('@urw/core');
    retryTask(ws, repeat.taskId);
    const claimed = claimTask(ws, { owner: 'again', taskId: repeat.taskId, force: true });
    assert.ok(claimed);
    const { applyJobResult } = await import('@urw/core');
    applyJobResult(ws, { taskId: repeat.taskId, owner: 'again', fencingToken: claimed.fencingToken, result: fx.universityDiscovery() });
    assert.equal(ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academic_units')?.n, unitsAfterFirst);
  });

  test('marking sent twice with the same key records one event', async (t) => {
    const { ws, draftId } = await readyDraft(t);
    const content = readDraft(ws, draftId);
    approveDraft(ws, { outreachId: draftId, expectedFingerprint: content.fingerprint, actor: 'test' });

    const first = markSent(ws, { outreachId: draftId, idempotencyKey: 'send-key-1', actor: 'test' });
    assert.equal(first.duplicate, false);
    const second = markSent(ws, { outreachId: draftId, idempotencyKey: 'send-key-1', actor: 'test' });
    assert.equal(second.duplicate, true);
    assert.equal(second.event.id, first.event.id);
    assert.equal(sentHistory(ws, draftId).length, 1, 'double-clicking mark-sent records one send');
  });

  test('a passed planned time never sends or marks a message sent', async (t) => {
    const { ws, draftId } = await readyDraft(t);
    setSendPlan(ws, {
      outreachId: draftId,
      date: '2020-01-06',
      time: '09:00',
      zone: 'America/Toronto',
      actor: 'test',
    });
    const { sendPlanner, getOutreach } = await import('@urw/core');
    const rows = sendPlanner(ws);
    const row = rows.find((entry) => entry.outreachId === draftId);
    assert.equal(row?.due, 'overdue', 'a past plan is an overdue view');
    assert.equal(row?.sent, false);
    assert.notEqual(getOutreach(ws, draftId).state, 'sent', 'passing a planned time must not change state to sent');
    assert.equal(sentHistory(ws, draftId).length, 0);
  });

  test('an unapproved message cannot be marked sent without an explicit external-send report', async (t) => {
    const { ws, draftId } = await readyDraft(t);
    assert.throws(
      () => markSent(ws, { outreachId: draftId, idempotencyKey: 'k1', actor: 'test' }),
      (error: unknown) => error instanceof AppError && error.code === 'state_violation',
    );
    const recorded = markSent(ws, { outreachId: draftId, idempotencyKey: 'k1', allowUnapproved: true, actor: 'test' });
    assert.equal(recorded.event.was_approved, 0, 'the record keeps the fact that it was never approved');
    assert.equal(recorded.event.source, 'user_reported');
  });
});
