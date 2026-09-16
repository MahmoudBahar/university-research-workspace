import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  confirmSelection,
  getScopeForUniversity,
  listDuplicateCandidates,
  normaliseUrl,
  prepareCommit,
  startUniversityResearch,
  updateSelection,
  vaultFilePath,
  type ProgramResearchResult,
  type Workspace,
} from '@urw/core';
import { makeWorkspace, runJob, unitIdByName } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

const LISTING = `https://www.${fx.UNIVERSITY_DOMAIN}/engineering/ece/graduate-programs`;

type Program = ProgramResearchResult['programs'][number];

function cloneProgram(unitId: string, title: string, sources: Program['sources']): Program {
  const template = fx.programResearch(unitId).programs[0] as Program;
  return { ...structuredClone(template), identity: { ...template.identity, official_title: title }, sources };
}

/** Three programs whose worker cited the same department listing page first. */
function sharedListingResult(unitId: string, titles: string[]): ProgramResearchResult {
  const result = fx.programResearch(unitId);
  result.programs = titles.map((title) =>
    cloneProgram(unitId, title, [
      { url: LISTING, category: 'program_page', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
      { url: `https://www.${fx.UNIVERSITY_DOMAIN}/calendar/2026/${title.toLowerCase().replace(/[^a-z]+/g, '-')}`, category: 'graduate_calendar', access_status: 'accessible', fetch_method: 'web_fetch' },
    ]),
  );
  return result;
}

async function includedUnit(t: { after: (fn: () => void) => void }, config?: Record<string, unknown>): Promise<{ ws: Workspace; eceId: string }> {
  const { ws, cleanup } = await makeWorkspace(config ? { config } : {});
  t.after(cleanup);
  const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
  runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
  const scope = getScopeForUniversity(ws, started.universityId) as { id: string };
  const eceId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
  updateSelection(ws, { scopeId: scope.id, expectedVersion: 0, decisions: [{ unitId: eceId, decision: 'included' }] });
  confirmSelection(ws, scope.id, 0);
  return { ws, eceId };
}

function programRows(ws: Workspace): { entity_id: string; official_title: string }[] {
  return ws.db.all('SELECT entity_id, official_title FROM programs ORDER BY entity_id');
}

describe('program identity', () => {
  test('programs sharing a department listing page stay separate records', async (t) => {
    const { ws, eceId } = await includedUnit(t);
    const titles = ['MASc in ECE', 'MASc in ECE - Aeronautics', 'MASc in ECE - Nanotechnology'];
    const job = runJob(ws, { jobKind: 'research_programs', targetId: eceId, result: sharedListingResult(eceId, titles) });

    assert.equal(job.summary['programsRecorded'], 3);
    const rows = programRows(ws);
    assert.deepEqual(rows.map((r) => r.official_title).sort(), [...titles].sort());
    for (const row of rows) {
      assert.ok(existsSync(join(ws.paths.vault, 'programs', `${row.entity_id}.md`)), `note missing for ${row.official_title}`);
    }
    const shared = job.summary['sharedSourcePages'] as { url: string; programs: string[] }[];
    assert.equal(shared.length, 1);
    assert.equal(shared[0]?.url, normaliseUrl(LISTING));
    assert.equal(shared[0]?.programs.length, 3);
    const listingOwners = ws.db.all("SELECT entity_id FROM entity_aliases WHERE anchor_kind = 'program_url' AND anchor_value = ?", normaliseUrl(LISTING));
    assert.equal(listingOwners.length, 0, 'a shared page identifies nobody');
    const calendarOwners = ws.db.all("SELECT entity_id FROM entity_aliases WHERE anchor_kind = 'program_url'");
    assert.equal(calendarOwners.length, 3, 'each program keeps its own calendar entry as identity');
  });

  test('re-running the same result resolves to the same records', async (t) => {
    const { ws, eceId } = await includedUnit(t);
    const titles = ['MASc in ECE', 'MASc in ECE - Aeronautics'];
    runJob(ws, { jobKind: 'research_programs', targetId: eceId, result: sharedListingResult(eceId, titles) });
    const before = programRows(ws);
    runJob(ws, { jobKind: 'research_programs', targetId: eceId, params: { attempt: 2 }, result: sharedListingResult(eceId, titles) });
    assert.deepEqual(programRows(ws), before);
  });

  test('a page already owned by a differently titled program is contested, never merged', async (t) => {
    const { ws, eceId } = await includedUnit(t);
    const own = `https://www.${fx.UNIVERSITY_DOMAIN}/engineering/ece/masc`;
    const first = fx.programResearch(eceId);
    first.programs = [cloneProgram(eceId, 'MASc in ECE', [{ url: own, category: 'program_page', access_status: 'accessible', fetch_method: 'web_fetch' }])];
    runJob(ws, { jobKind: 'research_programs', targetId: eceId, result: first });
    const [original] = programRows(ws);

    const second = fx.programResearch(eceId);
    second.programs = [cloneProgram(eceId, 'MASc in ECE - Quantum Information', [{ url: own, category: 'program_page', access_status: 'accessible', fetch_method: 'web_fetch' }])];
    const job = runJob(ws, { jobKind: 'research_programs', targetId: eceId, params: { attempt: 2 }, result: second });

    const rows = programRows(ws);
    assert.equal(rows.length, 2, 'the second program gets its own record');
    assert.equal(rows.find((r) => r.entity_id === original?.entity_id)?.official_title, 'MASc in ECE', 'the owner keeps its title');
    const contested = job.summary['contestedProgramUrls'] as { url: string; ownedBy: string }[];
    assert.equal(contested.length, 1);
    assert.equal(contested[0]?.ownedBy, original?.entity_id);
    const candidates = listDuplicateCandidates(ws).filter((c) => c['reason'] === 'shared_program_url');
    assert.equal(candidates.length, 1, 'the contested page is flagged for review');
  });

  test('two programs with the same title in one result are rejected', async (t) => {
    const { ws, eceId } = await includedUnit(t);
    const result = sharedListingResult(eceId, ['MASc in ECE', 'MASc in ECE']);
    assert.throws(
      () => runJob(ws, { jobKind: 'research_programs', targetId: eceId, result }),
      (error: unknown) => error instanceof AppError && error.code === 'invalid_input' && /resolve to/.test(error.message),
    );
    assert.equal(programRows(ws).length, 0, 'nothing was committed');
    assert.equal(existsSync(join(ws.paths.vault, 'programs', 'program-0001.md')), false);
  });

  test('a commit never stages the same path twice', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);
    const path = vaultFilePath('programs/program-9999.md');
    assert.throws(
      () =>
        prepareCommit(ws, {
          lockKey: 'program-9999',
          description: 'duplicate path',
          files: [
            { path, content: 'first', expectedPrior: null },
            { path, content: 'second', expectedPrior: null },
          ],
        }),
      (error: unknown) => error instanceof AppError && error.code === 'invalid_input' && /more than once/.test(error.message),
    );
  });
});

describe('degree scope', () => {
  function mmathResult(unitId: string): ProgramResearchResult {
    const result = fx.programResearch(unitId);
    const program = cloneProgram(unitId, 'Master of Mathematics in Computer Science', [
      { url: `https://www.${fx.UNIVERSITY_DOMAIN}/math/cs/mmath`, category: 'program_page', access_status: 'accessible', fetch_method: 'web_fetch' },
    ]);
    program.identity.award = 'MMath';
    program.identity.degree_family = 'MMath';
    result.programs = [program];
    return result;
  }

  test('an MMath program is excluded when only MASc is primary', async (t) => {
    const { ws, eceId } = await includedUnit(t, { degreeScope: { primary: ['MASc'] } });
    const job = runJob(ws, { jobKind: 'research_programs', targetId: eceId, result: mmathResult(eceId) });
    assert.equal(job.summary['programsRecorded'], 0);
    assert.equal((job.summary['excludedByDegreeScope'] as string[]).length, 1);
    assert.equal(programRows(ws).length, 0);
  });

  test('an MMath program is recorded when MMath is a primary degree, whatever its spelling', async (t) => {
    const { ws, eceId } = await includedUnit(t, { degreeScope: { primary: ['MASc', 'MMath'] } });
    const result = mmathResult(eceId);
    (result.programs[0] as Program).identity.degree_family = 'mmath';
    const job = runJob(ws, { jobKind: 'research_programs', targetId: eceId, result });
    assert.equal(job.summary['programsRecorded'], 1);
    assert.deepEqual(job.summary['excludedByDegreeScope'], []);
    assert.equal(programRows(ws)[0]?.official_title, 'Master of Mathematics in Computer Science');
  });
});
