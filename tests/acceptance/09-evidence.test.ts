import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  confirmSelection,
  createDraft,
  evaluateEmailReadiness,
  getScopeForUniversity,
  personSourceMap,
  startUniversityResearch,
  updateSelection,
  validateDraftPackage,
} from '@urw/core';
import { makeWorkspace, runJob, seedApplicant, unitIdByName, personIdByName, programIdByTitle } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

async function researched(t: { after: (fn: () => void) => void }) {
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
  return { ws, personId, programId, eceId };
}

describe('evidence is represented truthfully', () => {
  test('a blocked scholar profile is recorded as blocked and never claimed as inspected', async (t) => {
    const { ws, personId } = await researched(t);
    const sources = personSourceMap(ws, personId);
    const scholar = sources.find((row) => String(row['source_category']) === 'scholar');
    assert.ok(scholar);
    assert.equal(scholar['access_status'], 'blocked');
    assert.equal(scholar['investigated'], 0);

    const note = readFileSync(join(ws.paths.vault, 'people', personId, 'source-map.md'), 'utf8');
    assert.match(note, /Challenge page/);
    assert.doesNotMatch(note, /profile was reviewed/i);
  });

  test('publication accessibility and summary basis stay distinct', async (t) => {
    const { ws, personId, programId } = await researched(t);
    runJob(ws, { jobKind: 'research_person', targetId: personId, result: fx.personResearch(personId, { programId }) });

    const rows = ws.db.all<{ title: string; accessibility: string; summary_basis: string; entity_id: string }>(
      'SELECT title, accessibility, summary_basis, entity_id FROM publications ORDER BY title',
    );
    const byBasis = Object.fromEntries(rows.map((row) => [row.summary_basis, row]));
    assert.ok(byBasis['full_text']);
    assert.ok(byBasis['abstract_only']);
    assert.ok(byBasis['metadata_only']);
    assert.equal(byBasis['abstract_only']?.accessibility, 'auth_required');

    const abstractNote = readFileSync(join(ws.paths.vault, 'publications', `${byBasis['abstract_only']?.entity_id}.md`), 'utf8');
    assert.match(abstractNote, /full text was not read/i);
    const metadataNote = readFileSync(join(ws.paths.vault, 'publications', `${byBasis['metadata_only']?.entity_id}.md`), 'utf8');
    assert.match(metadataNote, /recorded gap/i);
  });

  test('a program conflict is recorded rather than resolved silently', async (t) => {
    const { ws, programId } = await researched(t);
    const note = readFileSync(join(ws.paths.vault, 'programs', `${programId}.md`), 'utf8');
    assert.match(note, /24 months/);
    assert.match(note, /normally two years/);
  });

  test('unknown supervision availability blocks nothing but is never asserted as an opening', async (t) => {
    const { ws, personId, programId } = await researched(t);
    runJob(ws, { jobKind: 'research_person', targetId: personId, result: fx.personResearch(personId, { programId }) });
    const profile = readFileSync(join(ws.paths.vault, 'people', personId, 'profile.md'), 'utf8');
    assert.match(profile, /no_public_information/);
    assert.match(profile, /must not claim a funded opening exists/i);

    const readiness = evaluateEmailReadiness(ws, personId, { programId });
    assert.equal(readiness.emailReady, true, 'unknown availability does not block an email that asks about it');
  });

  test('a professor who says not to email blocks an ordinary draft', async (t) => {
    const { ws, personId, programId } = await researched(t);
    const result = fx.personResearch(personId, { programId });
    result.contact.contact_rule = 'do_not_email';
    result.contact.instructions = 'Please do not email me about admissions; apply through the portal.';
    runJob(ws, { jobKind: 'research_person', targetId: personId, result });

    const readiness = evaluateEmailReadiness(ws, personId, { programId });
    assert.equal(readiness.emailReady, false);
    assert.ok(readiness.issues.some((issue) => issue.code === 'contact_conflict_do_not_email'));

    assert.throws(
      () =>
        createDraft(ws, {
          personId,
          purpose: 'initial_contact',
          recipient: 'a.osei@northvale.invalid',
          subject: 'Enquiry',
          body: 'A body long enough to pass the minimum length validation for a draft package.',
          briefMarkdown: 'Brief.',
          actor: 'test',
        }),
      (error: unknown) => error instanceof AppError && error.code === 'contact_conflict',
      'a published address does not override a stated instruction',
    );
  });

  test('an unverified recipient address blocks readiness', async (t) => {
    const { ws, personId, programId } = await researched(t);
    const result = fx.personResearch(personId, { programId });
    result.contact.email_evidence = 'inferred';
    runJob(ws, { jobKind: 'research_person', targetId: personId, result });

    const readiness = evaluateEmailReadiness(ws, personId, { programId });
    assert.equal(readiness.emailReady, false);
    assert.ok(readiness.issues.some((issue) => issue.code === 'recipient_unverified'));
  });

  test('a run that hits its budget stays partial and resumable', async (t) => {
    const { ws, personId, programId } = await researched(t);
    const outcome = runJob(ws, {
      jobKind: 'research_person',
      targetId: personId,
      result: fx.personResearch(personId, { programId, budgetExhausted: true }),
    });
    assert.equal(outcome.state, 'partial');
    assert.equal(outcome.summary['researchComplete'], false);
    const profile = readFileSync(join(ws.paths.vault, 'people', personId, 'profile.md'), 'utf8');
    assert.match(profile, /reached its budget/i);

    const readiness = evaluateEmailReadiness(ws, personId, { programId });
    assert.equal(readiness.emailReady, false);
    assert.ok(readiness.issues.some((issue) => issue.code === 'research_incomplete'));
  });

  test('attachments default to none and a draft records what the recipient asked for', async (t) => {
    const { ws, personId, programId } = await researched(t);
    runJob(ws, { jobKind: 'research_person', targetId: personId, result: fx.personResearch(personId, { programId }) });
    const draft = runJob(ws, {
      jobKind: 'draft_outreach',
      targetId: personId,
      params: { programId },
      result: fx.outreachDraft(personId, programId),
    });
    const draftId = String(draft.summary['outreachId']);
    const note = readFileSync(join(ws.paths.vault, 'outreach', draftId, 'draft.md'), 'utf8');
    assert.match(note, /No attachments selected/);
    assert.match(note, /Attach a one-page CV/);

    const report = validateDraftPackage(ws, draftId);
    assert.ok(report.issues.some((issue) => issue.code === 'contact_requirement_unchecked' && issue.severity === 'warning'));
    assert.equal(report.ready, true, 'an unchecked requirement warns without blocking');
  });
});
