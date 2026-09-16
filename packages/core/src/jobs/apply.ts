import type { Workspace } from '../workspace.js';
import type { DbOp } from '../commit/manifest.js';
import type { StagedFile } from '../commit/commit.js';
import { AppError } from '../util/errors.js';
import { todayIso } from '../util/time.js';
import {
  canonicalPathFor,
  entityAnchors,
  findEntityByAnchor,
  normaliseName,
  normaliseUrl,
  outreachBriefPathFor,
  recordDuplicateCandidate,
  resolveOrCreateEntity,
  requireEntity,
  sourceMapPathFor,
  vaultFilePath,
} from '../registry.js';
import { composeGeneratedNote, readNoteFile, recordPreservedSections, type ComposedNote } from '../notes/noteStore.js';
import { completeTask, enqueueTask, getTask, type TaskRow } from '../tasks/queue.js';
import { ensureScope } from '../scope/scope.js';
import { upsertPersonSource } from '../sources/sources.js';
import { refreshPersonReadiness } from '../readiness.js';
import { createDraft } from '../outreach/drafts.js';
import { validateDraftPackage } from '../outreach/review.js';
import {
  JobResult,
  type LabResearchResult,
  type OutreachDraftResult,
  type PeopleDiscoveryResult,
  type PersonResearchResult,
  type ProgramResearchResult,
  type SourceMapResult,
  type UniversityDiscoveryResult,
  type VerificationResult,
} from './schemas.js';
import {
  bullets,
  coverageSection,
  emptySourceMapSections,
  labStubSections,
  personStubSections,
  entityOp,
  eventOp,
  evidenceTable,
  expansionBudget,
  factTable,
  ingestSources,
  linkList,
  NONE,
  paragraph,
  relationshipOp,
  sourceSection,
} from './helpers.js';

export interface AppliedResult {
  files: StagedFile[];
  dbOps: DbOp[];
  summary: Record<string, unknown>;
  state: 'complete' | 'partial';
  preserved: { vaultPath: string; sections: string[] }[];
}

function noteFile(composed: ComposedNote, entityId: string | undefined, noteType: string): StagedFile {
  return {
    path: composed.filePath,
    content: composed.text,
    expectedPrior: composed.expectedPrior,
    entityId,
    noteType,
    source: 'worker',
  };
}

/* ------------------------------------------------------------------ Job 1 */

export function applyUniversityDiscovery(ws: Workspace, task: TaskRow, result: UniversityDiscoveryResult): AppliedResult {
  const universityId = task.target_id;
  requireEntity(ws, universityId, 'university');
  const universityPath = canonicalPathFor('university', universityId) as string;
  const sources = ingestSources(ws, result.university.sources, universityId, task.current_run_id ?? 'run');

  const files: StagedFile[] = [];
  const dbOps: DbOp[] = [];
  const preserved: AppliedResult['preserved'] = [];

  // Resolve unit identities first so notes can link to real paths.
  const unitIds = new Map<string, string>();
  for (const unit of result.units) {
    const resolved = resolveOrCreateEntity(ws, {
      kind: 'unit',
      displayTitle: unit.official_name,
      anchors: [
        ...(unit.urls.main ? [{ kind: 'unit_url' as const, value: unit.urls.main }] : []),
        { kind: 'name_in_unit' as const, value: `${universityId}:${unit.official_name}` },
        { kind: 'display_name' as const, value: unit.official_name },
      ],
    });
    unitIds.set(unit.key, resolved.id);
  }

  dbOps.push(
    entityOp({
      id: universityId,
      kind: 'university',
      canonicalPath: universityPath,
      displayTitle: result.university.official_name,
      identityConfidence: 'verified',
    }),
    {
      kind: 'university.upsert',
      payload: {
        entityId: universityId,
        officialName: result.university.official_name,
        domain: result.university.domain ?? null,
        homepageUrl: result.university.homepage_url ?? null,
        country: result.university.country ?? null,
        defaultTimezone: result.university.default_timezone ?? null,
      },
    },
  );

  const unitLinks = result.units.map((unit) => ({
    label: `${unit.official_name} (${unit.unit_type})`,
    vaultPath: canonicalPathFor('unit', unitIds.get(unit.key) as string) as string,
  }));

  const universityComposed = composeGeneratedNote(ws, {
    vaultPath: universityPath,
    entityId: universityId,
    frontmatter: {
      id: universityId,
      type: 'university',
      title: result.university.official_name,
      official_name: result.university.official_name,
      domain: result.university.domain,
      homepage_url: result.university.homepage_url,
      country: result.university.country,
      campuses: result.university.campuses,
      default_timezone: result.university.default_timezone,
      discovery_gaps: result.university.discovery_gaps,
      checked_at: todayIso(),
      sources: sources.list.map((s) => s.id),
    },
    sections: [
      { id: 'overview', heading: 'Overview', content: paragraph(result.university.overview) },
      {
        id: 'identity',
        heading: 'Institutional identity',
        content: factTable({
          official_name: result.university.official_name,
          domain: result.university.domain ?? null,
          homepage: result.university.homepage_url ?? null,
          country: result.university.country ?? null,
          campuses: result.university.campuses,
          default_timezone: result.university.default_timezone ?? null,
        }),
      },
      {
        id: 'ambiguity',
        heading: 'Name resolution',
        content:
          result.ambiguity_candidates.length === 0
            ? 'The supplied name resolved to a single institution.'
            : bullets(result.ambiguity_candidates.map((c) => `${c.name}${c.url ? ` — ${c.url}` : ''}${c.note ? ` (${c.note})` : ''}`)),
      },
      { id: 'units', heading: 'Discovered academic units', content: linkList(universityPath, unitLinks) },
      { id: 'coverage', heading: 'Discovery coverage', content: coverageSection(result.coverage) },
      { id: 'gaps', heading: 'Incomplete discovery areas', content: bullets(result.university.discovery_gaps) },
      { id: 'sources', heading: 'Sources', content: sourceSection(sources.list) },
    ],
    source: 'worker',
  });
  files.push(noteFile(universityComposed, universityId, 'university'));
  dbOps.push(...universityComposed.dbOps);
  if (universityComposed.preservedSections.length) preserved.push({ vaultPath: universityPath, sections: universityComposed.preservedSections });

  for (const unit of result.units) {
    const unitId = unitIds.get(unit.key) as string;
    const unitPath = canonicalPathFor('unit', unitId) as string;
    const unitSources = ingestSources(ws, unit.sources, unitId, task.current_run_id ?? 'run');
    const parentId = unit.parent_key ? unitIds.get(unit.parent_key) : undefined;

    dbOps.push(
      entityOp({ id: unitId, kind: 'unit', canonicalPath: unitPath, displayTitle: unit.official_name, identityConfidence: 'probable' }),
      {
        kind: 'unit.upsert',
        payload: {
          entityId: unitId,
          universityId,
          officialName: unit.official_name,
          unitType: unit.unit_type,
          campus: unit.campus ?? null,
          url: unit.urls.main ?? null,
          discoveredBy: task.id,
        },
      },
      {
        kind: 'unit.parent',
        payload: parentId
          ? { unitId, parentId, parentKind: 'unit' }
          : { unitId, parentId: universityId, parentKind: 'university' },
      },
      { kind: 'discovery.enqueue', payload: { entityId: unitId, entityKind: 'unit', discoveredBy: task.id, reason: '/research-university discovery', scopeStatus: 'undecided' } },
    );

    const related = [
      { label: result.university.official_name, vaultPath: universityPath, prefix: 'University' },
      ...(parentId ? [{ label: 'Parent unit', vaultPath: canonicalPathFor('unit', parentId) as string, prefix: 'Parent' }] : []),
      ...result.units
        .filter((child) => child.parent_key === unit.key)
        .map((child) => ({
          label: child.official_name,
          vaultPath: canonicalPathFor('unit', unitIds.get(child.key) as string) as string,
          prefix: 'Child unit',
        })),
    ];

    const composed = composeGeneratedNote(ws, {
      vaultPath: unitPath,
      entityId: unitId,
      frontmatter: {
        id: unitId,
        type: 'unit',
        title: unit.official_name,
        official_name: unit.official_name,
        unit_type: unit.unit_type,
        university_id: universityId,
        parents: parentId ? [parentId] : [universityId],
        campus: unit.campus,
        aliases: unit.aliases,
        urls: unit.urls,
        scope_decision: 'undecided',
        discovery_gaps: unit.discovery_gaps,
        checked_at: todayIso(),
        sources: unitSources.list.map((s) => s.id),
      },
      sections: [
        { id: 'overview', heading: 'Overview', content: paragraph(unit.overview) },
        {
          id: 'identity',
          heading: 'Unit identity',
          content: factTable({
            official_name: unit.official_name,
            unit_type: unit.unit_type,
            campus: unit.campus ?? null,
            aliases: unit.aliases,
          }),
        },
        { id: 'themes', heading: 'Teaching and research themes', content: bullets(unit.themes) },
        { id: 'offerings', heading: 'Known graduate offerings', content: bullets(unit.graduate_offerings) },
        {
          id: 'entry-points',
          heading: 'Official entry points',
          content: factTable({
            main: unit.urls.main ?? null,
            faculty_directory: unit.urls.faculty_directory ?? null,
            graduate_programs: unit.urls.graduate_programs ?? null,
            research: unit.urls.research ?? null,
            labs: unit.urls.labs ?? null,
          }),
        },
        { id: 'related-records', heading: 'Related records', content: linkList(unitPath, related) },
        { id: 'gaps', heading: 'Incomplete discovery areas', content: bullets(unit.discovery_gaps) },
        { id: 'sources', heading: 'Sources', content: sourceSection(unitSources.list) },
      ],
      source: 'worker',
    });
    files.push(noteFile(composed, unitId, 'unit'));
    dbOps.push(...composed.dbOps);
    if (composed.preservedSections.length) preserved.push({ vaultPath: unitPath, sections: composed.preservedSections });
  }

  ensureScope(ws, universityId);
  dbOps.push(eventOp('scope:selection_requested', universityId, { units: result.units.length }));

  return {
    files,
    dbOps,
    state: 'complete',
    preserved,
    summary: {
      university: result.university.official_name,
      unitsDiscovered: result.units.length,
      selectionRequired: true,
      note: 'Units default to undecided. Confirm a department selection before scoped research runs.',
    },
  };
}

/* ------------------------------------------------------------------ Job 2 */

export function applyProgramResearch(ws: Workspace, task: TaskRow, result: ProgramResearchResult): AppliedResult {
  const unitId = task.target_id;
  const unit = requireEntity(ws, unitId, 'unit');
  const universityId = ws.db.get<{ university_id: string }>('SELECT university_id FROM academic_units WHERE entity_id = ?', unitId)?.university_id;
  if (!universityId) throw new AppError('invalid_input', `Unit ${unitId} has no university`, { unitId });

  const files: StagedFile[] = [];
  const dbOps: DbOp[] = [];
  const preserved: AppliedResult['preserved'] = [];
  const allowed = new Set(
    [...ws.config.degreeScope.primary, ...(ws.config.degreeScope.allowRelated ? ws.config.degreeScope.related : [])].map(degreeKey),
  );
  const excludedPrograms: string[] = [];
  const inScope = result.programs.filter((program) => {
    const family = program.identity.degree_family ?? program.identity.award ?? '';
    if (allowed.size > 0 && family && !allowed.has(degreeKey(family))) {
      excludedPrograms.push(`${program.identity.official_title} (${family}) is outside the configured degree scope.`);
      return false;
    }
    return true;
  });

  // A page is an identity only when exactly one program claims it. The first
  // program page and the first calendar entry are candidates; a department
  // listing that several programs cite is evidence, never an identity.
  const identityUrls = inScope.map((program) => {
    const candidates = [
      program.sources.find((s) => s.category === 'program_page')?.url,
      program.sources.find((s) => s.category === 'graduate_calendar')?.url,
    ];
    return [...new Set(candidates.filter((u): u is string => !!u).map(normaliseUrl).filter((u) => u !== ''))];
  });
  const claims = new Map<string, string[]>();
  inScope.forEach((program, index) => {
    for (const url of identityUrls[index] ?? []) claims.set(url, [...(claims.get(url) ?? []), program.identity.official_title]);
  });
  const sharedSourcePages = [...claims.entries()]
    .filter(([, titles]) => titles.length > 1)
    .map(([url, programs]) => ({ url, programs }));
  const sharedUrls = new Set(sharedSourcePages.map((entry) => entry.url));
  const contestedProgramUrls: { url: string; program: string; ownedBy: string }[] = [];
  const recorded: { id: string; title: string; created: boolean; matchedBy: string | null }[] = [];
  const seenIds = new Map<string, string>();
  const stagedPaths = new Set<string>();

  inScope.forEach((program, index) => {
    const title = program.identity.official_title;
    const nameKey = normaliseName(`${universityId}:${title}`);
    const anchors: { kind: 'program_url'; value: string }[] = [];
    const contestedOwners: string[] = [];
    for (const url of identityUrls[index] ?? []) {
      if (sharedUrls.has(url)) continue;
      const owner = findEntityByAnchor(ws, 'program', 'program_url', url);
      if (owner) {
        const ownerNames = entityAnchors(ws, owner, 'name_in_unit');
        if (ownerNames.length > 0 && !ownerNames.includes(nameKey)) {
          // Another program already owns this page under a different title:
          // the page is contested, so it identifies nobody. Never merge on it.
          contestedProgramUrls.push({ url, program: title, ownedBy: owner });
          contestedOwners.push(owner);
          continue;
        }
      }
      anchors.push({ kind: 'program_url', value: url });
    }

    const resolved = resolveOrCreateEntity(ws, {
      kind: 'program',
      displayTitle: title,
      anchors: [
        ...anchors,
        { kind: 'name_in_unit' as const, value: `${universityId}:${title}` },
        { kind: 'display_name' as const, value: title },
      ],
    });
    const programId = resolved.id;
    const previousTitle = seenIds.get(programId);
    if (previousTitle !== undefined) {
      throw new AppError(
        'invalid_input',
        `Programs "${previousTitle}" and "${title}" both resolve to ${programId}. Give each program its own official title; the result was not applied.`,
        { programId, titles: [previousTitle, title] },
      );
    }
    seenIds.set(programId, title);
    for (const owner of contestedOwners) {
      if (owner !== programId) recordDuplicateCandidate(ws, programId, owner, 'shared_program_url', 'low');
    }
    recorded.push({ id: programId, title, created: resolved.created, matchedBy: resolved.matchedBy });

    const programPath = canonicalPathFor('program', programId) as string;
    const sources = ingestSources(ws, program.sources, programId, task.current_run_id ?? 'run');
    const administering = program.identity.administering_unit_ids.length > 0 ? program.identity.administering_unit_ids : [unitId];

    dbOps.push(
      entityOp({ id: programId, kind: 'program', canonicalPath: programPath, displayTitle: title, identityConfidence: 'probable', created: resolved.created }),
      {
        kind: 'program.upsert',
        payload: {
          entityId: programId,
          universityId,
          officialTitle: program.identity.official_title,
          award: program.identity.award ?? null,
          degreeFamily: program.identity.degree_family ?? null,
          campus: program.identity.campus ?? null,
        },
      },
      ...administering.map((administeringUnit) =>
        relationshipOp({
          fromId: administeringUnit,
          toId: programId,
          relType: 'administers_program',
          evidenceStatus: 'confirmed',
          observedAt: todayIso(),
        }),
      ),
    );

    const related = [
      { label: unit.display_title, vaultPath: canonicalPathFor('unit', unitId) as string, prefix: 'Department or school' },
      { label: 'University', vaultPath: canonicalPathFor('university', universityId) as string, prefix: 'University' },
    ];

    const composed = composeGeneratedNote(ws, {
      vaultPath: programPath,
      entityId: programId,
      frontmatter: {
        id: programId,
        type: 'program',
        title: program.identity.official_title,
        official_title: program.identity.official_title,
        award: program.identity.award,
        degree_family: program.identity.degree_family,
        university_id: universityId,
        administering_units: administering,
        campus: program.identity.campus,
        academic_year: program.academic_year,
        intakes: program.intakes,
        supervisor_required_before_application: program.supervisor_required_before_application,
        categories_checked: program.categories_checked,
        open_questions: program.open_questions,
        evidence: program.evidence,
        checked_at: todayIso(),
        sources: sources.list.map((s) => s.id),
      },
      sections: [
        { id: 'identity', heading: 'Identity', content: factTable({ ...program.identity, administering_unit_ids: administering }) },
        { id: 'overview', heading: 'Overview', content: factTable(program.overview) },
        { id: 'structure', heading: 'Structure', content: factTable(program.structure) },
        { id: 'attendance', heading: 'Attendance', content: factTable(program.attendance) },
        { id: 'research', heading: 'Research', content: factTable(program.research) },
        { id: 'curriculum', heading: 'Curriculum', content: factTable(program.curriculum) },
        { id: 'eligibility', heading: 'Eligibility', content: factTable(program.eligibility) },
        { id: 'application', heading: 'Application', content: factTable(program.application) },
        { id: 'supervision', heading: 'Supervision', content: factTable(program.supervision) },
        { id: 'funding', heading: 'Funding and cost', content: factTable(program.funding) },
        { id: 'contact', heading: 'Contact', content: factTable(program.contact) },
        { id: 'extensions', heading: 'Additional sourced information', content: factTable(program.extensions) },
        { id: 'conflicts', heading: 'Conflicts and open questions', content: bullets([...program.conflicts, ...program.open_questions]) },
        { id: 'evidence', heading: 'Evidence', content: evidenceTable(program.evidence) },
        { id: 'related-records', heading: 'Related records', content: linkList(programPath, related) },
        { id: 'sources', heading: 'Sources', content: sourceSection(sources.list) },
      ],
      claims: [
        {
          claimKey: 'application_requirements',
          claimValue: JSON.stringify(program.application).slice(0, 500),
          evidenceStatus: 'confirmed',
          freshnessClass: 'critical',
          checkedAt: todayIso(),
        },
        {
          claimKey: 'funding',
          claimValue: JSON.stringify(program.funding).slice(0, 500),
          evidenceStatus: 'unverified',
          freshnessClass: 'critical',
          checkedAt: todayIso(),
        },
      ],
      source: 'worker',
    });
    const staged = noteFile(composed, programId, 'program');
    if (stagedPaths.has(staged.path)) {
      throw new AppError('invalid_input', `Program note ${staged.path} would be written twice in one result.`, { path: staged.path });
    }
    stagedPaths.add(staged.path);
    files.push(staged);
    dbOps.push(...composed.dbOps);
    if (composed.preservedSections.length) preserved.push({ vaultPath: programPath, sections: composed.preservedSections });
  });

  return {
    files,
    dbOps,
    state: 'complete',
    preserved,
    summary: {
      unit: unit.display_title,
      programsRecorded: recorded.length,
      programs: recorded,
      sharedSourcePages,
      contestedProgramUrls,
      excludedByDegreeScope: excludedPrograms,
      noProgramFound: result.no_program_found ?? null,
    },
  };
}

/** Degree families compare by letters and digits only: `MMath`, `mmath` and `M.Math` are one family. */
function degreeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ------------------------------------------------------------------ Job 3 */

export function applyPeopleDiscovery(ws: Workspace, task: TaskRow, result: PeopleDiscoveryResult): AppliedResult {
  const unitId = task.target_id;
  const unit = requireEntity(ws, unitId, 'unit');
  const universityId = ws.db.get<{ university_id: string }>('SELECT university_id FROM academic_units WHERE entity_id = ?', unitId)?.university_id;

  const files: StagedFile[] = [];
  const dbOps: DbOp[] = [];
  const preserved: AppliedResult['preserved'] = [];
  const created: { id: string; name: string; created: boolean; duplicates: number }[] = [];
  const nameToId = new Map<string, string>();

  for (const person of result.people) {
    const resolved = resolveOrCreateEntity(ws, {
      kind: 'person',
      displayTitle: person.full_name,
      identityConfidence: person.identity_confidence,
      anchors: [
        ...(person.profile_url ? [{ kind: 'profile_url' as const, value: person.profile_url }] : []),
        ...(person.orcid ? [{ kind: 'orcid' as const, value: person.orcid }] : []),
        ...(person.email ? [{ kind: 'email' as const, value: person.email }] : []),
        { kind: 'name_in_unit' as const, value: `${unitId}:${person.full_name}` },
        { kind: 'display_name' as const, value: person.full_name },
      ],
    });
    nameToId.set(person.full_name, resolved.id);
    created.push({ id: resolved.id, name: person.full_name, created: resolved.created, duplicates: resolved.duplicateCandidates.length });

    const personPath = canonicalPathFor('person', resolved.id) as string;
    const sources = ingestSources(ws, person.sources, resolved.id, task.current_run_id ?? 'run');

    dbOps.push(
      entityOp({ id: resolved.id, kind: 'person', canonicalPath: personPath, displayTitle: person.full_name, identityConfidence: person.identity_confidence, created: resolved.created }),
      {
        kind: 'person.upsert',
        payload: {
          entityId: resolved.id,
          fullName: person.full_name,
          officialTitle: person.official_title ?? null,
          roleCategory: person.role_category,
          profileUrl: person.profile_url ?? null,
          orcid: person.orcid ?? null,
          email: person.email ?? null,
          emailEvidence: person.email_evidence,
        },
      },
      relationshipOp({
        fromId: resolved.id,
        toId: unitId,
        relType: 'affiliated_with',
        role: person.official_title ?? '',
        evidenceStatus: 'confirmed',
        observedAt: todayIso(),
      }),
      { kind: 'discovery.enqueue', payload: { entityId: resolved.id, entityKind: 'person', discoveredBy: task.id, reason: '/discover-people directory discovery', scopeStatus: 'in_scope' } },
    );

    for (const relationship of person.relationships) {
      const targetId = relationship.to_person_id ?? (relationship.to_name ? nameToId.get(relationship.to_name) : undefined);
      if (!targetId) continue;
      dbOps.push(
        relationshipOp({
          fromId: resolved.id,
          toId: targetId,
          relType: relationship.rel_type,
          role: relationship.role ?? '',
          evidenceStatus: relationship.evidence_status,
          observedAt: todayIso(),
        }),
      );
    }

    const composed = composeGeneratedNote(ws, {
      vaultPath: personPath,
      entityId: resolved.id,
      frontmatter: {
        id: resolved.id,
        type: 'person',
        title: person.full_name,
        full_name: person.full_name,
        official_title: person.official_title,
        role_category: person.role_category,
        identity_confidence: person.identity_confidence,
        affiliations: [unitId],
        profile_url: person.profile_url,
        orcid: person.orcid,
        email: person.email,
        email_evidence: person.email_evidence,
        research_complete: false,
        checked_at: todayIso(),
        sources: sources.list.map((s) => s.id),
      },
      sections: [
        {
          id: 'identity',
          heading: 'Identity',
          content: factTable({
            full_name: person.full_name,
            official_title: person.official_title ?? null,
            role_category: person.role_category,
            identity_confidence: person.identity_confidence,
            profile_url: person.profile_url ?? null,
            orcid: person.orcid ?? null,
          }),
        },
        { id: 'themes', heading: 'Public research themes', content: bullets(person.research_themes) },
        {
          id: 'role-evidence',
          heading: 'Role and suitability evidence',
          content: factTable({
            graduate_supervision_evidence: person.graduate_supervision_evidence ?? null,
            contact_suitability_evidence: person.contact_suitability_evidence ?? null,
            email_evidence: person.email_evidence,
          }),
        },
        {
          id: 'related-records',
          heading: 'Related records',
          content: linkList(personPath, [
            { label: unit.display_title, vaultPath: canonicalPathFor('unit', unitId) as string, prefix: 'Department' },
            { label: 'Source map', vaultPath: sourceMapPathFor(resolved.id), prefix: 'Sources' },
          ]),
        },
        {
          id: 'research-summary',
          heading: 'Research summary',
          content: '/research-person has not run for this person yet. Directory-level facts only.',
        },
        { id: 'sources', heading: 'Sources', content: sourceSection(sources.list) },
      ],
      source: 'worker',
    });
    files.push(noteFile(composed, resolved.id, 'person'));
    dbOps.push(...composed.dbOps);
    if (composed.preservedSections.length) preserved.push({ vaultPath: personPath, sections: composed.preservedSections });

    const mapPath = sourceMapPathFor(resolved.id);
    const mapComposed = composeGeneratedNote(ws, {
      vaultPath: mapPath,
      entityId: resolved.id,
      frontmatter: {
        id: `${resolved.id}-sources`,
        type: 'source_map',
        title: `Source map for ${person.full_name}`,
        person_id: resolved.id,
        checked_at: todayIso(),
      },
      sections: emptySourceMapSections(mapPath, { label: person.full_name, vaultPath: personPath }),
      source: 'worker',
    });
    files.push(noteFile(mapComposed, resolved.id, 'source_map'));
    dbOps.push(...mapComposed.dbOps);

    dbOps.push({
      kind: 'task.enqueue',
      payload: {
        jobKind: 'map_person_sources',
        targetKind: 'person',
        targetId: resolved.id,
        scopeId: task.scope_id,
        scopeVersion: task.scope_version,
        params: {},
        requestedBy: 'discovery',
        priority: 40,
      },
    });
  }

  const coverage = result.coverage as PeopleDiscoveryResult['coverage'];
  const unitPath = canonicalPathFor('unit', unitId) as string;
  const ledgerComposed = composeGeneratedNote(ws, {
    vaultPath: unitPath,
    entityId: unitId,
    frontmatter: { id: unitId, type: 'unit', title: unit.display_title },
    sections: [
      {
        id: 'people-coverage',
        heading: 'People discovery coverage',
        content: [
          `Checked on ${todayIso()}.`,
          '',
          `**Directory pages**\n\n${bullets(coverage.directory_pages)}`,
          '',
          `**Pagination handled:** ${coverage.pagination_handled ? 'yes' : 'no'}`,
          '',
          `**Directory categories**\n\n${bullets(coverage.categories)}`,
          '',
          `**Inaccessible**\n\n${bullets((coverage.inaccessible ?? []).map((i) => `${i.url} — ${i.reason}`))}`,
          '',
          `**People recorded**\n\n${bullets(created.map((p) => `${p.name} (${p.id})${p.created ? '' : ' — existing record reused'}${p.duplicates ? ` — ${p.duplicates} duplicate candidate(s) flagged` : ''}`))}`,
        ].join('\n'),
      },
    ],
    source: 'worker',
  });
  files.push(noteFile(ledgerComposed, unitId, 'unit'));
  dbOps.push(...ledgerComposed.dbOps);

  return {
    files,
    dbOps,
    state: 'complete',
    preserved,
    summary: {
      unit: unit.display_title,
      peopleRecorded: created.length,
      newRecords: created.filter((p) => p.created).length,
      reusedRecords: created.filter((p) => !p.created).length,
      duplicateCandidates: created.reduce((sum, p) => sum + p.duplicates, 0),
      paginationHandled: coverage.pagination_handled,
    },
  };
}

/* ------------------------------------------------------------------ Job 4 */

export function applySourceMap(ws: Workspace, task: TaskRow, result: SourceMapResult): AppliedResult {
  const personId = task.target_id;
  const person = requireEntity(ws, personId, 'person');
  const mapPath = sourceMapPathFor(personId);
  const dbOps: DbOp[] = [];

  const rows: { id: string; url: string; category: string; access: string; confidence: string; investigated: boolean }[] = [];
  for (const entry of result.entries) {
    const ingested = ingestSources(
      ws,
      [
        {
          url: entry.url,
          category: entry.category,
          title: entry.title,
          access_status: entry.access_status,
          fetch_method: entry.fetch_method,
          observed_at: entry.last_attempt_at,
          notes: entry.note,
        },
      ],
      personId,
      task.current_run_id ?? 'run',
    );
    const sourceId = ingested.ids.get(entry.url) as string;
    upsertPersonSource(ws, {
      personId,
      sourceId,
      category: entry.category,
      identityConfidence: entry.identity_confidence,
      investigated: false,
      accessStatus: entry.access_status,
      fetchMethod: entry.fetch_method,
      discoverySource: entry.discovery_source,
      note: entry.note,
      lastAttemptAt: entry.last_attempt_at,
    });
    rows.push({
      id: sourceId,
      url: entry.url,
      category: entry.category,
      access: entry.access_status,
      confidence: entry.identity_confidence,
      investigated: false,
    });
  }

  const entriesTable =
    rows.length === 0
      ? NONE
      : `| Source | Category | Identity | Access | Investigated | URL |\n| --- | --- | --- | --- | --- | --- |\n${rows
          .map((row) => `| ${row.id} | ${row.category} | ${row.confidence} | ${row.access} | no | ${row.url} |`)
          .join('\n')}`;

  const composed = composeGeneratedNote(ws, {
    vaultPath: mapPath,
    entityId: personId,
    frontmatter: {
      id: `${personId}-sources`,
      type: 'source_map',
      title: `Source map for ${person.display_title}`,
      person_id: personId,
      categories_searched: [...new Set(result.entries.map((e) => e.category))],
      entries: result.entries.map((entry) => ({
        url: entry.url,
        category: entry.category,
        discovery_source: entry.discovery_source,
        identity_confidence: entry.identity_confidence,
        access_status: entry.access_status,
        fetch_method: entry.fetch_method,
        last_attempt_at: entry.last_attempt_at,
        investigated: false,
      })),
      absent_categories: result.absent_categories,
      blocked: result.blocked.map((b) => `${b.url}: ${b.reason}`),
      checked_at: todayIso(),
    },
    sections: [
      { id: 'summary', heading: 'Summary', content: paragraph(result.summary) },
      { id: 'entries', heading: 'Mapped sources', content: entriesTable },
      { id: 'absent', heading: 'Categories with nothing found', content: bullets(result.absent_categories) },
      {
        id: 'blocked',
        heading: 'Blocked or unavailable',
        content: bullets(result.blocked.map((b) => `${b.url} — ${b.reason}`)),
      },
      {
        id: 'timezone-basis',
        heading: 'Timezone basis',
        content: paragraph(
          result.timezone_basis_location
            ? `Institutional location recorded as: ${result.timezone_basis_location}. This is a professional location, not a statement about where the person currently is.`
            : undefined,
        ),
      },
      {
        id: 'related-records',
        heading: 'Related records',
        content: linkList(mapPath, [{ label: person.display_title, vaultPath: canonicalPathFor('person', personId) as string, prefix: 'Profile' }]),
      },
    ],
    source: 'worker',
  });

  dbOps.push(...composed.dbOps, {
    kind: 'task.enqueue',
    payload: {
      jobKind: 'research_person',
      targetKind: 'person',
      targetId: personId,
      scopeId: task.scope_id,
      scopeVersion: task.scope_version,
      params: {},
      requestedBy: 'discovery',
      priority: 50,
    },
  });

  return {
    files: [noteFile(composed, personId, 'source_map')],
    dbOps,
    state: 'complete',
    preserved: composed.preservedSections.length ? [{ vaultPath: mapPath, sections: composed.preservedSections }] : [],
    summary: {
      person: person.display_title,
      sourcesMapped: rows.length,
      absentCategories: result.absent_categories,
      blocked: result.blocked.length,
    },
  };
}

/* ------------------------------------------------------------------ Job 5 */

function publicationSummarySection(publication: PersonResearchResult['publications'][number]): string {
  if (publication.summary_basis === 'full_text' && publication.summary) {
    return factTable({
      research_question: publication.summary.research_question ?? null,
      approach: publication.summary.approach ?? null,
      findings: publication.summary.findings ?? null,
      stated_limitations: publication.summary.stated_limitations ?? null,
      possible_relevance: publication.summary.possible_relevance ?? null,
    });
  }
  if (publication.summary_basis === 'abstract_only') {
    return [
      '**Abstract-only summary.** The full text was not read. Nothing below describes experiments or limitations beyond what the abstract states.',
      '',
      publication.summary?.abstract_text ? `> ${publication.summary.abstract_text.replace(/\n/g, '\n> ')}` : NONE,
      '',
      publication.summary?.possible_relevance ? `Possible relevance: ${publication.summary.possible_relevance}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return '**Metadata only.** The paper was not accessible, so no summary of its contents exists. This is a recorded gap, not an omission to fill in later from the title.';
}

export function applyPersonResearch(ws: Workspace, task: TaskRow, result: PersonResearchResult): AppliedResult {
  const personId = task.target_id;
  const person = requireEntity(ws, personId, 'person');
  const personPath = canonicalPathFor('person', personId) as string;
  const files: StagedFile[] = [];
  const dbOps: DbOp[] = [];
  const preserved: AppliedResult['preserved'] = [];
  const budget = expansionBudget(ws);
  const sources = ingestSources(ws, result.evidence.sources, personId, task.current_run_id ?? 'run');

  // Publications are shared records: one note per paper, linked to every author.
  const publicationLinks: { label: string; vaultPath: string; prefix?: string }[] = [];
  for (const publication of result.publications) {
    const anchors = [
      ...(publication.doi ? [{ kind: 'doi' as const, value: publication.doi }] : []),
      ...(publication.links[0] ? [{ kind: 'homepage' as const, value: publication.links[0] }] : []),
      { kind: 'display_name' as const, value: publication.title },
    ];
    const resolved = resolveOrCreateEntity(ws, { kind: 'publication', displayTitle: publication.title, anchors });
    const pubPath = canonicalPathFor('publication', resolved.id) as string;
    publicationLinks.push({ label: publication.title, vaultPath: pubPath });

    let versionOf: string | undefined;
    if (publication.version_of_doi) {
      const related = ws.db.get<{ entity_id: string }>(
        'SELECT entity_id FROM publications WHERE doi = ?',
        publication.version_of_doi.toLowerCase(),
      );
      versionOf = related?.entity_id;
    }

    dbOps.push(
      entityOp({ id: resolved.id, kind: 'publication', canonicalPath: pubPath, displayTitle: publication.title, identityConfidence: publication.doi ? 'verified' : 'probable', created: resolved.created }),
      {
        kind: 'publication.upsert',
        payload: {
          entityId: resolved.id,
          title: publication.title,
          doi: publication.doi?.toLowerCase() ?? null,
          venue: publication.venue ?? null,
          pubType: publication.publication_type ?? null,
          publishedDate: publication.published_date ?? null,
          onlineDate: publication.online_date ?? null,
          preprintDate: publication.preprint_date ?? null,
          accessibility: publication.accessibility,
          summaryBasis: publication.summary_basis,
          versionOf: versionOf ?? null,
        },
      },
      relationshipOp({
        fromId: personId,
        toId: resolved.id,
        relType: 'authored',
        evidenceStatus: 'confirmed',
        observedAt: todayIso(),
      }),
    );

    const existingAuthors = ws.db.all<{ from_id: string }>(
      "SELECT from_id FROM relationships WHERE to_id = ? AND rel_type = 'authored'",
      resolved.id,
    );
    const authorLinks = existingAuthors
      .map((row) => {
        const entity = ws.db.get<{ display_title: string; canonical_path: string | null }>(
          'SELECT display_title, canonical_path FROM entities WHERE id = ?',
          row.from_id,
        );
        return entity?.canonical_path ? { label: entity.display_title, vaultPath: entity.canonical_path, prefix: 'Author' } : null;
      })
      .filter((value): value is { label: string; vaultPath: string; prefix: string } => value !== null);
    if (!authorLinks.some((link) => link.vaultPath === personPath)) {
      authorLinks.push({ label: person.display_title, vaultPath: personPath, prefix: 'Author' });
    }

    const composed = composeGeneratedNote(ws, {
      vaultPath: pubPath,
      entityId: resolved.id,
      frontmatter: {
        id: resolved.id,
        type: 'publication',
        title: publication.title,
        publication_title: publication.title,
        authors: publication.authors,
        author_entity_ids: [...new Set([...existingAuthors.map((a) => a.from_id), personId])],
        doi: publication.doi,
        identifiers: publication.identifiers,
        publication_type: publication.publication_type,
        venue: publication.venue,
        published_date: publication.published_date,
        online_date: publication.online_date,
        preprint_date: publication.preprint_date,
        version_of: versionOf,
        accessibility: publication.accessibility,
        summary_basis: publication.summary_basis,
        links: publication.links,
        checked_at: todayIso(),
      },
      sections: [
        {
          id: 'metadata',
          heading: 'Metadata',
          content: factTable({
            title: publication.title,
            authors: publication.authors,
            doi: publication.doi ?? null,
            publication_type: publication.publication_type ?? null,
            venue: publication.venue ?? null,
            published_date: publication.published_date ?? null,
            online_date: publication.online_date ?? null,
            preprint_date: publication.preprint_date ?? null,
            is_preprint: publication.is_preprint ? 'yes' : 'no',
            accessibility: publication.accessibility,
            summary_basis: publication.summary_basis,
            links: publication.links,
          }),
        },
        { id: 'summary', heading: 'Summary', content: publicationSummarySection(publication) },
        { id: 'related-records', heading: 'Related records', content: linkList(pubPath, authorLinks) },
      ],
      source: 'worker',
    });
    files.push(noteFile(composed, resolved.id, 'publication'));
    dbOps.push(...composed.dbOps);
    if (composed.preservedSections.length) preserved.push({ vaultPath: pubPath, sections: composed.preservedSections });
  }

  // Laboratories: link what is known, and queue bounded follow-up research.
  const labLinks: { label: string; vaultPath: string; prefix?: string }[] = [];
  for (const lab of result.affiliations.labs) {
    const resolved = resolveOrCreateEntity(ws, {
      kind: 'lab',
      displayTitle: lab.name,
      anchors: [...(lab.url ? [{ kind: 'lab_url' as const, value: lab.url }] : []), { kind: 'display_name' as const, value: lab.name }],
    });
    const labPath = canonicalPathFor('lab', resolved.id) as string;
    labLinks.push({ label: lab.name, vaultPath: labPath, prefix: 'Laboratory' });
    dbOps.push(
      entityOp({ id: resolved.id, kind: 'lab', canonicalPath: labPath, displayTitle: lab.name, identityConfidence: lab.url ? 'probable' : 'name_only', created: resolved.created }),
      { kind: 'lab.upsert', payload: { entityId: resolved.id, officialName: lab.name, url: lab.url ?? null } },
      relationshipOp({
        fromId: personId,
        toId: resolved.id,
        relType: 'member_of_lab',
        role: lab.role ?? '',
        status: lab.status,
        evidenceStatus: 'confirmed',
        observedAt: todayIso(),
      }),
      { kind: 'discovery.enqueue', payload: { entityId: resolved.id, entityKind: 'lab', discoveredBy: task.id, reason: 'Discovered during /research-person', scopeStatus: 'unknown' } },
    );
    if (budget.take()) {
      dbOps.push({
        kind: 'task.enqueue',
        payload: {
          jobKind: 'research_lab',
          targetKind: 'lab',
          targetId: resolved.id,
          params: {},
          requestedBy: 'discovery',
          priority: 60,
        },
      });
    }

    // Give the laboratory a navigable note now; Job 6 replaces its contents.
    if (!readNoteFile(ws, labPath).exists) {
      const stub = composeGeneratedNote(ws, {
        vaultPath: labPath,
        entityId: resolved.id,
        frontmatter: {
          id: resolved.id,
          type: 'lab',
          title: lab.name,
          official_name: lab.name,
          url: lab.url,
          directors: lab.role && /director|principal|head/i.test(lab.role) ? [personId] : [],
          checked_at: todayIso(),
        },
        sections: labStubSections({
          officialName: lab.name,
          url: lab.url,
          role: lab.role,
          discoveredVia: `/research-person on ${person.display_title}`,
          labPath,
          relatedLinks: [{ label: person.display_title, vaultPath: personPath, prefix: lab.role ?? 'Member' }],
        }),
        source: 'worker',
      });
      files.push(noteFile(stub, resolved.id, 'lab'));
      dbOps.push(...stub.dbOps);
    }
  }

  // Students and assistants enter the registry with their role and source.
  const studentLinks: { label: string; vaultPath: string; prefix?: string }[] = [];
  const stagedPaths = new Set(files.map((file) => file.path));
  for (const student of result.affiliations.students) {
    const resolved = resolveOrCreateEntity(ws, {
      kind: 'person',
      displayTitle: student.full_name,
      identityConfidence: student.profile_url ? 'probable' : 'name_only',
      anchors: [
        ...(student.profile_url ? [{ kind: 'profile_url' as const, value: student.profile_url }] : []),
        { kind: 'display_name' as const, value: student.full_name },
      ],
    });
    const studentPath = canonicalPathFor('person', resolved.id) as string;
    const knownStudent = ws.db.get<{ official_title: string | null; role_category: string }>(
      'SELECT official_title, role_category FROM people WHERE entity_id = ?',
      resolved.id,
    );
    studentLinks.push({ label: `${student.full_name} (${student.role})`, vaultPath: studentPath, prefix: 'Assistant or student' });
    dbOps.push(
      entityOp({ id: resolved.id, kind: 'person', canonicalPath: studentPath, displayTitle: student.full_name, identityConfidence: student.profile_url ? 'probable' : 'name_only', created: resolved.created }),
      {
        kind: 'person.upsert',
        payload: {
          entityId: resolved.id,
          fullName: student.full_name,
          // A supervisor's page is not authoritative for a listed person's own title.
          officialTitle: knownStudent?.official_title ? null : student.role,
          roleCategory: knownStudent && knownStudent.role_category !== 'unknown' ? knownStudent.role_category : student.role_category,
          profileUrl: student.profile_url ?? null,
        },
      },
      relationshipOp({
        fromId: personId,
        toId: resolved.id,
        relType: 'works_with',
        role: student.role,
        evidenceStatus: 'confirmed',
        observedAt: todayIso(),
        note: student.source_url ?? null,
      }),
      {
        kind: 'discovery.enqueue',
        payload: {
          entityId: resolved.id,
          entityKind: 'person',
          discoveredBy: task.id,
          reason: `Listed as ${student.role} for ${person.display_title}`,
          scopeStatus: 'undecided',
        },
      },
    );

    // A discovered person gets a navigable stub note unless a real one exists.
    const stubFilePath = vaultFilePath(studentPath);
    if (!readNoteFile(ws, studentPath).exists && !stagedPaths.has(stubFilePath)) {
      const stub = composeGeneratedNote(ws, {
        vaultPath: studentPath,
        entityId: resolved.id,
        frontmatter: {
          id: resolved.id,
          type: 'person',
          title: student.full_name,
          full_name: student.full_name,
          official_title: student.role,
          role_category: student.role_category,
          identity_confidence: student.profile_url ? 'probable' : 'name_only',
          profile_url: student.profile_url,
          research_complete: false,
          checked_at: todayIso(),
        },
        sections: personStubSections({
          fullName: student.full_name,
          role: student.role,
          roleCategory: student.role_category,
          profileUrl: student.profile_url,
          sourceUrl: student.source_url,
          discoveredVia: `/research-person on ${person.display_title}`,
          relatedLinks: [{ label: person.display_title, vaultPath: personPath, prefix: 'Listed with' }],
          personPath: studentPath,
        }),
        source: 'worker',
      });
      files.push(noteFile(stub, resolved.id, 'person'));
      dbOps.push(...stub.dbOps);
      stagedPaths.add(stubFilePath);
    }
  }

  const supervisionCaution =
    'An email may ask about availability; it must not claim a funded opening exists. An active lab page, a recent paper, or an open position elsewhere is not evidence of a place.';
  const supervisionTable =
    result.supervision.length === 0
      ? `No public statement about supervision availability was found. ${supervisionCaution}`
      : [
          `| Program | Availability | Checked | Source |`,
          `| --- | --- | --- | --- |`,
          ...result.supervision.map(
            (item) =>
              `| ${item.program_title ?? item.program_id ?? 'Unspecified'} | ${item.availability} | ${item.checked_at ?? '—'} | ${item.source_url ?? '—'} |`,
          ),
          '',
          result.supervision.every((item) => item.availability === 'accepting') ? '' : supervisionCaution,
        ]
          .filter((line) => line !== '')
          .join('\n');

  const publicationInventory =
    result.publications.length === 0
      ? NONE
      : `| Publication | Date | Accessibility | Summary basis |\n| --- | --- | --- | --- |\n${result.publications
          .map(
            (p) =>
              `| ${p.title.replace(/\|/g, '\\|')} | ${p.published_date ?? p.online_date ?? p.preprint_date ?? '—'} | ${p.accessibility} | ${p.summary_basis} |`,
          )
          .join('\n')}`;

  const mostRecent = [...result.publications]
    .map((p) => p.published_date ?? p.online_date ?? p.preprint_date ?? '')
    .filter(Boolean)
    .sort()
    .pop();

  const contactRule = result.contact.contact_rule;
  const affiliationLinks = ws.db
    .all<{ to_id: string }>("SELECT to_id FROM relationships WHERE from_id = ? AND rel_type = 'affiliated_with'", personId)
    .map((row) => {
      const entity = ws.db.get<{ display_title: string; canonical_path: string | null }>(
        'SELECT display_title, canonical_path FROM entities WHERE id = ?',
        row.to_id,
      );
      return entity?.canonical_path ? { label: entity.display_title, vaultPath: entity.canonical_path, prefix: 'Department' } : null;
    })
    .filter((v): v is { label: string; vaultPath: string; prefix: string } => v !== null);

  const composed = composeGeneratedNote(ws, {
    vaultPath: personPath,
    entityId: personId,
    frontmatter: {
      id: personId,
      type: 'person',
      title: result.identity.full_name,
      full_name: result.identity.full_name,
      official_title: result.identity.official_title,
      role_category: result.identity.role_category,
      profile_url: result.evidence.sources.find((s) => s.category === 'official_profile')?.url,
      email: result.contact.email,
      email_evidence: result.contact.email_evidence,
      contact_rule: contactRule,
      timezone: result.location.timezone,
      timezone_basis: result.location.timezone_basis,
      supervision: result.supervision.map((s) => ({
        program_id: s.program_id,
        program_title: s.program_title,
        availability: s.availability,
        checked_at: s.checked_at,
      })),
      research_complete: result.research_complete && !result.scope.budget_exhausted,
      publication_scope: result.scope.publication_scope,
      coverage_limitations: result.evidence.coverage,
      checked_at: todayIso(),
      sources: sources.list.map((s) => s.id),
    },
    sections: [
      {
        id: 'identity',
        heading: 'Identity and appointments',
        content: [
          factTable({
            full_name: result.identity.full_name,
            official_title: result.identity.official_title ?? null,
            role_category: result.identity.role_category,
            appointments: result.identity.appointments,
          }),
          '',
          paragraph(result.identity.biography),
          '',
          `**Uncertainties**\n\n${bullets(result.identity.uncertainties)}`,
        ].join('\n'),
      },
      {
        id: 'research-summary',
        heading: 'Research summary',
        content: [
          paragraph(result.research.synthesis),
          '',
          `**Interests**\n\n${bullets(result.research.interests)}`,
          '',
          `**Methods**\n\n${bullets(result.research.methods)}`,
          '',
          `**Themes**\n\n${bullets(result.research.themes)}`,
        ].join('\n'),
      },
      {
        id: 'current-activity',
        heading: 'Current projects and activity',
        content: [
          result.current_activity.projects.length === 0
            ? NONE
            : `| Project | Evidence | Observed | Source |\n| --- | --- | --- | --- |\n${result.current_activity.projects
                .map((p) => `| ${p.name} | ${p.evidence_status} | ${p.observed_at ?? '—'} | ${p.source_url ?? '—'} |`)
                .join('\n')}`,
          '',
          paragraph(result.current_activity.notes, ''),
        ].join('\n'),
      },
      {
        id: 'affiliations',
        heading: 'Laboratories, collaborators and students',
        content: [
          `**Laboratories**\n\n${linkList(personPath, labLinks)}`,
          '',
          `**Collaborators**\n\n${bullets(result.affiliations.collaborators.map((c) => `${c.name}${c.note ? ` — ${c.note}` : ''}`))}`,
          '',
          `**Students and assistants**\n\n${linkList(personPath, studentLinks)}`,
        ].join('\n'),
      },
      { id: 'supervision', heading: 'Supervision eligibility', content: supervisionTable },
      {
        id: 'publications',
        heading: 'Publications',
        content: [
          `Scope: ${result.scope.publication_scope}. ${result.scope.budget_exhausted ? '**This run reached its budget: the inventory is partial and resumable.**' : ''}`,
          '',
          publicationInventory,
          '',
          `Most recent publication found: ${mostRecent ?? 'none recorded'}`,
          '',
          `**Publication notes**\n\n${linkList(personPath, publicationLinks)}`,
        ].join('\n'),
      },
      {
        id: 'contact',
        heading: 'Professional contact',
        content: [
          factTable({
            email: result.contact.email ?? null,
            email_evidence: result.contact.email_evidence,
            preferred_method: result.contact.preferred_method ?? null,
            required_subject: result.contact.required_subject ?? null,
            requested_documents: result.contact.requested_documents,
            contact_rule: contactRule,
            checked_at: result.contact.checked_at ?? todayIso(),
            source: result.contact.source_url ?? null,
          }),
          '',
          paragraph(result.contact.instructions, 'No specific contact instructions were published.'),
          contactRule === 'do_not_email'
            ? '\n\n**This person asks not to be emailed. An ordinary unsolicited draft is blocked until the conflict is resolved.**'
            : contactRule === 'portal_only'
              ? '\n\n**This person directs applicants to a portal. An ordinary unsolicited draft is blocked until the conflict is resolved.**'
              : '',
        ].join('\n'),
      },
      {
        id: 'location',
        heading: 'Institutional location and timezone',
        content: [
          factTable({
            institutional_location: result.location.institutional_location ?? null,
            timezone: result.location.timezone ?? null,
            timezone_basis: result.location.timezone_basis,
            observed_at: result.location.observed_at ?? null,
          }),
          '',
          result.location.timezone_basis === 'campus_inferred'
            ? 'This zone is inferred from the institutional campus. It describes a professional location, not where the person is at any moment.'
            : '',
        ].join('\n'),
      },
      {
        id: 'applicant-connections',
        heading: 'Connections to the applicant',
        content: result.applicant_connections
          ? [
              `**Possible connections**\n\n${bullets(result.applicant_connections.connections)}`,
              '',
              `**Gaps**\n\n${bullets(result.applicant_connections.gaps)}`,
              '',
              `**Questions worth asking**\n\n${bullets(result.applicant_connections.questions)}`,
            ].join('\n')
          : 'Fit commentary was not requested for this run.',
      },
      {
        id: 'evidence',
        heading: 'Evidence, coverage and open issues',
        content: [
          `**Verification outcomes**\n\n${
            result.evidence.verification.length === 0
              ? NONE
              : bullets(result.evidence.verification.map((v) => `${v.claim} — ${v.status}${v.note ? ` (${v.note})` : ''}`))
          }`,
          '',
          `**Coverage limitations**\n\n${bullets(result.evidence.coverage)}`,
          '',
          `**Blocked sources**\n\n${bullets(result.evidence.blocked.map((b) => `${b.url} — ${b.reason}`))}`,
          '',
          `**Unresolved**\n\n${bullets(result.evidence.unresolved)}`,
        ].join('\n'),
      },
      {
        id: 'related-records',
        heading: 'Related records',
        content: linkList(personPath, [
          ...affiliationLinks,
          { label: 'Source map', vaultPath: sourceMapPathFor(personId), prefix: 'Sources' },
          ...labLinks,
        ]),
      },
      { id: 'sources', heading: 'Sources', content: sourceSection(sources.list) },
    ],
    claims: [
      {
        claimKey: 'contact_instructions',
        claimValue: result.contact.instructions ?? contactRule,
        evidenceStatus: result.contact.email_evidence,
        checkedAt: result.contact.checked_at ?? todayIso(),
        freshnessClass: 'critical',
      },
      {
        claimKey: 'recipient_email',
        claimValue: result.contact.email ?? null,
        evidenceStatus: result.contact.email_evidence,
        checkedAt: result.contact.checked_at ?? todayIso(),
        freshnessClass: 'critical',
      },
    ],
    source: 'worker',
  });
  files.push(noteFile(composed, personId, 'person'));
  dbOps.push(...composed.dbOps);
  if (composed.preservedSections.length) preserved.push({ vaultPath: personPath, sections: composed.preservedSections });

  const researchComplete = result.research_complete && !result.scope.budget_exhausted;
  dbOps.push(
    {
      kind: 'person.upsert',
      payload: {
        entityId: personId,
        fullName: result.identity.full_name,
        officialTitle: result.identity.official_title ?? null,
        roleCategory: result.identity.role_category,
        email: result.contact.email ?? null,
        emailEvidence: result.contact.email_evidence,
        contactRule: contactRule,
        timezone: result.location.timezone ?? null,
        timezoneBasis: result.location.timezone_basis,
        timezoneObservedAt: result.location.observed_at ?? null,
      },
    },
    {
      kind: 'person.readiness',
      payload: { entityId: personId, researchComplete, emailReady: false, detail: { source: 'job5' } },
    },
    ...result.supervision
      .filter((item) => item.program_id)
      .map((item) =>
        relationshipOp({
          fromId: personId,
          toId: item.program_id as string,
          relType: 'supervises_in_program',
          role: item.availability,
          evidenceStatus: item.availability === 'no_public_information' ? 'unknown' : 'confirmed',
          observedAt: item.checked_at ?? todayIso(),
        }),
      ),
  );

  if (ws.config.research.requireVerifier && researchComplete) {
    dbOps.push({
      kind: 'task.enqueue',
      payload: {
        jobKind: 'verify_person',
        targetKind: 'person',
        targetId: personId,
        scopeId: task.scope_id,
        scopeVersion: task.scope_version,
        params: {},
        requestedBy: 'core',
        priority: 55,
      },
    });
  }

  return {
    files,
    dbOps,
    state: result.scope.budget_exhausted ? 'partial' : 'complete',
    preserved,
    summary: {
      person: result.identity.full_name,
      publications: result.publications.length,
      fullTextSummaries: result.publications.filter((p) => p.summary_basis === 'full_text').length,
      abstractOnly: result.publications.filter((p) => p.summary_basis === 'abstract_only').length,
      metadataOnly: result.publications.filter((p) => p.summary_basis === 'metadata_only').length,
      labsLinked: labLinks.length,
      studentsRecorded: studentLinks.length,
      researchComplete,
      budgetExhausted: result.scope.budget_exhausted,
      expansionBudget: { limit: budget.limit, used: budget.taken },
    },
  };
}

/* ------------------------------------------------------------------ Job 6 */

export function applyLabResearch(ws: Workspace, task: TaskRow, result: LabResearchResult): AppliedResult {
  const resolved = resolveOrCreateEntity(ws, {
    kind: 'lab',
    displayTitle: result.lab.official_name,
    preferId: task.target_id && task.target_id.startsWith('lab-') ? task.target_id : undefined,
    anchors: [
      ...(result.lab.url ? [{ kind: 'lab_url' as const, value: result.lab.url }] : []),
      { kind: 'display_name' as const, value: result.lab.official_name },
    ],
  });
  const labId = resolved.id;
  const labPath = canonicalPathFor('lab', labId) as string;
  const sources = ingestSources(ws, result.sources, labId, task.current_run_id ?? 'run');
  const files: StagedFile[] = [];
  const dbOps: DbOp[] = [];
  const budget = expansionBudget(ws);

  dbOps.push(
    entityOp({ id: labId, kind: 'lab', canonicalPath: labPath, displayTitle: result.lab.official_name, identityConfidence: result.lab.url ? 'verified' : 'name_only', created: resolved.created }),
    {
      kind: 'lab.upsert',
      payload: {
        entityId: labId,
        universityId: result.lab.university_id ?? null,
        officialName: result.lab.official_name,
        url: result.lab.url ?? null,
        timezone: result.lab.timezone ?? null,
        timezoneBasis: result.lab.timezone_basis,
      },
    },
    ...result.lab.unit_ids.map((unitId) =>
      relationshipOp({ fromId: labId, toId: unitId, relType: 'belongs_to_unit', evidenceStatus: 'confirmed', observedAt: todayIso() }),
    ),
  );

  const memberLinks: { label: string; vaultPath: string; prefix?: string }[] = [];
  const stagedPaths = new Set<string>();
  const directors: string[] = [];
  const currentMembers: string[] = [];
  const formerMembers: string[] = [];

  for (const member of result.members) {
    const memberResolved = resolveOrCreateEntity(ws, {
      kind: 'person',
      displayTitle: member.full_name,
      preferId: member.person_id,
      identityConfidence: member.profile_url ? 'probable' : 'name_only',
      anchors: [
        ...(member.profile_url ? [{ kind: 'profile_url' as const, value: member.profile_url }] : []),
        { kind: 'display_name' as const, value: member.full_name },
      ],
    });
    const memberPath = canonicalPathFor('person', memberResolved.id) as string;
    memberLinks.push({
      label: `${member.full_name} — ${member.role || member.role_category}${member.status === 'former' ? ' (former)' : ''}`,
      vaultPath: memberPath,
      prefix: member.is_director ? 'Director' : 'Member',
    });
    if (member.is_director) directors.push(memberResolved.id);
    else if (member.status === 'former') formerMembers.push(memberResolved.id);
    else currentMembers.push(memberResolved.id);

    // A lab roster describes a role inside the lab. It is not authoritative for
    // somebody's academic title, so an existing title or role is left alone and
    // the lab role is carried on the relationship instead.
    const known = ws.db.get<{ official_title: string | null; role_category: string }>(
      'SELECT official_title, role_category FROM people WHERE entity_id = ?',
      memberResolved.id,
    );
    dbOps.push(
      entityOp({ id: memberResolved.id, kind: 'person', canonicalPath: memberPath, displayTitle: member.full_name, identityConfidence: member.profile_url ? 'probable' : 'name_only', created: memberResolved.created }),
      {
        kind: 'person.upsert',
        payload: {
          entityId: memberResolved.id,
          fullName: member.full_name,
          officialTitle: known?.official_title ? null : member.role || null,
          roleCategory: known && known.role_category !== 'unknown' ? known.role_category : member.role_category,
          profileUrl: member.profile_url ?? null,
        },
      },
      relationshipOp({
        fromId: memberResolved.id,
        toId: labId,
        relType: member.is_director ? 'directs_lab' : 'member_of_lab',
        role: member.role,
        status: member.status,
        evidenceStatus: 'confirmed',
        observedAt: member.observed_at ?? todayIso(),
        note: member.source_url ?? null,
      }),
      {
        kind: 'discovery.enqueue',
        payload: {
          entityId: memberResolved.id,
          entityKind: 'person',
          discoveredBy: task.id,
          reason: `Listed on ${result.lab.official_name}`,
          scopeStatus: 'unknown',
        },
      },
    );

    const memberFilePath = vaultFilePath(memberPath);
    if (!readNoteFile(ws, memberPath).exists && !stagedPaths.has(memberFilePath)) {
      const stub = composeGeneratedNote(ws, {
        vaultPath: memberPath,
        entityId: memberResolved.id,
        frontmatter: {
          id: memberResolved.id,
          type: 'person',
          title: member.full_name,
          full_name: member.full_name,
          official_title: member.role,
          role_category: member.role_category,
          identity_confidence: member.profile_url ? 'probable' : 'name_only',
          profile_url: member.profile_url,
          labs: [labId],
          research_complete: false,
          checked_at: todayIso(),
        },
        sections: personStubSections({
          fullName: member.full_name,
          role: member.role,
          roleCategory: member.role_category,
          profileUrl: member.profile_url,
          sourceUrl: member.source_url,
          discoveredVia: `Job 6 research on ${result.lab.official_name}`,
          relatedLinks: [{ label: result.lab.official_name, vaultPath: labPath, prefix: 'Laboratory' }],
          personPath: memberPath,
        }),
        source: 'worker',
      });
      files.push(noteFile(stub, memberResolved.id, 'person'));
      dbOps.push(...stub.dbOps);
      stagedPaths.add(memberFilePath);
    }

    if (memberResolved.created && member.is_director && budget.take()) {
      dbOps.push({
        kind: 'task.enqueue',
        payload: {
          jobKind: 'map_person_sources',
          targetKind: 'person',
          targetId: memberResolved.id,
          params: {},
          requestedBy: 'discovery',
          priority: 45,
        },
      });
    }
  }

  const composed = composeGeneratedNote(ws, {
    vaultPath: labPath,
    entityId: labId,
    frontmatter: {
      id: labId,
      type: 'lab',
      title: result.lab.official_name,
      official_name: result.lab.official_name,
      university_id: result.lab.university_id,
      units: result.lab.unit_ids,
      url: result.lab.url,
      directors,
      members_current: currentMembers,
      members_former: formerMembers,
      timezone: result.lab.timezone,
      timezone_basis: result.lab.timezone_basis,
      recruitment_notice: {
        text: result.lab.recruitment.text,
        observed_at: result.lab.recruitment.observed_at,
      },
      unavailable_information: result.unavailable_information,
      checked_at: todayIso(),
      sources: sources.list.map((s) => s.id),
    },
    sections: [
      { id: 'overview', heading: 'Overview', content: paragraph(result.lab.overview) },
      {
        id: 'identity',
        heading: 'Laboratory identity',
        content: factTable({
          official_name: result.lab.official_name,
          url: result.lab.url ?? null,
          location: result.lab.location ?? null,
          timezone: result.lab.timezone ?? null,
          timezone_basis: result.lab.timezone_basis,
        }),
      },
      { id: 'themes', heading: 'Research themes', content: bullets(result.lab.themes) },
      {
        id: 'projects',
        heading: 'Projects',
        content: bullets(result.lab.projects.map((p) => `**${p.name}** — ${p.description}`)),
      },
      { id: 'members', heading: 'Membership', content: linkList(labPath, memberLinks) },
      {
        id: 'membership-evidence',
        heading: 'Membership evidence',
        content:
          'Absence from a current roster is not by itself evidence that somebody left. Former members are preserved where a source identifies them explicitly.',
      },
      { id: 'facilities', heading: 'Facilities', content: bullets(result.lab.facilities) },
      { id: 'collaborations', heading: 'Collaborations', content: bullets(result.lab.collaborations) },
      {
        id: 'recruitment',
        heading: 'Recruitment notices',
        content: result.lab.recruitment.text
          ? `${result.lab.recruitment.text}\n\nObserved on ${result.lab.recruitment.observed_at ?? todayIso()}${
              result.lab.recruitment.source_url ? ` (${result.lab.recruitment.source_url})` : ''
            }.\n\nAn active lab page is not evidence that a funded opening exists.`
          : 'No dated recruitment notice was found. Do not infer an opening from an active lab page.',
      },
      {
        id: 'contact',
        heading: 'Contact instructions',
        content: paragraph(result.lab.contact_instructions, 'No lab-level contact instruction was published.'),
      },
      { id: 'publications', heading: 'Publications', content: bullets(result.publications.map((p) => `${p.title}${p.doi ? ` (${p.doi})` : ''}${p.url ? ` — ${p.url}` : ''}`)) },
      { id: 'unavailable', heading: 'Information not available', content: bullets(result.unavailable_information) },
      { id: 'sources', heading: 'Sources', content: sourceSection(sources.list) },
    ],
    source: 'worker',
  });
  files.push(noteFile(composed, labId, 'lab'));
  dbOps.push(...composed.dbOps);

  return {
    files,
    dbOps,
    state: 'complete',
    preserved: composed.preservedSections.length ? [{ vaultPath: labPath, sections: composed.preservedSections }] : [],
    summary: {
      lab: result.lab.official_name,
      labId,
      members: result.members.length,
      directors: directors.length,
      formerMembers: formerMembers.length,
      expansionBudget: { limit: budget.limit, used: budget.taken },
    },
  };
}

/* ------------------------------------------------------------------ Job 7 */

export function applyOutreachDraft(ws: Workspace, task: TaskRow, result: OutreachDraftResult): AppliedResult {
  const created = createDraft(ws, {
    personId: result.person_id,
    purpose: result.purpose,
    programId: result.program_id,
    campaign: result.campaign,
    recipient: result.recipient,
    subject: result.subject,
    body: result.body,
    attachments: result.attachments.map((attachment) => ({
      document_id: attachment.document_id,
      version: attachment.version ?? 0,
      filename: '',
      sha256: '',
    })),
    contactRequirements: result.contact_requirements,
    supportingLinks: result.supporting_links.map((link) => ({ label: link.label, vaultPath: link.vault_path })),
    briefMarkdown: result.brief,
    timingNote: result.timing_note,
    taskId: task.id,
    runId: task.current_run_id,
    fencingToken: task.fencing_token,
    actor: 'worker',
  });

  const validation = validateDraftPackage(ws, created.outreachId);
  refreshPersonReadiness(ws, result.person_id);

  return {
    files: [],
    dbOps: [eventOp('outreach:drafted', created.outreachId, { personId: result.person_id, state: validation.state })],
    state: 'complete',
    preserved: [],
    summary: {
      outreachId: created.outreachId,
      created: created.created,
      state: validation.state,
      ready: validation.ready,
      issues: validation.issues,
      note: 'The draft is for manual sending. Nothing is transmitted by this system.',
    },
  };
}

/* ------------------------------------------------------ Targeted verifier */

export function applyVerification(ws: Workspace, task: TaskRow, result: VerificationResult): AppliedResult {
  const personId = result.person_id;
  const personPath = canonicalPathFor('person', personId) as string;
  const refuted = result.checks.filter((check) => check.status === 'refuted');
  const unresolved = result.checks.filter((check) => check.status === 'unresolved');
  const researchComplete = result.research_complete && refuted.length === 0 && result.blocking_issues.length === 0;

  const composed = composeGeneratedNote(ws, {
    vaultPath: personPath,
    entityId: personId,
    frontmatter: { id: personId, type: 'person', title: requireEntity(ws, personId).display_title, research_complete: researchComplete },
    sections: [
      {
        id: 'verification',
        heading: 'Verification',
        content: [
          `Checked on ${todayIso()}.`,
          '',
          result.checks.length === 0
            ? NONE
            : `| Claim | Status | Source | Note |\n| --- | --- | --- | --- |\n${result.checks
                .map((c) => `| ${c.claim.replace(/\|/g, '\\|')} | ${c.status} | ${c.source_url ?? '—'} | ${c.note ?? '—'} |`)
                .join('\n')}`,
          '',
          `**Blocking issues**\n\n${bullets(result.blocking_issues)}`,
        ].join('\n'),
      },
    ],
    source: 'worker',
  });

  const dbOps: DbOp[] = [
    ...composed.dbOps,
    { kind: 'person.readiness', payload: { entityId: personId, researchComplete, emailReady: false, detail: { verifier: true, refuted: refuted.length, unresolved: unresolved.length } } },
  ];

  return {
    files: [noteFile(composed, personId, 'person')],
    dbOps,
    state: 'complete',
    preserved: [],
    summary: {
      personId,
      checks: result.checks.length,
      refuted: refuted.length,
      unresolved: unresolved.length,
      researchComplete,
    },
  };
}

/* -------------------------------------------------------------- Dispatch */

export interface ApplyResultInput {
  taskId: string;
  owner: string;
  fencingToken: number;
  result: unknown;
}

const APPLIERS: Record<string, (ws: Workspace, task: TaskRow, result: never) => AppliedResult> = {
  discover_university: applyUniversityDiscovery as never,
  research_programs: applyProgramResearch as never,
  discover_people: applyPeopleDiscovery as never,
  map_person_sources: applySourceMap as never,
  research_person: applyPersonResearch as never,
  research_lab: applyLabResearch as never,
  draft_outreach: applyOutreachDraft as never,
  verify_person: applyVerification as never,
};

/**
 * Validate a worker result against its schema, turn it into artifacts, and
 * commit them together with the task's completion.
 */
export function applyJobResult(
  ws: Workspace,
  input: ApplyResultInput,
): { commitId: string; installed: string[]; summary: Record<string, unknown>; state: string } {
  const task = getTask(ws, input.taskId);
  const parsed = JobResult.safeParse(input.result);
  if (!parsed.success) {
    throw new AppError('invalid_input', 'Worker result failed schema validation', {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
    });
  }
  const jobFromResult = (parsed.data as { job: string }).job;
  if (jobFromResult !== task.job_kind) {
    throw new AppError('invalid_input', `Result is for ${jobFromResult} but task ${task.id} is ${task.job_kind}`, {
      taskId: task.id,
    });
  }
  const applier = APPLIERS[task.job_kind];
  if (!applier) throw new AppError('invalid_input', `No applier for ${task.job_kind}`, {});

  const applied = applier(ws, task, parsed.data as never);
  const completion = completeTask(ws, {
    taskId: task.id,
    owner: input.owner,
    fencingToken: input.fencingToken,
    state: applied.state,
    files: applied.files,
    dbOps: applied.dbOps,
    progress: applied.summary,
    description: `${task.job_kind} result for ${task.target_id}`,
  });

  for (const entry of applied.preserved) recordPreservedSections(ws, entry.vaultPath, entry.sections);
  if (task.target_kind === 'person') refreshPersonReadiness(ws, task.target_id);

  return { commitId: completion.commitId, installed: completion.installed, summary: applied.summary, state: applied.state };
}

export { enqueueTask, outreachBriefPathFor, vaultFilePath };
