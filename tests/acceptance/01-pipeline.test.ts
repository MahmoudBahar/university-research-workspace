import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkLinks,
  confirmSelection,
  currentScopeVersion,
  enqueueScopedWork,
  getScopeForUniversity,
  listTasks,
  startUniversityResearch,
  updateSelection,
  unitTree,
  workspaceStatus,
} from '@urw/core';
import { makeWorkspace, runJob, seedApplicant, unitIdByName, personIdByName, programIdByTitle } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

describe('seven-job pipeline on fictional fixtures', () => {
  test('discovery, selection, programs, people, sources, profile, lab and draft', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);
    seedApplicant(ws);

    // Job 1
    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
    const job1 = runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
    assert.equal(job1.state, 'complete');
    assert.equal(job1.summary['unitsDiscovered'], 5);

    // Every discovered unit has a note, including ones that will be excluded.
    const units = ws.db.all<{ entity_id: string; official_name: string }>('SELECT entity_id, official_name FROM academic_units');
    assert.equal(units.length, 5);
    for (const unit of units) {
      assert.ok(existsSync(join(ws.paths.vault, 'units', `${unit.entity_id}.md`)), `note missing for ${unit.official_name}`);
    }

    // The hierarchy is preserved: ECE sits under the Faculty of Engineering.
    const tree = unitTree(ws, started.universityId);
    const engineering = tree.find((node) => node.officialName === 'Faculty of Engineering');
    assert.ok(engineering, 'Faculty of Engineering should be a root node');
    assert.ok(engineering.children.some((child) => child.officialName.includes('Electrical')));

    // Nothing is scoped until the user selects.
    const scope = getScopeForUniversity(ws, started.universityId);
    assert.ok(scope);
    assert.equal(scope.current_version, 0);

    const eceId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    const artsId = unitIdByName(ws, 'Faculty of Arts and Letters');
    updateSelection(ws, {
      scopeId: scope.id,
      expectedVersion: 0,
      decisions: [
        { unitId: eceId, decision: 'included' },
        { unitId: artsId, decision: 'excluded' },
      ],
    });
    const confirmed = confirmSelection(ws, scope.id, 0);
    assert.equal(confirmed.newVersion, 1);

    const queued = enqueueScopedWork(ws, scope.id);
    assert.equal(queued.includedUnits, 1);
    assert.equal(queued.enqueued.length, 2);

    // Job 2
    const job2 = runJob(ws, { jobKind: 'research_programs', targetId: eceId, result: fx.programResearch(eceId) });
    assert.equal(job2.summary['programsRecorded'], 1);
    const programId = programIdByTitle(ws, 'Master of Applied Science in Electrical and Computer Engineering');
    const programNote = readFileSync(join(ws.paths.vault, 'programs', `${programId}.md`), 'utf8');
    assert.match(programNote, /IELTS Academic 7\.0/);
    assert.match(programNote, /not guaranteed/i, 'funding wording must survive verbatim');

    // Job 3
    const job3 = runJob(ws, { jobKind: 'discover_people', targetId: eceId, result: fx.peopleDiscovery(eceId) });
    assert.equal(job3.summary['peopleRecorded'], 4);
    const oseiId = personIdByName(ws, 'Dr Amara Osei');
    const assistant = ws.db.get<{ role_category: string }>('SELECT role_category FROM people WHERE full_name = ?', 'Priya Raman');
    assert.equal(assistant?.role_category, 'research_assistant', 'a research assistant is not an assistant professor');
    const kaltsas = ws.db.get<{ role_category: string }>('SELECT role_category FROM people WHERE full_name = ?', 'Dr Ruben Kaltsas');
    assert.equal(kaltsas?.role_category, 'assistant_professor');

    // Job 3 queues Job 4 for each person.
    const mappingTasks = listTasks(ws, { jobKind: 'map_person_sources' });
    assert.equal(mappingTasks.length, 4);

    // Job 4
    const job4 = runJob(ws, { jobKind: 'map_person_sources', targetId: oseiId, result: fx.sourceMap(oseiId) });
    assert.equal(job4.summary['sourcesMapped'], 7);
    const mapNote = readFileSync(join(ws.paths.vault, 'people', oseiId, 'source-map.md'), 'utf8');
    assert.match(mapNote, /Challenge page/, 'a blocked Scholar profile is recorded, not silently dropped');

    // Job 5
    const job5 = runJob(ws, {
      jobKind: 'research_person',
      targetId: oseiId,
      result: fx.personResearch(oseiId, { programId }),
    });
    assert.equal(job5.state, 'complete');
    assert.equal(job5.summary['fullTextSummaries'], 1);
    assert.equal(job5.summary['abstractOnly'], 1);
    assert.equal(job5.summary['metadataOnly'], 1);

    const profile = readFileSync(join(ws.paths.vault, 'people', oseiId, 'profile.md'), 'utf8');
    assert.match(profile, /America\/Toronto/);
    assert.match(profile, /inferred from the institutional campus/i);
    assert.match(profile, /no_public_information/, 'supervision availability stays unknown rather than assumed');

    // Publications are shared notes, and the abstract-only paper says so.
    const publications = ws.db.all<{ entity_id: string; title: string; summary_basis: string }>('SELECT entity_id, title, summary_basis FROM publications');
    assert.equal(publications.length, 3);
    const abstractOnly = publications.find((p) => p.summary_basis === 'abstract_only');
    assert.ok(abstractOnly);
    const abstractNote = readFileSync(join(ws.paths.vault, 'publications', `${abstractOnly.entity_id}.md`), 'utf8');
    assert.match(abstractNote, /Abstract-only summary/);
    const metadataOnly = publications.find((p) => p.summary_basis === 'metadata_only') as { entity_id: string };
    const metadataNote = readFileSync(join(ws.paths.vault, 'publications', `${metadataOnly.entity_id}.md`), 'utf8');
    assert.match(metadataNote, /Metadata only/);

    // Job 6 — the lab discovered during Job 5 already exists as a record.
    const labId = ws.db.get<{ entity_id: string }>('SELECT entity_id FROM labs LIMIT 1')?.entity_id as string;
    assert.ok(labId, 'Job 5 should have registered the laboratory');
    const job6 = runJob(ws, { jobKind: 'research_lab', targetId: labId, result: fx.labResearch(eceId) });
    assert.equal(job6.summary['members'], 4);
    assert.equal(job6.summary['formerMembers'], 1);
    const labNote = readFileSync(join(ws.paths.vault, 'labs', `${labId}.md`), 'utf8');
    assert.match(labNote, /not evidence that a funded opening exists/i);

    // Verification then Job 7
    runJob(ws, { jobKind: 'verify_person', targetId: oseiId, result: fx.verification(oseiId) });
    const job7 = runJob(ws, {
      jobKind: 'draft_outreach',
      targetId: oseiId,
      params: { programId },
      result: fx.outreachDraft(oseiId, programId),
    });
    const draftId = String(job7.summary['outreachId']);
    assert.equal(job7.summary['ready'], true, `draft should validate: ${JSON.stringify(job7.summary['issues'])}`);
    const draftNote = readFileSync(join(ws.paths.vault, 'outreach', draftId, 'draft.md'), 'utf8');
    assert.match(draftNote, /urw:body:begin/);
    assert.match(draftNote, /No attachments selected/, 'attachments default to none');
    assert.ok(existsSync(join(ws.paths.vault, 'outreach', draftId, 'research-brief.md')));

    // Every relative link in the vault resolves.
    const links = checkLinks(ws);
    const broken = links.problems.filter((problem) => problem.kind === 'broken');
    assert.deepEqual(broken, [], `broken links: ${JSON.stringify(broken)}`);

    const status = workspaceStatus(ws);
    assert.equal(status.readyCandidates.filter((c) => c.emailReady).length, 1);
  });
});
