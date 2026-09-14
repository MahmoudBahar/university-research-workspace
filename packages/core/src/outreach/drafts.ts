import type { Workspace } from '../workspace.js';
import { bind, outreachInUniversity } from '../util/universityFilter.js';
import { AppError } from '../util/errors.js';
import { nextEntityId } from '../util/ids.js';
import { nowIso, todayIso } from '../util/time.js';
import { fingerprint, sha256Text } from '../util/hash.js';
import { emitEvent, recordAudit } from '../util/events.js';
import { canonicalPathFor, outreachBriefPathFor, requireEntity, vaultFilePath } from '../registry.js';
import { readNoteFile, writeNote } from '../notes/noteStore.js';
import { markdownLink } from '../notes/links.js';
import type { DbOp } from '../commit/manifest.js';
import { NOTE_SCHEMA_VERSION } from '../schemas/notes.js';
import { getDocumentVersion } from '../applicant/documents.js';
import { evaluateEmailReadiness } from '../readiness.js';

export const BODY_BEGIN = '<!-- urw:body:begin -->';
export const BODY_END = '<!-- urw:body:end -->';

export interface AttachmentRef {
  document_id: string;
  version: number;
  filename: string;
  sha256: string;
}

export interface ContactRequirement {
  requirement: string;
  source_id?: string;
  satisfied: 'yes' | 'no' | 'unknown';
}

export interface OutreachRow {
  id: string;
  person_id: string;
  purpose: string;
  program_id: string;
  campaign: string;
  state: 'draft' | 'needs_review' | 'approved' | 'sent' | 'archived';
  current_revision: number;
  draft_path: string;
  brief_path: string;
  contact_conflict: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftContent {
  recipient: string;
  subject: string;
  body: string;
  attachments: AttachmentRef[];
  contactRequirements: ContactRequirement[];
  fingerprint: string;
  sha256: string;
  vaultPath: string;
}

/** The copyable message body lives between explicit markers, away from internal notes. */
export function extractBody(noteBody: string): string {
  const start = noteBody.indexOf(BODY_BEGIN);
  const end = noteBody.indexOf(BODY_END);
  if (start === -1 || end === -1 || end < start) {
    throw new AppError('invalid_input', 'The draft note is missing its message body markers.', {
      expected: `${BODY_BEGIN} ... ${BODY_END}`,
    });
  }
  return noteBody.slice(start + BODY_BEGIN.length, end).replace(/^\n+|\n+$/g, '');
}

export function draftFingerprint(input: {
  recipient: string;
  subject: string;
  body: string;
  attachments: AttachmentRef[];
}): string {
  return fingerprint({
    recipient: input.recipient.trim(),
    subject: input.subject.trim(),
    body: input.body.replace(/\r\n/g, '\n').trim(),
    attachments: [...input.attachments]
      .map((a) => ({ document_id: a.document_id, version: a.version, sha256: a.sha256 }))
      .sort((a, b) => (a.document_id < b.document_id ? -1 : 1)),
  });
}

export function getOutreach(ws: Workspace, outreachId: string): OutreachRow {
  const row = ws.db.get<OutreachRow>('SELECT * FROM outreach WHERE id = ?', outreachId);
  if (!row) throw new AppError('not_found', `Unknown draft: ${outreachId}`, { outreachId });
  return row;
}

function draftBody(input: {
  outreachId: string;
  personId: string;
  programId: string | null;
  body: string;
  supportingLinks: { label: string; vaultPath: string }[];
  attachments: AttachmentRef[];
  contactRequirements: ContactRequirement[];
  timingNote: string;
}): string {
  const draftPath = canonicalPathFor('outreach', input.outreachId) as string;
  const links = input.supportingLinks
    .map((link) => `- ${markdownLink(link.label, draftPath, link.vaultPath)}`)
    .join('\n');
  const attachments =
    input.attachments.length === 0
      ? '- No attachments selected. Attachments default to none until you choose them.'
      : input.attachments
          .map((a) => `- ${a.filename} (${a.document_id} v${a.version}, sha256 ${a.sha256.slice(0, 12)}…)`)
          .join('\n');
  const requirements =
    input.contactRequirements.length === 0
      ? '- No specific contact requirements were recorded for this recipient.'
      : input.contactRequirements
          .map((r) => `- [${r.satisfied}] ${r.requirement}${r.source_id ? ` (source: ${r.source_id})` : ''}`)
          .join('\n');

  return `# Outreach draft

## Message body

Everything between the markers is the message you copy into your mail client. Nothing here is sent automatically.

${BODY_BEGIN}
${input.body.replace(/^\n+|\n+$/g, '')}
${BODY_END}

## Selected attachments

${attachments}

## Recipient contact requirements

${requirements}

## Planned timing

${input.timingNote}

## Related records

${links || '- No supporting notes were linked.'}

- Evidence and personalisation rationale: ${markdownLink('Research brief', draftPath, outreachBriefPathFor(input.outreachId))}

## User notes

Manual notes belong here. They are preserved when the draft is regenerated and are never part of the message body.
`;
}

export interface CreateDraftInput {
  personId: string;
  purpose: string;
  programId?: string | null;
  campaign?: string;
  recipient: string;
  subject: string;
  body: string;
  attachments?: AttachmentRef[];
  contactRequirements?: ContactRequirement[];
  supportingLinks?: { label: string; vaultPath: string }[];
  briefMarkdown: string;
  timingNote?: string;
  applicantRevisionId?: string | null;
  styleRevisionId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  fencingToken?: number | null;
  actor?: string;
}

/**
 * One draft package per person, purpose, program and campaign. A second request
 * for the same combination returns the existing package instead of creating a
 * duplicate initial contact.
 */
export function createDraft(ws: Workspace, input: CreateDraftInput): { outreachId: string; created: boolean; state: string } {
  const person = requireEntity(ws, input.personId, 'person');
  const programId = input.programId ?? '';
  const campaign = input.campaign ?? 'default';

  const existing = ws.db.get<OutreachRow>(
    'SELECT * FROM outreach WHERE person_id = ? AND purpose = ? AND program_id = ? AND campaign = ?',
    person.id,
    input.purpose,
    programId,
    campaign,
  );
  if (existing) {
    return { outreachId: existing.id, created: false, state: existing.state };
  }

  const readiness = evaluateEmailReadiness(ws, person.id, { programId: input.programId ?? null });
  const conflict = readiness.issues.find((issue) => issue.code.startsWith('contact_conflict'));
  if (conflict) {
    throw new AppError('contact_conflict', conflict.message, {
      personId: person.id,
      code: conflict.code,
      resolution:
        'Record the resolution on the person note (contact_rule) or choose the documented channel. A public address does not override a stated instruction.',
    });
  }

  const outreachId = nextEntityId(ws.db, 'outreach');
  const draftPath = canonicalPathFor('outreach', outreachId) as string;
  const briefPath = outreachBriefPathFor(outreachId);
  const attachments = (input.attachments ?? []).map((attachment) => {
    const version = getDocumentVersion(ws, attachment.document_id, attachment.version);
    return {
      document_id: attachment.document_id,
      version: version.version,
      filename: version.original_filename,
      sha256: version.sha256,
    };
  });

  const contentFingerprint = draftFingerprint({
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    attachments,
  });

  const body = draftBody({
    outreachId,
    personId: person.id,
    programId: input.programId ?? null,
    body: input.body,
    supportingLinks: input.supportingLinks ?? [],
    attachments,
    contactRequirements: input.contactRequirements ?? [],
    timingNote:
      input.timingNote ??
      'No planned time has been chosen yet. Use the send planner to pick a recipient-local time; passing that time never sends anything.',
  });

  const briefText = `---
schema_version: ${NOTE_SCHEMA_VERSION}
id: ${outreachId}-brief
type: outreach_brief
title: Research brief for ${person.display_title}
outreach_id: ${outreachId}
person_id: ${person.id}
revision: 1
checked_at: ${todayIso()}
---

${input.briefMarkdown.replace(/^\n+/, '')}
`;

  const dbOps: DbOp[] = [
    {
      kind: 'outreach.upsert',
      payload: {
        id: outreachId,
        personId: person.id,
        purpose: input.purpose,
        programId,
        campaign,
        state: 'draft',
        currentRevision: 1,
        draftPath: vaultFilePath(draftPath),
        briefPath: vaultFilePath(briefPath),
        contactConflict: null,
      },
    },
    {
      kind: 'outreach.revision',
      payload: {
        outreachId,
        revision: 1,
        recipient: input.recipient,
        subject: input.subject,
        bodySha256: sha256Text(input.body),
        bodyPath: vaultFilePath(draftPath),
        attachments,
        fingerprint: contentFingerprint,
        applicantRevisionId: input.applicantRevisionId ?? readiness.approvedApplicantRevisionId,
        styleRevisionId: input.styleRevisionId ?? readiness.styleRevisionId,
        contactRequirements: input.contactRequirements ?? [],
        source: 'core',
      },
    },
    {
      kind: 'note.revision',
      payload: {
        path: vaultFilePath(briefPath),
        entityId: outreachId,
        noteType: 'outreach_brief',
        title: `Research brief for ${person.display_title}`,
        schemaVersion: NOTE_SCHEMA_VERSION,
        sha256: sha256Text(briefText),
        size: Buffer.byteLength(briefText, 'utf8'),
        source: 'core',
        frontmatter: { id: `${outreachId}-brief`, type: 'outreach_brief', outreach_id: outreachId },
        bodyText: briefText,
        protectedBlocks: {},
        checkedAt: todayIso(),
      },
    },
  ];

  writeNote(ws, {
    vaultPath: draftPath,
    entityId: outreachId,
    frontmatter: {
      id: outreachId,
      type: 'outreach_draft',
      title: `Outreach to ${person.display_title}`,
      outreach_id: outreachId,
      person_id: person.id,
      program_id: input.programId ?? undefined,
      purpose: input.purpose,
      campaign,
      recipient: input.recipient,
      subject: input.subject,
      state: 'draft',
      attachments,
      applicant_revision_id: input.applicantRevisionId ?? readiness.approvedApplicantRevisionId ?? undefined,
      style_revision_id: input.styleRevisionId ?? readiness.styleRevisionId ?? undefined,
      contact_requirements: input.contactRequirements ?? [],
      revision: 1,
      checked_at: todayIso(),
    },
    body,
    expectedSha: null,
    source: 'worker',
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    fencingToken: input.fencingToken ?? null,
    description: `create outreach draft ${outreachId}`,
    extraFiles: [{ path: vaultFilePath(briefPath), content: briefText, expectedPrior: null }],
    extraDbOps: dbOps,
  });

  ws.db.run(
    `INSERT INTO entities (id, kind, canonical_path, display_title, identity_confidence, created_at, updated_at)
     VALUES (?, 'outreach', ?, ?, 'verified', ?, ?) ON CONFLICT(id) DO NOTHING`,
    outreachId,
    draftPath,
    `Outreach to ${person.display_title}`,
    nowIso(),
    nowIso(),
  );

  recordAudit(ws.db, input.actor ?? 'core', 'outreach.create', outreachId, { personId: person.id, purpose: input.purpose });
  emitEvent(ws.db, 'outreach:created', outreachId, { personId: person.id });
  return { outreachId, created: true, state: 'draft' };
}

/** Read the draft as it exists on disk right now. */
export function readDraft(ws: Workspace, outreachId: string): DraftContent {
  const row = getOutreach(ws, outreachId);
  const vaultPath = row.draft_path.replace(/^vault\//, '');
  const file = readNoteFile(ws, vaultPath);
  if (!file.exists) throw new AppError('not_found', `Draft file missing: ${row.draft_path}`, { outreachId });
  const frontmatter = file.parsed.frontmatter as Record<string, unknown>;
  const attachments = (frontmatter['attachments'] as AttachmentRef[] | undefined) ?? [];
  const body = extractBody(file.parsed.body);
  return {
    recipient: String(frontmatter['recipient'] ?? ''),
    subject: String(frontmatter['subject'] ?? ''),
    body,
    attachments,
    contactRequirements: (frontmatter['contact_requirements'] as ContactRequirement[] | undefined) ?? [],
    fingerprint: draftFingerprint({
      recipient: String(frontmatter['recipient'] ?? ''),
      subject: String(frontmatter['subject'] ?? ''),
      body,
      attachments,
    }),
    sha256: file.sha256,
    vaultPath,
  };
}

export interface ReconcileDraftResult {
  outreachId: string;
  changed: boolean;
  revision: number;
  fingerprint: string;
  state: OutreachRow['state'];
  approvalInvalidated: boolean;
  reason?: string;
}

/**
 * Recompute the draft fingerprint from the file on disk before the package is
 * shown as ready, approved, or recorded as sent. A watcher is a convenience;
 * this check is the actual protection against a stale approval.
 */
export function reconcileDraft(ws: Workspace, outreachId: string): ReconcileDraftResult {
  const row = getOutreach(ws, outreachId);
  const content = readDraft(ws, outreachId);
  const latest = ws.db.get<{ revision: number; fingerprint: string }>(
    'SELECT revision, fingerprint FROM outreach_revisions WHERE outreach_id = ? ORDER BY revision DESC LIMIT 1',
    outreachId,
  );

  if (latest && latest.fingerprint === content.fingerprint) {
    return {
      outreachId,
      changed: false,
      revision: latest.revision,
      fingerprint: content.fingerprint,
      state: row.state,
      approvalInvalidated: false,
    };
  }

  return ws.db.transaction(() => {
    const revision = (latest?.revision ?? 0) + 1;
    ws.db.run(
      `INSERT INTO outreach_revisions (id, outreach_id, revision, recipient, subject, body_sha256, body_path,
                                       attachments_json, fingerprint, contact_requirements_json, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?)`,
      `orev-${content.fingerprint.slice(0, 24)}`,
      outreachId,
      revision,
      content.recipient,
      content.subject,
      sha256Text(content.body),
      row.draft_path,
      JSON.stringify(content.attachments),
      content.fingerprint,
      JSON.stringify(content.contactRequirements),
      nowIso(),
    );

    let approvalInvalidated = false;
    let reason: string | undefined;
    if (row.state === 'approved') {
      const approval = ws.db.get<{ id: string; fingerprint: string }>(
        'SELECT id, fingerprint FROM approvals WHERE outreach_id = ? AND invalidated_at IS NULL ORDER BY approved_at DESC LIMIT 1',
        outreachId,
      );
      if (approval && approval.fingerprint !== content.fingerprint) {
        reason = 'The recipient, subject, body or attachment set changed after approval.';
        ws.db.run(
          'UPDATE approvals SET invalidated_at = ?, invalidated_reason = ? WHERE id = ?',
          nowIso(),
          reason,
          approval.id,
        );
        approvalInvalidated = true;
      }
    }

    const nextState: OutreachRow['state'] =
      row.state === 'sent' ? 'sent' : row.state === 'archived' ? 'archived' : approvalInvalidated ? 'needs_review' : row.state;

    ws.db.run(
      'UPDATE outreach SET current_revision = ?, state = ?, updated_at = ? WHERE id = ?',
      revision,
      nextState,
      nowIso(),
      outreachId,
    );
    if (approvalInvalidated) {
      recordAudit(ws.db, 'core', 'outreach.approval_invalidated', outreachId, { revision, reason });
      emitEvent(ws.db, 'outreach:approval_invalidated', outreachId, { revision, reason });
    }
    return {
      outreachId,
      changed: true,
      revision,
      fingerprint: content.fingerprint,
      state: nextState,
      approvalInvalidated,
      reason,
    };
  });
}

export interface UpdateDraftInput {
  outreachId: string;
  expectedSha: string;
  recipient?: string;
  subject?: string;
  body?: string;
  attachments?: { document_id: string; version?: number }[];
  actor?: string;
}

/** Edit the draft through the core so the revision, fingerprint and approval rules all apply. */
export function updateDraft(ws: Workspace, input: UpdateDraftInput): ReconcileDraftResult {
  const row = getOutreach(ws, input.outreachId);
  if (row.state === 'sent') {
    throw new AppError('state_violation', 'A sent message is an immutable record. Create a new draft instead.', {
      outreachId: input.outreachId,
    });
  }
  const vaultPath = row.draft_path.replace(/^vault\//, '');
  const file = readNoteFile(ws, vaultPath);
  if (file.sha256 !== input.expectedSha) {
    throw new AppError('revision_conflict', 'The draft changed on disk since it was loaded.', {
      expected: input.expectedSha,
      actual: file.sha256,
    });
  }

  const frontmatter = { ...(file.parsed.frontmatter as Record<string, unknown>) };
  if (input.recipient !== undefined) frontmatter['recipient'] = input.recipient;
  if (input.subject !== undefined) frontmatter['subject'] = input.subject;
  if (input.attachments !== undefined) {
    frontmatter['attachments'] = input.attachments.map((attachment) => {
      const version = getDocumentVersion(ws, attachment.document_id, attachment.version);
      return {
        document_id: attachment.document_id,
        version: version.version,
        filename: version.original_filename,
        sha256: version.sha256,
      };
    });
  }

  let body = file.parsed.body;
  if (input.body !== undefined) {
    const start = body.indexOf(BODY_BEGIN);
    const end = body.indexOf(BODY_END);
    if (start === -1 || end === -1) throw new AppError('invalid_input', 'Draft body markers are missing.', {});
    body = `${body.slice(0, start + BODY_BEGIN.length)}\n${input.body.replace(/^\n+|\n+$/g, '')}\n${body.slice(end)}`;
  }

  frontmatter['revision'] = Number(frontmatter['revision'] ?? 1) + 1;
  writeNote(ws, {
    vaultPath,
    entityId: input.outreachId,
    frontmatter,
    body,
    expectedSha: input.expectedSha,
    source: 'user',
    description: `edit outreach draft ${input.outreachId}`,
    actor: input.actor ?? 'user',
  });
  return reconcileDraft(ws, input.outreachId);
}

export function listOutreach(
  ws: Workspace,
  filter: { state?: string; personId?: string; universityId?: string } = {},
): Record<string, unknown>[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.state) {
    clauses.push('o.state = ?');
    params.push(filter.state);
  }
  if (filter.personId) {
    clauses.push('o.person_id = ?');
    params.push(filter.personId);
  }
  if (filter.universityId) {
    const fragment = outreachInUniversity('o');
    clauses.push(fragment.sql);
    params.push(...bind(fragment, filter.universityId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return ws.db.all(
    `SELECT o.*, e.display_title AS person_title,
            (SELECT fingerprint FROM outreach_revisions r WHERE r.outreach_id = o.id ORDER BY revision DESC LIMIT 1) AS current_fingerprint,
            (SELECT COUNT(*) FROM sent_events s WHERE s.outreach_id = o.id) AS sent_count
     FROM outreach o LEFT JOIN entities e ON e.id = o.person_id
     ${where} ORDER BY o.updated_at DESC`,
    ...params,
  );
}
