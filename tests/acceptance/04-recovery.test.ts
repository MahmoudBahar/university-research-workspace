import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  applyCommit,
  applyJobResult,
  claimTask,
  enqueueTask,
  getTask,
  listCheckpoints,
  prepareCommit,
  reclaimExpiredLeases,
  recoverCommits,
  saveCheckpoint,
  startUniversityResearch,
  vaultFilePath,
} from '@urw/core';
import { makeWorkspace, runJob } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

describe('interruption recovery and fencing', () => {
  test('checkpoints survive a lost worker and the task resumes', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME });
    const claimed = claimTask(ws, { owner: 'worker-a', jobKind: 'discover_university', force: true });
    assert.ok(claimed);

    saveCheckpoint(ws, {
      taskId: claimed.task.id,
      owner: 'worker-a',
      fencingToken: claimed.fencingToken,
      kind: 'source',
      label: 'faculty listing page 1',
      payload: { unitsSoFar: 2 },
    });
    saveCheckpoint(ws, {
      taskId: claimed.task.id,
      owner: 'worker-a',
      fencingToken: claimed.fencingToken,
      kind: 'source',
      label: 'faculty listing page 2',
      payload: { unitsSoFar: 5 },
    });

    // The worker dies. Its lease expires and the task is reclaimed.
    ws.db.run("UPDATE tasks SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", claimed.task.id);
    const reclaimed = reclaimExpiredLeases(ws);
    assert.equal(reclaimed.reclaimed, 1);
    assert.equal(getTask(ws, claimed.task.id).state, 'partial');

    const checkpoints = listCheckpoints(ws, claimed.task.id);
    assert.equal(checkpoints.length, 2, 'checkpoints outlive the run that wrote them');
    assert.equal(JSON.parse(String(checkpoints[1]?.['payload_json'])).unitsSoFar, 5);

    // A fresh owner picks the task up with a new fencing token.
    const second = claimTask(ws, { owner: 'worker-b', taskId: claimed.task.id, force: true });
    assert.ok(second);
    assert.equal(second.fencingToken, claimed.fencingToken + 1);
    assert.equal(listCheckpoints(ws, claimed.task.id).length, 2, 'the new run can read the old checkpoints');
    assert.ok(started.taskId);
  });

  test('a late result from a superseded owner is rejected', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME });
    const first = claimTask(ws, { owner: 'worker-a', taskId: started.taskId, force: true });
    assert.ok(first);
    ws.db.run("UPDATE tasks SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", first.task.id);
    reclaimExpiredLeases(ws);
    const second = claimTask(ws, { owner: 'worker-b', taskId: first.task.id, force: true });
    assert.ok(second);

    assert.throws(
      () =>
        applyJobResult(ws, {
          taskId: first.task.id,
          owner: 'worker-a',
          fencingToken: first.fencingToken,
          result: fx.universityDiscovery(),
        }),
      (error: unknown) => error instanceof AppError && error.code === 'fencing_rejected',
      'the old owner cannot commit after the task was reclaimed',
    );

    // The current owner still can.
    const applied = applyJobResult(ws, {
      taskId: first.task.id,
      owner: 'worker-b',
      fencingToken: second.fencingToken,
      result: fx.universityDiscovery(),
    });
    assert.equal(applied.state, 'complete');
  });

  test('a crash between file installation and database finalisation is replayed idempotently', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const targetVaultPath = 'units/unit-9999.md';
    const content = `---
schema_version: 1
id: unit-9999
type: unit
title: Recovery Test Unit
official_name: Recovery Test Unit
unit_type: department
university_id: university-9999
revision: 1
---

## Overview

Written by a commit that is interrupted on purpose.
`;
    ws.db.run(
      "INSERT INTO entities (id, kind, canonical_path, display_title, identity_confidence, created_at, updated_at) VALUES ('unit-9999','unit',?,'Recovery Test Unit','probable',datetime('now'),datetime('now'))",
      targetVaultPath,
    );

    const manifest = prepareCommit(ws, {
      lockKey: 'unit-9999',
      description: 'interrupted commit',
      entityId: 'unit-9999',
      files: [{ path: vaultFilePath(targetVaultPath), content, expectedPrior: null, source: 'worker' }],
      dbOps: [
        {
          kind: 'note.revision',
          payload: {
            path: vaultFilePath(targetVaultPath),
            entityId: 'unit-9999',
            noteType: 'unit',
            title: 'Recovery Test Unit',
            schemaVersion: 1,
            sha256: 'placeholder',
            size: content.length,
            source: 'worker',
            frontmatter: {},
            protectedBlocks: {},
          },
        },
      ],
    });

    // Simulate the crash: install the file and mark the commit applying, but do
    // not finalise the database.
    const absolute = join(ws.paths.root, 'vault', 'units', 'unit-9999.md');
    writeFileSync(absolute, content, 'utf8');
    ws.db.run("UPDATE artifact_commits SET state = 'applying' WHERE id = ?", manifest.id);
    assert.equal(ws.db.get('SELECT path FROM note_index WHERE path = ?', vaultFilePath(targetVaultPath)), undefined);

    const recovery = recoverCommits(ws);
    assert.deepEqual(recovery.recovered, [manifest.id]);
    assert.ok(existsSync(absolute));
    assert.ok(ws.db.get('SELECT path FROM note_index WHERE path = ?', vaultFilePath(targetVaultPath)), 'the index is finalised on replay');
    const revisions = ws.db.all('SELECT id FROM note_revisions WHERE path = ?', vaultFilePath(targetVaultPath));
    assert.equal(revisions.length, 1);

    // Replaying again changes nothing.
    const second = recoverCommits(ws);
    assert.equal(second.recovered.length, 0);
    applyCommit(ws, manifest.id);
    assert.equal(ws.db.all('SELECT id FROM note_revisions WHERE path = ?', vaultFilePath(targetVaultPath)).length, 1);
    assert.equal(readFileSync(absolute, 'utf8'), content);
  });

  test('an external edit during recovery is preserved instead of overwritten', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const vaultPath = 'units/unit-8888.md';
    const original = '---\nschema_version: 1\nid: unit-8888\ntype: unit\ntitle: Conflict Unit\nofficial_name: Conflict Unit\nunit_type: department\nuniversity_id: university-1\nrevision: 1\n---\n\n## Overview\n\nWorker text.\n';
    const manifest = prepareCommit(ws, {
      lockKey: 'unit-8888',
      description: 'commit that will conflict',
      files: [{ path: vaultFilePath(vaultPath), content: original, expectedPrior: null, source: 'worker' }],
      dbOps: [],
    });

    // Someone writes different bytes to the same path before recovery runs.
    const absolute = join(ws.paths.root, 'vault', 'units', 'unit-8888.md');
    const mine = '---\nschema_version: 1\nid: unit-8888\ntype: unit\ntitle: Conflict Unit\nofficial_name: Conflict Unit\nunit_type: department\nuniversity_id: university-1\nrevision: 1\n---\n\n## Overview\n\nMy own text that must survive.\n';
    writeFileSync(absolute, mine, 'utf8');

    const report = recoverCommits(ws);
    assert.equal(report.conflicts.length, 1);
    assert.equal(readFileSync(absolute, 'utf8'), mine, 'existing bytes are never replaced on conflict');
    const row = ws.db.get<{ state: string; conflict_detail: string }>('SELECT state, conflict_detail FROM artifact_commits WHERE id = ?', manifest.id);
    assert.equal(row?.state, 'conflict');
    assert.match(String(row?.conflict_detail), /file_changed_outside_commit/);
  });

  test('a manifest written before its database row is still recovered', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const vaultPath = 'units/unit-7777.md';
    const content = '---\nschema_version: 1\nid: unit-7777\ntype: unit\ntitle: Orphan Unit\nofficial_name: Orphan Unit\nunit_type: department\nuniversity_id: university-1\nrevision: 1\n---\n\n## Overview\n\nOrphan manifest.\n';
    const manifest = prepareCommit(ws, {
      lockKey: 'unit-7777',
      description: 'orphan manifest',
      files: [{ path: vaultFilePath(vaultPath), content, expectedPrior: null, source: 'worker' }],
      dbOps: [],
    });
    // Lose the row, keep the durable manifest on disk.
    ws.db.run('DELETE FROM artifact_commits WHERE id = ?', manifest.id);

    const report = recoverCommits(ws);
    assert.deepEqual(report.recovered, [manifest.id]);
    assert.ok(existsSync(join(ws.paths.root, 'vault', 'units', 'unit-7777.md')));
  });
});
