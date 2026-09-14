import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  approveDraft,
  correctSentRecord,
  createDraft,
  currentApproval,
  getOutreach,
  importDocument,
  markSent,
  readDraft,
  reconcileDraft,
  sentHistory,
  sentSnapshotText,
  updateDraft,
  validateDraftPackage,
  confirmSelection,
  getScopeForUniversity,
  startUniversityResearch,
  updateSelection,
} from '@urw/core';
import { makeWorkspace, runJob, seedApplicant, unitIdByName, personIdByName, programIdByTitle } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

async function readyDraft(t: { after: (fn: () => void) => void }, options: { attachments?: { document_id: string; version?: number }[] } = {}) {
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
    result: fx.outreachDraft(personId, programId, options),
  });
  return { ws, personId, programId, draftId: String(draft.summary['outreachId']) };
}

describe('approval binds exact content', () => {
  test('editing the body after approval returns the draft to review', async (t) => {
    const { ws, draftId } = await readyDraft(t);
    const content = readDraft(ws, draftId);
    approveDraft(ws, { outreachId: draftId, expectedFingerprint: content.fingerprint, actor: 'test' });
    assert.equal(getOutreach(ws, draftId).state, 'approved');

    const note = readDraft(ws, draftId);
    const file = join(ws.paths.vault, 'outreach', draftId, 'draft.md');
    const sha = (await import('@urw/core')).sha256Text(readFileSync(file, 'utf8'));
    updateDraft(ws, { outreachId: draftId, expectedSha: sha, body: `${note.body}\n\nOne more sentence.`, actor: 'test' });

    assert.equal(getOutreach(ws, draftId).state, 'needs_review');
    assert.equal(currentApproval(ws, draftId), undefined, 'the approval no longer stands');
  });

  test('changing the recipient or subject invalidates approval', async (t) => {
    for (const change of ['recipient', 'subject'] as const) {
      const { ws, draftId } = await readyDraft(t);
      const content = readDraft(ws, draftId);
      approveDraft(ws, { outreachId: draftId, expectedFingerprint: content.fingerprint, actor: 'test' });
      const file = join(ws.paths.vault, 'outreach', draftId, 'draft.md');
      const sha = (await import('@urw/core')).sha256Text(readFileSync(file, 'utf8'));
      updateDraft(ws, {
        outreachId: draftId,
        expectedSha: sha,
        ...(change === 'recipient' ? { recipient: 'someone.else@northvale.invalid' } : { subject: 'A different subject' }),
        actor: 'test',
      });
      assert.equal(getOutreach(ws, draftId).state, 'needs_review', `${change} change must require review again`);
    }
  });

  test('changing an attachment version invalidates approval', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);
    seedApplicant(ws);
    const imported = importDocument(ws, {
      kind: 'cv',
      originalFilename: 'cv.txt',
      content: Buffer.from('Version one of a fictional CV.', 'utf8'),
      actor: 'test',
    });

    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
    runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
    const scope = getScopeForUniversity(ws, started.universityId) as { id: string };
    const eceId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    updateSelection(ws, { scopeId: scope.id, expectedVersion: 0, decisions: [{ unitId: eceId, decision: 'included' }] });
    confirmSelection(ws, scope.id, 0);
    runJob(ws, { jobKind: 'discover_people', targetId: eceId, result: fx.peopleDiscovery(eceId) });
    const personId = personIdByName(ws, 'Dr Amara Osei');
    runJob(ws, { jobKind: 'map_person_sources', targetId: personId, result: fx.sourceMap(personId) });
    runJob(ws, { jobKind: 'research_person', targetId: personId, result: fx.personResearch(personId) });

    const created = createDraft(ws, {
      personId,
      purpose: 'initial_contact',
      recipient: 'a.osei@northvale.invalid',
      subject: 'MASc enquiry — adaptive array processing',
      body: 'A body long enough to pass the minimum length validation for a draft package.',
      attachments: [{ document_id: imported.documentId, version: imported.version, filename: '', sha256: '' }],
      briefMarkdown: 'Brief.',
      actor: 'test',
    });
    validateDraftPackage(ws, created.outreachId);
    const content = readDraft(ws, created.outreachId);
    assert.equal(content.attachments[0]?.sha256, imported.sha256);
    approveDraft(ws, { outreachId: created.outreachId, expectedFingerprint: content.fingerprint, actor: 'test' });

    // Replace the document bytes: the attachment fingerprint no longer matches.
    const replaced = importDocument(ws, {
      kind: 'cv',
      originalFilename: 'cv.txt',
      content: Buffer.from('Version two of a fictional CV with different content.', 'utf8'),
      documentId: imported.documentId,
      actor: 'test',
    });
    const file = join(ws.paths.vault, 'outreach', created.outreachId, 'draft.md');
    const sha = (await import('@urw/core')).sha256Text(readFileSync(file, 'utf8'));
    updateDraft(ws, {
      outreachId: created.outreachId,
      expectedSha: sha,
      attachments: [{ document_id: imported.documentId, version: replaced.version }],
      actor: 'test',
    });
    assert.equal(getOutreach(ws, created.outreachId).state, 'needs_review');
  });

  test('approving a fingerprint that is no longer current is refused', async (t) => {
    const { ws, draftId } = await readyDraft(t);
    const stale = readDraft(ws, draftId).fingerprint;
    const file = join(ws.paths.vault, 'outreach', draftId, 'draft.md');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('Dear Dr Osei,', 'Dear Professor Osei,'), 'utf8');

    assert.throws(
      () => approveDraft(ws, { outreachId: draftId, expectedFingerprint: stale, actor: 'test' }),
      (error: unknown) => error instanceof AppError && error.code === 'revision_conflict',
      'the file is re-read and re-fingerprinted immediately before approval',
    );
  });

  test('sent snapshots stay historical after later edits', async (t) => {
    const { ws, draftId } = await readyDraft(t);
    const content = readDraft(ws, draftId);
    approveDraft(ws, { outreachId: draftId, expectedFingerprint: content.fingerprint, actor: 'test' });
    const sent = markSent(ws, { outreachId: draftId, idempotencyKey: 'sent-1', actor: 'test' });
    const snapshot = sentSnapshotText(ws, sent.event.id);
    assert.match(snapshot, /adaptive array processing/);

    // A sent message cannot be edited through the core.
    const file = join(ws.paths.vault, 'outreach', draftId, 'draft.md');
    const sha = (await import('@urw/core')).sha256Text(readFileSync(file, 'utf8'));
    assert.throws(
      () => updateDraft(ws, { outreachId: draftId, expectedSha: sha, subject: 'Changed after sending', actor: 'test' }),
      (error: unknown) => error instanceof AppError && error.code === 'state_violation',
    );

    // Even an out-of-band file edit leaves the snapshot untouched.
    writeFileSync(file, readFileSync(file, 'utf8').replace('MASc enquiry', 'Something else entirely'), 'utf8');
    reconcileDraft(ws, draftId);
    assert.equal(sentSnapshotText(ws, sent.event.id), snapshot);
    assert.equal(sentHistory(ws, draftId)[0]?.['subject'], content.subject);
  });

  test('corrections append events rather than rewriting history', async (t) => {
    const { ws, draftId } = await readyDraft(t);
    const content = readDraft(ws, draftId);
    approveDraft(ws, { outreachId: draftId, expectedFingerprint: content.fingerprint, actor: 'test' });
    const sent = markSent(ws, { outreachId: draftId, idempotencyKey: 'sent-2', actor: 'test' });
    correctSentRecord(ws, sent.event.id, { field: 'sent_at_utc', value: '2026-09-09T13:00:00.000Z', reason: 'I sent it a day earlier than I recorded.' });

    const history = sentHistory(ws, draftId);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.['sent_at_utc'], sent.event.sent_at_utc, 'the original record is immutable');
    assert.equal((history[0]?.['corrections'] as unknown[]).length, 1);
  });
});
