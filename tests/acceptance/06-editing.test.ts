import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  applyUserEdit,
  checkLinks,
  openIssues,
  readNoteFile,
  reconcileVault,
  startUniversityResearch,
  writeGeneratedNote,
  noteHistory,
} from '@urw/core';
import { makeWorkspace, runJob, unitIdByName } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

async function withDiscoveredVault(t: { after: (fn: () => void) => void }) {
  const { ws, cleanup } = await makeWorkspace();
  t.after(cleanup);
  const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
  runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
  return { ws, universityId: started.universityId };
}

describe('manual edits and conflicts', () => {
  test('hand-written notes are reconciled and recorded as user revisions', async (t) => {
    const { ws } = await withDiscoveredVault(t);
    const unitId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    const vaultPath = `units/${unitId}.md`;
    const absolute = join(ws.paths.vault, 'units', `${unitId}.md`);

    const before = readFileSync(absolute, 'utf8');
    writeFileSync(absolute, `${before}\nA note I typed by hand while reading the department page.\n`, 'utf8');

    const report = reconcileVault(ws);
    assert.equal(report.updated, 1);
    assert.equal(report.issues.length, 0);

    const history = noteHistory(ws, vaultPath);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.['source'], 'user');
  });

  test('regeneration preserves user text outside generated blocks', async (t) => {
    const { ws } = await withDiscoveredVault(t);
    const unitId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    const absolute = join(ws.paths.vault, 'units', `${unitId}.md`);

    const original = readFileSync(absolute, 'utf8');
    writeFileSync(absolute, `${original}\n### My own heading\n\nKeep this paragraph.\n`, 'utf8');
    reconcileVault(ws);

    // The same job runs again with fresh output.
    const refreshed = fx.universityDiscovery();
    const eceUnit = refreshed.units.find((unit) => unit.key === 'ece');
    if (eceUnit) eceUnit.overview = 'An updated overview from a later run.';
    const { retryTask, listTasks } = await import('@urw/core');
    const task = listTasks(ws, { jobKind: 'discover_university' })[0];
    retryTask(ws, task?.id as string);
    runJob(ws, {
      jobKind: 'discover_university',
      targetId: ws.db.get<{ entity_id: string }>('SELECT entity_id FROM universities LIMIT 1')?.entity_id as string,
      result: refreshed,
    });

    const after = readFileSync(absolute, 'utf8');
    assert.match(after, /Keep this paragraph\./, 'user text survives regeneration');
    assert.match(after, /An updated overview from a later run\./, 'generated blocks do update');
  });

  test('editing inside a generated block preserves the edit and raises an issue', async (t) => {
    const { ws } = await withDiscoveredVault(t);
    const unitId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    const absolute = join(ws.paths.vault, 'units', `${unitId}.md`);

    const original = readFileSync(absolute, 'utf8');
    const edited = original.replace('Signal processing', 'Signal processing (corrected by hand)');
    assert.notEqual(edited, original);
    writeFileSync(absolute, edited, 'utf8');

    const report = reconcileVault(ws);
    assert.ok(report.issues.some((issue) => issue.kind === 'protected_block_edited'));

    // A later regeneration must not discard the correction.
    const refreshed = fx.universityDiscovery();
    const { retryTask, listTasks } = await import('@urw/core');
    const task = listTasks(ws, { jobKind: 'discover_university' })[0];
    retryTask(ws, task?.id as string);
    runJob(ws, {
      jobKind: 'discover_university',
      targetId: ws.db.get<{ entity_id: string }>('SELECT entity_id FROM universities LIMIT 1')?.entity_id as string,
      result: refreshed,
    });
    assert.match(readFileSync(absolute, 'utf8'), /corrected by hand/);
    assert.ok(openIssues(ws).some((issue) => String(issue['kind']) === 'generated_section_preserved'));
  });

  test('a concurrent edit surfaces a conflict instead of overwriting', async (t) => {
    const { ws } = await withDiscoveredVault(t);
    const unitId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    const vaultPath = `units/${unitId}.md`;
    const note = readNoteFile(ws, vaultPath);

    // Another writer saves first.
    const absolute = join(ws.paths.vault, 'units', `${unitId}.md`);
    writeFileSync(absolute, `${note.text}\nSaved by another window.\n`, 'utf8');

    assert.throws(
      () => applyUserEdit(ws, { vaultPath, text: `${note.text}\nMy version.\n`, expectedSha: note.sha256, actor: 'test' }),
      (error: unknown) => error instanceof AppError && error.code === 'revision_conflict',
    );
    assert.match(readFileSync(absolute, 'utf8'), /Saved by another window\./);
  });

  test('the note id is protected: an edit that changes it is refused', async (t) => {
    const { ws } = await withDiscoveredVault(t);
    const unitId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    const vaultPath = `units/${unitId}.md`;
    const note = readNoteFile(ws, vaultPath);
    const tampered = note.text.replace(`id: ${unitId}`, 'id: unit-0999');

    assert.throws(
      () => applyUserEdit(ws, { vaultPath, text: tampered, expectedSha: note.sha256, actor: 'test' }),
      (error: unknown) => error instanceof AppError && error.code === 'conflict',
    );
  });

  test('invalid YAML frontmatter is reported without destroying the file', async (t) => {
    const { ws } = await withDiscoveredVault(t);
    const unitId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    const absolute = join(ws.paths.vault, 'units', `${unitId}.md`);
    const broken = readFileSync(absolute, 'utf8').replace('type: unit', 'type: [unit\n  bad: : :');
    writeFileSync(absolute, broken, 'utf8');

    const report = reconcileVault(ws);
    assert.ok(report.issues.some((issue) => issue.kind === 'invalid_frontmatter'));
    assert.equal(readFileSync(absolute, 'utf8'), broken, 'the bytes are preserved for repair');
  });

  test('links stay portable and duplicate display titles are reported', async (t) => {
    const { ws } = await withDiscoveredVault(t);
    const report = checkLinks(ws);
    assert.equal(report.problems.filter((problem) => problem.kind === 'broken').length, 0);
    assert.equal(report.caseCollisions.length, 0);

    // Two notes with the same display title are allowed but flagged.
    writeGeneratedNote(ws, {
      vaultPath: 'units/unit-copy.md',
      entityId: undefined,
      frontmatter: {
        id: 'unit-copy',
        type: 'unit',
        title: 'Department of Electrical and Computer Engineering',
        official_name: 'Department of Electrical and Computer Engineering',
        unit_type: 'department',
        university_id: 'university-0001',
      },
      sections: [{ id: 'overview', heading: 'Overview', content: 'A deliberate duplicate title.' }],
      source: 'core',
    });
    const second = checkLinks(ws);
    assert.ok(second.duplicateTitles.some((entry) => entry.title.includes('Electrical and Computer Engineering')));
  });
});
