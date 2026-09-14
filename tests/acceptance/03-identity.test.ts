import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmSelection,
  getScopeForUniversity,
  listDuplicateCandidates,
  mergeEntities,
  normaliseUrl,
  resolveOrCreateEntity,
  resolveRedirect,
  startUniversityResearch,
  updateSelection,
} from '@urw/core';
import { makeWorkspace, runJob, unitIdByName, personIdByName } from '../helpers/workspace.js';
import * as fx from '../fixtures/fictional-university.js';

describe('identity and deduplication', () => {
  test('one canonical record across departments and laboratories', async (t) => {
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

    runJob(ws, { jobKind: 'discover_people', targetId: eceId, result: fx.peopleDiscovery(eceId) });
    const oseiId = personIdByName(ws, 'Dr Amara Osei');

    // The same person appears in a second department's directory (cross-appointment).
    const crossListed = fx.peopleDiscovery(mechId);
    crossListed.people = [crossListed.people[0] as never];
    runJob(ws, { jobKind: 'discover_people', targetId: mechId, result: crossListed });

    const matches = ws.db.all<{ entity_id: string }>('SELECT entity_id FROM people WHERE full_name = ?', 'Dr Amara Osei');
    assert.equal(matches.length, 1, 'a cross-appointed person keeps one canonical record');

    const affiliations = ws.db.all<{ to_id: string }>(
      "SELECT to_id FROM relationships WHERE from_id = ? AND rel_type = 'affiliated_with'",
      oseiId,
    );
    assert.equal(affiliations.length, 2, 'both appointments are recorded');
  });

  test('an assistant found during lab research reuses the existing person record', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
    runJob(ws, { jobKind: 'discover_university', targetId: started.universityId, result: fx.universityDiscovery() });
    const scope = getScopeForUniversity(ws, started.universityId) as { id: string };
    const eceId = unitIdByName(ws, 'Department of Electrical and Computer Engineering');
    updateSelection(ws, { scopeId: scope.id, expectedVersion: 0, decisions: [{ unitId: eceId, decision: 'included' }] });
    confirmSelection(ws, scope.id, 0);
    runJob(ws, { jobKind: 'discover_people', targetId: eceId, result: fx.peopleDiscovery(eceId) });

    const before = ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM people')?.n ?? 0;
    const priyaBefore = personIdByName(ws, 'Priya Raman');

    const labResult = fx.labResearch(eceId);
    const lab = resolveOrCreateEntity(ws, {
      kind: 'lab',
      displayTitle: labResult.lab.official_name,
      anchors: [{ kind: 'lab_url', value: labResult.lab.url as string }],
    });
    ws.db.run(
      "INSERT INTO labs (entity_id, official_name, url, created_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(entity_id) DO NOTHING",
      lab.id,
      labResult.lab.official_name,
      labResult.lab.url ?? null,
    );
    runJob(ws, { jobKind: 'research_lab', targetId: lab.id, result: labResult });

    assert.equal(personIdByName(ws, 'Priya Raman'), priyaBefore, 'the known assistant is matched by profile URL');
    const after = ws.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM people')?.n ?? 0;
    // Two genuinely new people (a PhD student and a former member) are added.
    assert.equal(after, before + 2);

    const membership = ws.db.all<{ status: string; rel_type: string }>(
      'SELECT status, rel_type FROM relationships WHERE to_id = ?',
      lab.id,
    );
    assert.ok(membership.some((row) => row.status === 'former'), 'former members are preserved');
    assert.ok(membership.some((row) => row.rel_type === 'directs_lab'));
  });

  test('names alone never merge records, but raise a duplicate candidate', async (t) => {
    const { ws, cleanup } = await makeWorkspace();
    t.after(cleanup);

    const first = resolveOrCreateEntity(ws, {
      kind: 'person',
      displayTitle: 'Dr Jordan Vale',
      anchors: [{ kind: 'display_name', value: 'Dr Jordan Vale' }],
    });
    const second = resolveOrCreateEntity(ws, {
      kind: 'person',
      displayTitle: 'Dr Jordan Vale',
      anchors: [{ kind: 'display_name', value: 'Dr Jordan Vale' }],
    });
    assert.notEqual(first.id, second.id, 'a shared display name is not sufficient evidence to merge');
    assert.ok(second.duplicateCandidates.some((candidate) => candidate.entityId === first.id));
    assert.ok(listDuplicateCandidates(ws).length >= 1);

    // A verified anchor does merge.
    const third = resolveOrCreateEntity(ws, {
      kind: 'person',
      displayTitle: 'Dr Jordan Vale',
      anchors: [{ kind: 'orcid', value: '0000-0001-2345-6789' }],
    });
    const fourth = resolveOrCreateEntity(ws, {
      kind: 'person',
      displayTitle: 'J. Vale',
      anchors: [{ kind: 'orcid', value: 'https://orcid.invalid/0000-0001-2345-6789' }],
    });
    assert.equal(fourth.id, third.id, 'a verified ORCID is a strong anchor regardless of formatting');

    // Merging redirects without deleting anything.
    mergeEntities(ws, first.id, second.id, 'confirmed the same person by hand');
    assert.equal(resolveRedirect(ws, second.id), first.id);
    assert.ok(ws.db.get('SELECT id FROM entities WHERE id = ?', second.id), 'the merged record is kept as a redirect');
  });

  test('URL normalisation is stable and case-preserving for paths', () => {
    assert.equal(normaliseUrl('https://www.Example.invalid/People/Osei/'), 'example.invalid/People/Osei');
    assert.equal(normaliseUrl('http://example.invalid:80/People/Osei'), 'example.invalid/People/Osei');
    assert.equal(normaliseUrl('https://example.invalid/'), 'example.invalid');
    assert.equal(normaliseUrl(normaliseUrl('https://example.invalid/People/Osei')), 'example.invalid/People/Osei');
  });
});
