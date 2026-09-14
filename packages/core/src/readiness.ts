import type { Workspace } from './workspace.js';
import { daysBetween, nowIso } from './util/time.js';
import { canonicalPathFor, vaultFilePath } from './registry.js';

export interface ReadinessIssue {
  code: string;
  message: string;
  severity: 'blocker' | 'warning';
}

export interface EmailReadiness {
  personId: string;
  researchComplete: boolean;
  emailReady: boolean;
  recipient: string | null;
  contactRule: string;
  issues: ReadinessIssue[];
  approvedApplicantRevisionId: string | null;
  styleRevisionId: string | null;
}

export function approvedApplicantRevision(ws: Workspace, kind: 'profile' | 'style'): { id: string; revision: number; sha256: string } | undefined {
  return ws.db.get<{ id: string; revision: number; sha256: string }>(
    `SELECT id, revision, sha256 FROM applicant_revisions
     WHERE kind = ? AND approved_at IS NOT NULL ORDER BY revision DESC LIMIT 1`,
    kind,
  );
}

function claimCheckedAt(ws: Workspace, path: string, claimKey: string): string | undefined {
  return ws.db.get<{ checked_at: string | null }>(
    'SELECT checked_at FROM claim_index WHERE path = ? AND claim_key = ?',
    path,
    claimKey,
  )?.checked_at ?? undefined;
}

/**
 * Research completion and email readiness are separate gates.
 *
 * `stage: 'approve'` additionally requires that critical contact and program
 * facts are within their freshness window, because approval binds them.
 */
export function evaluateEmailReadiness(
  ws: Workspace,
  personId: string,
  options: { programId?: string | null; stage?: 'draft' | 'approve' } = {},
): EmailReadiness {
  const stage = options.stage ?? 'draft';
  const issues: ReadinessIssue[] = [];
  const person = ws.db.get<{
    entity_id: string;
    email: string | null;
    email_evidence: string | null;
    contact_rule: string | null;
    research_complete: number;
    timezone: string | null;
  }>('SELECT entity_id, email, email_evidence, contact_rule, research_complete, timezone FROM people WHERE entity_id = ?', personId);

  if (!person) {
    return {
      personId,
      researchComplete: false,
      emailReady: false,
      recipient: null,
      contactRule: 'unknown',
      issues: [{ code: 'person_unknown', message: `No person record for ${personId}`, severity: 'blocker' }],
      approvedApplicantRevisionId: null,
      styleRevisionId: null,
    };
  }

  const researchComplete = person.research_complete === 1;
  if (!researchComplete) {
    issues.push({
      code: 'research_incomplete',
      message: 'Job 5 has not marked this profile research_complete.',
      severity: 'blocker',
    });
  }

  const contactRule = person.contact_rule ?? 'unknown';
  if (contactRule === 'do_not_email') {
    issues.push({
      code: 'contact_conflict_do_not_email',
      message:
        'This person publicly asks not to be emailed. Resolve the contact conflict before preparing ordinary outreach; a visible address does not override the instruction.',
      severity: 'blocker',
    });
  } else if (contactRule === 'portal_only') {
    issues.push({
      code: 'contact_conflict_portal_only',
      message:
        'This person directs applicants to an application portal. Resolve the contact conflict before preparing ordinary outreach.',
      severity: 'blocker',
    });
  } else if (contactRule === 'unknown') {
    issues.push({
      code: 'contact_route_unknown',
      message: 'No documented contact instruction was found. Record the contact route before approval.',
      severity: stage === 'approve' ? 'blocker' : 'warning',
    });
  }

  if (!person.email) {
    issues.push({ code: 'recipient_missing', message: 'No professional email address is recorded.', severity: 'blocker' });
  } else if (person.email_evidence !== 'confirmed') {
    issues.push({
      code: 'recipient_unverified',
      message: `The recipient address is recorded as ${person.email_evidence ?? 'unknown'} rather than confirmed.`,
      severity: 'blocker',
    });
  }

  const applicant = approvedApplicantRevision(ws, 'profile');
  if (!applicant) {
    issues.push({
      code: 'applicant_profile_not_approved',
      message: 'No approved applicant profile revision exists. Approve applicant/profile.md before factual claims are used.',
      severity: 'blocker',
    });
  }
  const style = approvedApplicantRevision(ws, 'style');
  if (!style) {
    issues.push({
      code: 'email_style_not_approved',
      message: 'No approved email-style revision; drafting will use the current file without a bound version.',
      severity: 'warning',
    });
  }

  const personPath = vaultFilePath(canonicalPathFor('person', personId) as string);
  const contactChecked = claimCheckedAt(ws, personPath, 'contact_instructions');
  if (!contactChecked) {
    issues.push({
      code: 'contact_instructions_unrecorded',
      message: 'Contact instructions have no recorded check date.',
      severity: stage === 'approve' ? 'blocker' : 'warning',
    });
  } else if (daysBetween(contactChecked, nowIso()) > ws.config.freshness.contactDays) {
    issues.push({
      code: 'contact_instructions_stale',
      message: `Contact instructions were last checked ${Math.round(daysBetween(contactChecked, nowIso()))} days ago (limit ${ws.config.freshness.contactDays}).`,
      severity: stage === 'approve' ? 'blocker' : 'warning',
    });
  }

  if (options.programId) {
    const programPath = vaultFilePath(canonicalPathFor('program', options.programId) as string);
    const exists = ws.db.get<{ path: string }>('SELECT path FROM note_index WHERE path = ?', programPath);
    if (!exists) {
      issues.push({
        code: 'program_note_missing',
        message: `The message relies on ${options.programId}, which has no committed program note.`,
        severity: 'blocker',
      });
    } else {
      const checked = claimCheckedAt(ws, programPath, 'application_requirements');
      if (!checked) {
        issues.push({
          code: 'program_facts_unrecorded',
          message: `Application requirements for ${options.programId} have no recorded check date.`,
          severity: stage === 'approve' ? 'blocker' : 'warning',
        });
      } else if (daysBetween(checked, nowIso()) > ws.config.freshness.programFactsDays) {
        issues.push({
          code: 'program_facts_stale',
          message: `Program facts were last checked ${Math.round(daysBetween(checked, nowIso()))} days ago (limit ${ws.config.freshness.programFactsDays}).`,
          severity: stage === 'approve' ? 'blocker' : 'warning',
        });
      }
    }
  }

  const emailReady = researchComplete && !issues.some((issue) => issue.severity === 'blocker');
  return {
    personId,
    researchComplete,
    emailReady,
    recipient: person.email,
    contactRule,
    issues,
    approvedApplicantRevisionId: applicant?.id ?? null,
    styleRevisionId: style?.id ?? null,
  };
}

/** Persist the derived readiness flags so queue filters and the UI stay in step. */
export function refreshPersonReadiness(ws: Workspace, personId: string): EmailReadiness {
  const readiness = evaluateEmailReadiness(ws, personId);
  ws.db.run(
    'UPDATE people SET email_ready = ?, readiness_detail = ?, updated_at = ? WHERE entity_id = ?',
    readiness.emailReady ? 1 : 0,
    JSON.stringify(readiness.issues),
    nowIso(),
    personId,
  );
  return readiness;
}
