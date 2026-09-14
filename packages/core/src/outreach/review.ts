import type { Workspace } from '../workspace.js';
import { AppError } from '../util/errors.js';
import { nowIso } from '../util/time.js';
import { opaqueId } from '../util/ids.js';
import { emitEvent, recordAudit } from '../util/events.js';
import { evaluateEmailReadiness, type ReadinessIssue } from '../readiness.js';
import { getOutreach, readDraft, reconcileDraft, type OutreachRow } from './drafts.js';

export interface ValidationReport {
  outreachId: string;
  state: OutreachRow['state'];
  fingerprint: string;
  issues: ReadinessIssue[];
  ready: boolean;
}

/**
 * Validate a package and move it to needs_review. The draft body, recipient and
 * attachments are read from disk first so validation never runs on stale data.
 */
export function validateDraftPackage(ws: Workspace, outreachId: string): ValidationReport {
  const row = getOutreach(ws, outreachId);
  reconcileDraft(ws, outreachId);
  const content = readDraft(ws, outreachId);
  const readiness = evaluateEmailReadiness(ws, row.person_id, {
    programId: row.program_id || null,
    stage: 'draft',
  });
  const issues: ReadinessIssue[] = [...readiness.issues];

  if (content.recipient.trim() === '') {
    issues.push({ code: 'recipient_empty', message: 'The draft has no recipient address.', severity: 'blocker' });
  }
  if (content.subject.trim() === '') {
    issues.push({ code: 'subject_empty', message: 'The draft has no subject line.', severity: 'blocker' });
  }
  if (content.body.trim().length < 40) {
    issues.push({ code: 'body_too_short', message: 'The message body looks empty or truncated.', severity: 'blocker' });
  }
  for (const requirement of content.contactRequirements) {
    if (requirement.satisfied === 'no') {
      issues.push({
        code: 'contact_requirement_unmet',
        message: `Documented contact requirement is not satisfied: ${requirement.requirement}`,
        severity: 'blocker',
      });
    } else if (requirement.satisfied === 'unknown') {
      issues.push({
        code: 'contact_requirement_unchecked',
        message: `Contact requirement has not been checked: ${requirement.requirement}`,
        severity: 'warning',
      });
    }
  }

  const ready = !issues.some((issue) => issue.severity === 'blocker');
  const nextState: OutreachRow['state'] =
    row.state === 'sent' || row.state === 'archived' ? row.state : ready ? 'needs_review' : 'draft';

  ws.db.run('UPDATE outreach SET state = ?, updated_at = ? WHERE id = ?', nextState, nowIso(), outreachId);
  emitEvent(ws.db, 'outreach:validated', outreachId, { ready, state: nextState });
  return { outreachId, state: nextState, fingerprint: content.fingerprint, issues, ready };
}

export interface ApproveInput {
  outreachId: string;
  /** The exact fingerprint the reviewer looked at. */
  expectedFingerprint: string;
  note?: string;
  actor?: string;
}

/**
 * Approval binds recipient, subject, exact body and attachment versions.
 * The file is re-read and re-fingerprinted immediately before recording it.
 */
export function approveDraft(ws: Workspace, input: ApproveInput): { approvalId: string; fingerprint: string; revision: number } {
  const reconciled = reconcileDraft(ws, input.outreachId);
  const row = getOutreach(ws, input.outreachId);
  if (row.state === 'sent') throw new AppError('state_violation', 'This message is already recorded as sent.', { outreachId: input.outreachId });
  if (row.state === 'archived') throw new AppError('state_violation', 'Unarchive the draft before approving it.', { outreachId: input.outreachId });

  const content = readDraft(ws, input.outreachId);
  if (content.fingerprint !== input.expectedFingerprint) {
    throw new AppError('revision_conflict', 'The draft changed since it was reviewed. Re-read the current version before approving.', {
      expected: input.expectedFingerprint,
      actual: content.fingerprint,
      reason: reconciled.reason,
    });
  }

  const readiness = evaluateEmailReadiness(ws, row.person_id, { programId: row.program_id || null, stage: 'approve' });
  const blockers = readiness.issues.filter((issue) => issue.severity === 'blocker');
  if (blockers.length > 0) {
    throw new AppError('dependency_blocked', 'This draft cannot be approved yet.', {
      issues: blockers,
    });
  }

  return ws.db.transaction(() => {
    const approvalId = opaqueId('approval');
    ws.db.run(
      `INSERT INTO approvals (id, outreach_id, revision, fingerprint, approved_at, approved_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      approvalId,
      input.outreachId,
      reconciled.revision,
      content.fingerprint,
      nowIso(),
      input.actor ?? 'user',
      input.note ?? null,
    );
    ws.db.run("UPDATE outreach SET state = 'approved', updated_at = ? WHERE id = ?", nowIso(), input.outreachId);
    recordAudit(ws.db, input.actor ?? 'user', 'outreach.approve', input.outreachId, {
      revision: reconciled.revision,
      fingerprint: content.fingerprint,
    });
    emitEvent(ws.db, 'outreach:approved', input.outreachId, { revision: reconciled.revision });
    return { approvalId, fingerprint: content.fingerprint, revision: reconciled.revision };
  });
}

export function returnToDraft(ws: Workspace, outreachId: string, reason: string, actor = 'user'): void {
  const row = getOutreach(ws, outreachId);
  if (row.state === 'sent') throw new AppError('state_violation', 'A sent message cannot be returned for editing.', { outreachId });
  ws.db.transaction(() => {
    ws.db.run(
      'UPDATE approvals SET invalidated_at = ?, invalidated_reason = ? WHERE outreach_id = ? AND invalidated_at IS NULL',
      nowIso(),
      reason,
      outreachId,
    );
    ws.db.run("UPDATE outreach SET state = 'draft', updated_at = ? WHERE id = ?", nowIso(), outreachId);
    recordAudit(ws.db, actor, 'outreach.return_to_draft', outreachId, { reason });
    emitEvent(ws.db, 'outreach:returned', outreachId, { reason });
  });
}

export function archiveDraft(ws: Workspace, outreachId: string, reason: string, actor = 'user'): void {
  const row = getOutreach(ws, outreachId);
  if (row.state === 'sent') throw new AppError('state_violation', 'Sent history is kept, not archived.', { outreachId });
  ws.db.run("UPDATE outreach SET state = 'archived', updated_at = ? WHERE id = ?", nowIso(), outreachId);
  recordAudit(ws.db, actor, 'outreach.archive', outreachId, { reason });
  emitEvent(ws.db, 'outreach:archived', outreachId, { reason });
}

export function unarchiveDraft(ws: Workspace, outreachId: string, actor = 'user'): void {
  ws.db.run("UPDATE outreach SET state = 'draft', updated_at = ? WHERE id = ?", nowIso(), outreachId);
  recordAudit(ws.db, actor, 'outreach.unarchive', outreachId, {});
}

export function approvalHistory(ws: Workspace, outreachId: string): Record<string, unknown>[] {
  return ws.db.all('SELECT * FROM approvals WHERE outreach_id = ? ORDER BY approved_at DESC', outreachId);
}

export function currentApproval(ws: Workspace, outreachId: string): { id: string; fingerprint: string; revision: number } | undefined {
  return ws.db.get<{ id: string; fingerprint: string; revision: number }>(
    'SELECT id, fingerprint, revision FROM approvals WHERE outreach_id = ? AND invalidated_at IS NULL ORDER BY approved_at DESC LIMIT 1',
    outreachId,
  );
}
