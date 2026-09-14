import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  claimTask,
  confirmSelection,
  evaluateEmailReadiness,
  getScopeForUniversity,
  latestEventSeq,
  migrationChecksum,
  openWorkspace,
  personSourceMap,
  reconcileVault,
  reclaimExpiredLeases,
  renewLease,
  SourceMapResult,
  sourcesNeedingBrowser,
  startUniversityResearch,
  updateSelection,
  MIGRATIONS,
} from '@urw/core';
import { makeWorkspace, runJob, seedApplicant, unitIdByName, personIdByName, programIdByTitle } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

async function researched(t: { after: (fn: () => void) => void }, config?: Record<string, unknown>) {
  const { ws, cleanup, root } = await makeWorkspace(config ? { config } : {});
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
  return { ws, root, universityId: started.universityId, eceId };
}

describe('maintenance: leases, migrations, reconcile cost, readiness, retrieval outcomes', () => {
  test('lease renewals are counted and capped by leases.maxRenewals', async (t) => {
    const { ws, cleanup } = await makeWorkspace({ config: { leases: { defaultSeconds: 60, maxRenewals: 2 } } });
    t.after(cleanup);
    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME });
    const claimed = claimTask(ws, { owner: 'worker-a', taskId: started.taskId, force: true });
    assert.ok(claimed);

    const first = renewLease(ws, claimed.task.id, 'worker-a', claimed.fencingToken);
    assert.equal(first.renewals, 1);
    assert.equal(first.maxRenewals, 2);
    const second = renewLease(ws, claimed.task.id, 'worker-a', claimed.fencingToken);
    assert.equal(second.renewals, 2);
    assert.throws(
      () => renewLease(ws, claimed.task.id, 'worker-a', claimed.fencingToken),
      (error: unknown) => error instanceof AppError && error.code === 'state_violation' && /maxRenewals/.test(error.message),
      'the third renewal is refused',
    );
    const run = ws.db.get<{ renewals: number }>('SELECT renewals FROM task_runs WHERE id = ?', claimed.runId);
    assert.equal(run?.renewals, 2);

    // Past the cap the worker lets the lease expire; the task comes back as partial and can be re-claimed.
    ws.db.run("UPDATE tasks SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", claimed.task.id);
    assert.equal(reclaimExpiredLeases(ws).reclaimed, 1);
    const again = claimTask(ws, { owner: 'worker-b', taskId: claimed.task.id, force: true });
    assert.ok(again);
    assert.equal(again.fencingToken, claimed.fencingToken + 1);
    const fresh = renewLease(ws, claimed.task.id, 'worker-b', again.fencingToken);
    assert.equal(fresh.renewals, 1, 'the counter belongs to the run, not the task');
  });

  test('applied migrations carry a checksum and an edited migration is reported, never re-run', async (t) => {
    const { ws, cleanup, root } = await makeWorkspace();
    const rows = ws.db.all<{ id: number; checksum: string | null }>('SELECT id, checksum FROM schema_migrations ORDER BY id');
    assert.equal(rows.length, MIGRATIONS.length);
    for (const row of rows) {
      const migration = MIGRATIONS.find((m) => m.id === row.id);
      assert.ok(migration);
      assert.equal(row.checksum, migrationChecksum(migration.sql));
    }
    ws.db.run("UPDATE schema_migrations SET checksum = 'tampered' WHERE id = 1");
    ws.close();

    const reopened = await openWorkspace({ root });
    t.after(() => {
      reopened.close();
      cleanup();
    });
    assert.equal(reopened.db.lastMigrationWarnings.length, 1);
    assert.match(reopened.db.lastMigrationWarnings[0] as string, /Migration 1 .* never re-run/);
    assert.equal(reopened.db.all('SELECT id FROM schema_migrations').length, MIGRATIONS.length, 'nothing was re-applied');
  });

  test('reconcile skips unchanged notes by size and mtime, still catches edits, and prunes old change-feed rows', async (t) => {
    const { ws, root } = await researched(t, { events: { retentionDays: 1 } });
    const first = reconcileVault(ws);
    assert.equal(first.added + first.updated, 0, 'committed notes are already indexed');
    assert.ok(first.skippedByStat > 0, 'steady state does not re-read every note');
    assert.equal(first.readinessRefreshed, ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM people')?.n);

    // A hand edit that keeps the byte count identical still changes the mtime, so it is picked up.
    const unitPath = join(root, 'vault', 'units');
    const { readdirSync } = await import('node:fs');
    const file = readdirSync(unitPath, { recursive: true, encoding: 'utf8' }).find((f) => f.endsWith('.md')) as string;
    const absolute = join(unitPath, file);
    const text = readFileSync(absolute, 'utf8');
    writeFileSync(absolute, `${text}\nA manual note.\n`);
    const later = new Date(Date.now() + 5000);
    utimesSync(absolute, later, later);
    const second = reconcileVault(ws);
    assert.equal(second.updated, 1);

    // A full pass re-hashes everything and finds nothing new.
    const full = reconcileVault(ws, { full: true });
    assert.equal(full.skippedByStat, 0);
    assert.equal(full.updated, 0);

    // Old non-audit events are pruned; audit mirrors survive.
    const oldSeq = latestEventSeq(ws.db);
    ws.db.run("UPDATE event_log SET at = '2000-01-01T00:00:00.000Z' WHERE seq <= ?", oldSeq);
    const auditBefore = ws.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_log WHERE kind LIKE 'audit:%'")?.n ?? 0;
    assert.ok(auditBefore > 0);
    const pruned = reconcileVault(ws);
    assert.ok(pruned.prunedEvents > 0);
    const auditAfter = ws.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_log WHERE kind LIKE 'audit:%'")?.n ?? 0;
    assert.equal(auditAfter, auditBefore, 'audit events are never pruned');
    const oldNonAudit = ws.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_log WHERE at < '2001-01-01' AND kind NOT LIKE 'audit:%'")?.n ?? 0;
    assert.equal(oldNonAudit, 0);
  });

  test('program facts with no recorded check date block approval instead of passing silently', async (t) => {
    const { ws } = await researched(t);
    const programId = programIdByTitle(ws, 'Master of Applied Science in Electrical and Computer Engineering');
    const personId = personIdByName(ws, 'Dr Amara Osei');
    runJob(ws, { jobKind: 'map_person_sources', targetId: personId, result: fx.sourceMap(personId) });
    runJob(ws, { jobKind: 'research_person', targetId: personId, result: fx.personResearch(personId, { programId }) });

    const before = evaluateEmailReadiness(ws, personId, { programId, stage: 'approve' });
    assert.ok(!before.issues.some((i) => i.code === 'program_facts_unrecorded'));

    ws.db.run("DELETE FROM claim_index WHERE claim_key = 'application_requirements'");
    const draftStage = evaluateEmailReadiness(ws, personId, { programId, stage: 'draft' });
    assert.equal(draftStage.issues.find((i) => i.code === 'program_facts_unrecorded')?.severity, 'warning');
    const approveStage = evaluateEmailReadiness(ws, personId, { programId, stage: 'approve' });
    assert.equal(approveStage.issues.find((i) => i.code === 'program_facts_unrecorded')?.severity, 'blocker');
    assert.equal(approveStage.emailReady, false);
  });

  test('a needs_browser outcome and its fetch method round-trip from the result schema into the registry', async (t) => {
    const { ws } = await researched(t);
    const personId = personIdByName(ws, 'Dr Amara Osei');
    const map = fx.sourceMap(personId);
    map.entries.push({
      url: 'https://scholar.google.com/citations?user=fictional-osei',
      category: 'scholar',
      discovery_source: 'Search',
      identity_confidence: 'uncertain',
      access_status: 'needs_browser',
      fetch_method: 'web_fetch',
      last_attempt_at: '2026-09-12',
      note: 'Plain fetch returned a JavaScript shell; a browser retrieval is needed.',
    });
    // The schema accepts it as-is (parse, do not cast).
    const parsed = SourceMapResult.parse(map);
    runJob(ws, { jobKind: 'map_person_sources', targetId: personId, result: parsed });

    const sources = personSourceMap(ws, personId) as { url: string; access_status: string; fetch_method: string; latest_fetch_method: string | null }[];
    const scholar = sources.find((s) => s.url.includes('scholar.google.com'));
    assert.ok(scholar);
    assert.equal(scholar.access_status, 'needs_browser');
    assert.equal(scholar.fetch_method, 'web_fetch');
    assert.equal(scholar.latest_fetch_method, 'web_fetch');

    const waiting = sourcesNeedingBrowser(ws, personId);
    const urls = waiting.map((w) => w.url);
    assert.ok(urls.some((u) => u.includes('scholar.google.com')));
    // The fixture's blocked Scholar profile is listed too; accessible sources are not.
    assert.ok(waiting.every((w) => ['needs_browser', 'blocked', 'captcha', 'rate_limited'].includes(w.access_status)));
    assert.ok(sourcesNeedingBrowser(ws).length >= waiting.length);
  });

  test('a source result that omits access_status is rejected rather than read as accessible', async (t) => {
    const { ws, universityId } = await researched(t);
    const result = fx.universityDiscovery() as unknown as { university: { sources: Record<string, unknown>[] } };
    delete result.university.sources[0]?.['access_status'];
    const { claimTask: claim, applyJobResult, retryTask, listTasks } = await import('@urw/core');
    const task = listTasks(ws, { jobKind: 'discover_university', targetId: universityId })[0];
    assert.ok(task);
    retryTask(ws, task.id);
    const claimed = claim(ws, { owner: 'w', taskId: task.id, force: true });
    assert.ok(claimed);
    assert.throws(
      () => applyJobResult(ws, { taskId: task.id, owner: 'w', fencingToken: claimed.fencingToken, result }),
      (error: unknown) => error instanceof AppError && error.code === 'invalid_input',
    );
  });
});
