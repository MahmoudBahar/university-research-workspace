/**
 * Seed a throwaway workspace with the fictional Northvale fixtures.
 *
 * Use it to explore the interface, or to exercise the browser flows against the
 * real API and core, without touching your own research and without contacting
 * any real institution or person.
 *
 *   node scripts/demo.mjs <target-directory>
 */
import { existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootDir, npx } from './lib.mjs';
import {
  approveApplicantRevision,
  applyJobResult,
  claimTask,
  confirmSelection,
  enqueueScopedWork,
  enqueueTask,
  getScopeForUniversity,
  openWorkspace,
  snapshotApplicantRevision,
  startUniversityResearch,
  updateSelection,
  generateViews,
} from '@urw/core';
const root = process.argv[2];
if (!root) {
  process.stderr.write('Usage: node scripts/demo.mjs <target-directory>\n');
  process.exit(1);
}

// The fixtures live with the tests; compile them if that has not happened yet.
const fixtureModule = join(rootDir, 'tests', 'dist', 'fixtures', 'fictional-university.js');
if (!existsSync(fixtureModule)) {
  await npx(['tsc', '-b', 'tsconfig.build.json']);
  await npx(['tsc', '-p', join('tests', 'tsconfig.json')]);
}
const fx = await import(`file://${fixtureModule}`);

for (const dir of [
  'vault/universities', 'vault/units', 'vault/programs', 'vault/people', 'vault/labs',
  'vault/publications', 'vault/sources', 'vault/outreach', 'vault/views',
  'data/runs', 'data/revisions', 'data/commits', 'data/cache', 'data/backups', 'data/tmp',
  'applicant/overrides', 'applicant/documents', 'applicant/extracted', 'config', 'templates',
]) {
  mkdirSync(join(root, ...dir.split('/')), { recursive: true });
}
if (!existsSync(join(root, 'package.json'))) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'university-research-workspace', private: true }, null, 2));
}
if (!existsSync(join(root, 'config', 'research.json'))) {
  cpSync(join(rootDir, 'config', 'research.json'), join(root, 'config', 'research.json'));
}
cpSync(join(rootDir, 'templates'), join(root, 'templates'), { recursive: true });

const ws = await openWorkspace({ root, create: true });

function run(jobKind, targetId, result, params = {}) {
  const task = enqueueTask(ws, { jobKind, targetId, params, requestedBy: 'demo' });
  const claimed = claimTask(ws, { owner: 'demo-seed', taskId: task.taskId, force: true });
  if (!claimed) throw new Error(`could not claim ${jobKind}`);
  return applyJobResult(ws, { taskId: claimed.task.id, owner: 'demo-seed', fencingToken: claimed.fencingToken, result });
}

writeFileSync(
  join(ws.paths.applicant, 'profile.md'),
  `---
schema_version: 1
id: applicant-profile
type: applicant_profile
title: Applicant profile
revision: 1
---

# Applicant profile

- Full name: A. Fictional Applicant
- Degree: BSc in Electrical Engineering, Fictional State University, 2025
- Final-year project: adaptive filtering for noisy sensor arrays
- IELTS Academic 7.5 overall (taken 2026-03-14), evidence: doc import pending
- Targeting: MASc, Fall 2027 intake
`,
);
writeFileSync(
  join(ws.paths.applicant, 'email-style.md'),
  `---
schema_version: 1
id: applicant-email-style
type: applicant_style
title: Email drafting guidance
revision: 1
---

# Email drafting guidance

- Tone: direct, specific, no flattery.
- Never claim I read a paper when only the abstract was available.
- Ask about student availability; never assert an opening exists.
`,
);
for (const kind of ['profile', 'style']) {
  const revision = snapshotApplicantRevision(ws, kind);
  approveApplicantRevision(ws, kind, revision.sha256, { actor: 'demo' });
}

const started = startUniversityResearch(ws, { name: fx.UNIVERSITY_NAME, domain: fx.UNIVERSITY_DOMAIN });
run('discover_university', started.universityId, fx.universityDiscovery());

const scope = getScopeForUniversity(ws, started.universityId);
const eceId = ws.db.get('SELECT entity_id FROM academic_units WHERE official_name = ?', 'Department of Electrical and Computer Engineering').entity_id;
const artsId = ws.db.get('SELECT entity_id FROM academic_units WHERE official_name = ?', 'Faculty of Arts and Letters').entity_id;
updateSelection(ws, {
  scopeId: scope.id,
  expectedVersion: 0,
  decisions: [
    { unitId: eceId, decision: 'included' },
    { unitId: artsId, decision: 'excluded' },
  ],
});
confirmSelection(ws, scope.id, 0);
enqueueScopedWork(ws, scope.id);

run('research_programs', eceId, fx.programResearch(eceId));
run('discover_people', eceId, fx.peopleDiscovery(eceId));

const programId = ws.db.get('SELECT entity_id FROM programs LIMIT 1').entity_id;
const personId = ws.db.get('SELECT entity_id FROM people WHERE full_name = ?', 'Dr Amara Osei').entity_id;

run('map_person_sources', personId, fx.sourceMap(personId));
run('research_person', personId, fx.personResearch(personId, { programId }));

const labId = ws.db.get('SELECT entity_id FROM labs LIMIT 1').entity_id;
run('research_lab', labId, fx.labResearch(eceId));
run('verify_person', personId, fx.verification(personId));

const draft = run('draft_outreach', personId, fx.outreachDraft(personId, programId), { programId });
generateViews(ws);

process.stdout.write(
  `${JSON.stringify(
    {
      root: ws.paths.root,
      universityId: started.universityId,
      scopeId: scope.id,
      eceId,
      personId,
      programId,
      labId,
      draftId: draft.summary.outreachId,
    },
    null,
    2,
  )}\n\nStart the interface against this demo workspace with:\n  URW_ROOT="${ws.paths.root}" npm start\n`,
);
ws.close();
