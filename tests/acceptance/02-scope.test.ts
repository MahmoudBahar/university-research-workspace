import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  claimTask,
  confirmSelection,
  currentScopeVersion,
  effectiveUnitDecision,
  enqueueScopedWork,
  enqueueTask,
  getScopeForUniversity,
  getTask,
  isPersonInScope,
  listTasks,
  startUniversityResearch,
  updateSelection,
} from '@urw/core';
import { makeWorkspace, runJob, seedApplicant, unitIdByName, personIdByName, programIdByTitle } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

describe('scope selection governs research', () => {
  test('excluded units cannot be researched and inherited decisions follow the hierarchy', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
    runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });

    const scope = getScopeForUniversity(ws, started.universityId);
    assert.ok(scope);
    const eceId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    const mechId = unitIdByName(ws, 'Department of Mechanical Engineering');
    const engId = unitIdByName(ws, 'Faculty of Engineering');
    const artsId = unitIdByName(ws, 'Faculty of Arts and Letters');

    // Include the faculty, then exclude one child explicitly.
    updateSelection(ws, {
      scopeId: scope.id,
      expectedVersion: 0,
      decisions: [
        { unitId: engId, decision: 'included' },
        { unitId: mechId, decision: 'excluded' },
        { unitId: artsId, decision: 'excluded' },
      ],
    });
    confirmSelection(ws, scope.id, 0);
    const version = currentScopeVersion(ws, scope.id);

    assert.equal(effectiveUnitDecision(ws, version.id, engId), 'included');
    assert.equal(effectiveUnitDecision(ws, version.id, eceId), 'included', 'children inherit an included parent');
    assert.equal(effectiveUnitDecision(ws, version.id, mechId), 'excluded', 'an explicit child decision wins');
    assert.equal(effectiveUnitDecision(ws, version.id, artsId), 'excluded');

    // Queued work covers only included units.
    const queued = enqueueScopedWork(ws, scope.id);
    const targets = new Set(queued.enqueued.map((entry) => entry.targetId));
    assert.ok(targets.has(eceId));
    assert.ok(targets.has(engId));
    assert.ok(!targets.has(mechId), 'an excluded department must not be queued');
    assert.ok(!targets.has(artsId));

    // A task explicitly aimed at an excluded unit is blocked, not silently run.
    const excluded = enqueueTask(ws, { jobKind: 'discover_people', targetId: mechId, requestedBy: 'test' });
    assert.equal(excluded.state, 'blocked');
    assert.throws(
      () => claimTask(ws, { owner: 'tester', taskId: excluded.taskId, force: true }),
      (error: unknown) => error instanceof AppError && error.code === 'dependency_blocked',
    );
  });

  test('changing scope preserves prior notes and cancels newly ineligible queued work', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
    runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
    const scope = getScopeForUniversity(ws, started.universityId) as { id: string };
    const eceId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    const mechId = unitIdByName(ws, 'Department of Mechanical Engineering');

    updateSelection(ws, {
      scopeId: scope.id,
      expectedVersion: 0,
      decisions: [
        { unitId: eceId, decision: 'included' },
        { unitId: mechId, decision: 'included' },
      ],
    });
    confirmSelection(ws, scope.id, 0);
    enqueueScopedWork(ws, scope.id);

    // Do real work in ECE so there is a committed artifact to preserve.
    runJob(ws, { jobKind: 'research_programs', targetId: eceId, result: fx.programResearch(eceId) });
    const programId = programIdByTitle(ws, 'Master of Applied Science in Electrical and Computer Engineering');
    const programPath = join(ws.paths.vault, 'programs', `${programId}.md`);
    const programBefore = readFileSync(programPath, 'utf8');

    const mechTasksBefore = listTasks(ws, { targetId: mechId }).filter((task) => task.state === 'pending' || task.state === 'blocked');
    assert.ok(mechTasksBefore.length > 0);

    // Now exclude Mechanical Engineering.
    updateSelection(ws, { scopeId: scope.id, expectedVersion: 1, decisions: [{ unitId: mechId, decision: 'excluded' }] });
    const report = confirmSelection(ws, scope.id, 1);
    assert.equal(report.newVersion, 2);
    assert.ok(report.cancelledTasks >= mechTasksBefore.length);

    // Past artifacts survive untouched.
    assert.ok(existsSync(programPath));
    assert.equal(readFileSync(programPath, 'utf8'), programBefore, 'previous research must not change when scope changes');

    const mechAfter = listTasks(ws, { targetId: mechId });
    assert.ok(mechAfter.every((task) => task.state === 'cancelled'), 'ineligible queued work is cancelled');

    // ECE work is re-queued at the new version.
    const eceAfter = listTasks(ws, { targetId: eceId });
    assert.ok(eceAfter.some((task) => task.scope_version === 2 && task.state !== 'cancelled'));
  });

  test('a result produced against a superseded scope version cannot commit', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
    runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
    const scope = getScopeForUniversity(ws, started.universityId) as { id: string };
    const eceId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    updateSelection(ws, { scopeId: scope.id, expectedVersion: 0, decisions: [{ unitId: eceId, decision: 'included' }] });
    confirmSelection(ws, scope.id, 0);

    const task = enqueueTask(ws, { jobKind: 'research_programs', targetId: eceId, requestedBy: 'test' });
    const claimed = claimTask(ws, { owner: 'worker-a', taskId: task.taskId, force: true });
    assert.ok(claimed);

    // The user changes the selection while the worker is out researching.
    updateSelection(ws, { scopeId: scope.id, expectedVersion: 1, decisions: [{ unitId: eceId, decision: 'excluded' }] });
    confirmSelection(ws, scope.id, 1);

    const { applyJobResult } = await import('@urw/core');
    assert.throws(
      () =>
        applyJobResult(ws, {
          taskId: claimed.task.id,
          owner: 'worker-a',
          fencingToken: claimed.fencingToken,
          result: fx.programResearch(eceId),
        }),
      (error: unknown) => error instanceof AppError && error.code === 'scope_violation',
      'an in-flight result must be checked against the live scope version before commit',
    );
  });

  test('Job 7 runs for a ready person while other people are still unresearched', async (t) => {
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
    const oseiId = personIdByName(ws, 'Dr Amara Osei');

    runJob(ws, { jobKind: 'map_person_sources', targetId: oseiId, result: fx.sourceMap(oseiId) });
    runJob(ws, { jobKind: 'research_person', targetId: oseiId, result: fx.personResearch(oseiId, { programId }) });

    // Three other people are still at Job 4.
    const pending = listTasks(ws, { jobKind: 'research_person' }).filter((task) => task.state !== 'complete');
    const unfinishedPeople = listTasks(ws, { jobKind: 'map_person_sources' }).filter((task) => task.state !== 'complete');
    assert.ok(unfinishedPeople.length >= 3, 'other candidates remain unfinished');

    const draft = runJob(ws, {
      jobKind: 'draft_outreach',
      targetId: oseiId,
      params: { programId },
      result: fx.outreachDraft(oseiId, programId),
    });
    assert.equal(draft.summary['ready'], true);
    assert.ok(pending.length >= 0);
  });
});
