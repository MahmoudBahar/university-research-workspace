import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Workspace } from '../workspace.js';
import { bind, outreachInUniversity } from '../util/universityFilter.js';
import { AppError } from '../util/errors.js';
import { opaqueId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { sha256Text } from '../util/hash.js';
import { ensureDir, toPosix } from '../util/fsx.js';
import { emitEvent, recordAudit } from '../util/events.js';
import { getOutreach, readDraft, reconcileDraft } from './drafts.js';
import { currentApproval } from './review.js';
import { dueState, renderInZone, resolveLocalTime, suggestSendWindow, wallIntentDrift, type Disambiguation, type DueState, type ZoneRendering } from '../time/planner.js';
import { systemTimeZone } from '../time/temporal.js';

export interface SendPlanRow {
  id: string;
  outreach_id: string;
  local_date: string;
  local_time: string;
  recipient_zone: string;
  zone_basis: string;
  disambiguation: string | null;
  utc_instant: string;
  display_zone: string;
  original_wall_intent: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export function displayZone(ws: Workspace): string {
  const configured = ws.config.timing.displayZone;
  return configured && configured !== 'auto' ? configured : systemTimeZone();
}

export interface SetSendPlanInput {
  outreachId: string;
  date: string;
  time: string;
  zone?: string;
  disambiguation?: Disambiguation;
  note?: string;
  actor?: string;
}

/**
 * Record when the user intends to send. This is a plan, not a scheduler: no
 * process wakes up at this time and nothing is transmitted.
 */
export function setSendPlan(ws: Workspace, input: SetSendPlanInput): SendPlanRow & { rendering: Record<string, unknown> } {
  const row = getOutreach(ws, input.outreachId);
  const person = ws.db.get<{ timezone: string | null; timezone_basis: string | null }>(
    'SELECT timezone, timezone_basis FROM people WHERE entity_id = ?',
    row.person_id,
  );
  const zone = input.zone ?? person?.timezone ?? undefined;
  if (!zone) {
    throw new AppError('invalid_input', 'No recipient time zone is known. Supply an explicit zone override before planning a time.', {
      outreachId: input.outreachId,
      code: 'zone_unknown',
    });
  }
  const zoneBasis = input.zone && input.zone !== person?.timezone ? 'user_override' : person?.timezone_basis ?? 'unknown';
  const resolved = resolveLocalTime({ date: input.date, time: input.time, zone, disambiguation: input.disambiguation });

  return ws.db.transaction(() => {
    ws.db.run('UPDATE send_plans SET cancelled_at = ? WHERE outreach_id = ? AND cancelled_at IS NULL', nowIso(), input.outreachId);
    const id = opaqueId('plan');
    const display = displayZone(ws);
    ws.db.run(
      `INSERT INTO send_plans (id, outreach_id, local_date, local_time, recipient_zone, zone_basis, disambiguation,
                               utc_instant, display_zone, original_wall_intent, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.outreachId,
      resolved.localDate,
      resolved.localTime,
      zone,
      zoneBasis,
      resolved.disambiguation,
      resolved.utcInstant,
      display,
      `${resolved.localDate}T${resolved.localTime}[${zone}]`,
      input.note ?? null,
      nowIso(),
      nowIso(),
    );
    recordAudit(ws.db, input.actor ?? 'user', 'outreach.send_plan', input.outreachId, {
      localDate: resolved.localDate,
      localTime: resolved.localTime,
      zone,
      utcInstant: resolved.utcInstant,
    });
    emitEvent(ws.db, 'outreach:send_plan', input.outreachId, { utcInstant: resolved.utcInstant });
    const plan = ws.db.get<SendPlanRow>('SELECT * FROM send_plans WHERE id = ?', id) as SendPlanRow;
    return {
      ...plan,
      rendering: {
        recipient: renderInZone(plan.utc_instant, plan.recipient_zone),
        display: renderInZone(plan.utc_instant, display),
        zoneBasisNote:
          zoneBasis === 'campus_inferred'
            ? 'The zone is inferred from the institutional campus location; it does not describe where the person is right now.'
            : zoneBasis === 'user_override'
              ? 'Zone supplied by you as an override.'
              : zoneBasis === 'directly_stated'
                ? 'Zone taken from a directly stated source.'
                : 'Zone basis unknown.',
      },
    };
  });
}

export function activeSendPlan(ws: Workspace, outreachId: string): SendPlanRow | undefined {
  return ws.db.get<SendPlanRow>(
    'SELECT * FROM send_plans WHERE outreach_id = ? AND cancelled_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1',
    outreachId,
  );
}

export interface PlannerRow {
  outreachId: string;
  personTitle: string | null;
  state: string;
  plan: SendPlanRow | null;
  due: DueState | null;
  recipientRendering: ZoneRendering | null;
  displayRendering: ZoneRendering | null;
  drift: { drifted: boolean; recomputedInstant: string | null; reason?: string } | null;
  sent: boolean;
}

/** Due and overdue are recalculated from stored times every time this is called. */
export function sendPlanner(ws: Workspace, now: Date = new Date(), filter: { universityId?: string } = {}): PlannerRow[] {
  const fragment = filter.universityId ? outreachInUniversity('o') : null;
  const rows = ws.db.all<{ id: string; state: string; person_title: string | null; sent_count: number }>(
    `SELECT o.id, o.state, e.display_title AS person_title,
            (SELECT COUNT(*) FROM sent_events s WHERE s.outreach_id = o.id) AS sent_count
     FROM outreach o LEFT JOIN entities e ON e.id = o.person_id
     WHERE o.state != 'archived' ${fragment ? `AND ${fragment.sql}` : ''} ORDER BY o.updated_at DESC`,
    ...(fragment ? bind(fragment, filter.universityId as string) : []),
  );
  const display = displayZone(ws);
  return rows.map((row) => {
    const plan = activeSendPlan(ws, row.id) ?? null;
    return {
      outreachId: row.id,
      personTitle: row.person_title,
      state: row.state,
      plan,
      due: plan && row.sent_count === 0 ? dueState(plan.utc_instant, now) : null,
      recipientRendering: plan ? renderInZone(plan.utc_instant, plan.recipient_zone) : null,
      displayRendering: plan ? renderInZone(plan.utc_instant, display) : null,
      drift: plan ? wallIntentDrift(plan) : null,
      sent: row.sent_count > 0,
    };
  });
}

export function suggestPlan(ws: Workspace, outreachId: string): Record<string, unknown> {
  const row = getOutreach(ws, outreachId);
  const person = ws.db.get<{ timezone: string | null; timezone_basis: string | null }>(
    'SELECT timezone, timezone_basis FROM people WHERE entity_id = ?',
    row.person_id,
  );
  if (!person?.timezone) {
    return {
      available: false,
      reason:
        'No IANA zone is recorded for this recipient. Choose an explicit zone override before a local time can be converted.',
    };
  }
  const suggestion = suggestSendWindow(person.timezone, {
    startHour: ws.config.timing.suggestStartHour,
    endHour: ws.config.timing.suggestEndHour,
    weekdaysOnly: ws.config.timing.weekdaysOnly,
  });
  return {
    available: true,
    ...suggestion,
    zoneBasis: person.timezone_basis ?? 'unknown',
    display: renderInZone(suggestion.utcInstant, displayZone(ws)),
  };
}

export interface MarkSentInput {
  outreachId: string;
  idempotencyKey: string;
  sentAt?: string;
  messageReference?: string;
  note?: string;
  /** Required to record a send of content that was never approved. */
  allowUnapproved?: boolean;
  actor?: string;
}

export interface SentEventRow {
  id: string;
  outreach_id: string;
  idempotency_key: string;
  sent_at_utc: string;
  snapshot_revision: number;
  snapshot_sha256: string;
  snapshot_path: string;
  recipient: string;
  subject: string;
  attachments_json: string;
  was_approved: number;
  approval_id: string | null;
  source: string;
  message_reference: string | null;
  note: string | null;
  created_at: string;
}

/**
 * Record a message the user actually sent from their own mail client.
 *
 * Nothing here transmits anything, and nothing about it implies delivery,
 * reading or a reply. The recorded snapshot is the content as it stood on disk
 * at the moment of reporting.
 */
export function markSent(ws: Workspace, input: MarkSentInput): { event: SentEventRow; duplicate: boolean } {
  const byKey = (): SentEventRow | undefined =>
    ws.db.get<SentEventRow>('SELECT * FROM sent_events WHERE idempotency_key = ?', input.idempotencyKey);
  const existing = byKey();
  if (existing) return { event: existing, duplicate: true };

  reconcileDraft(ws, input.outreachId);
  const row = getOutreach(ws, input.outreachId);
  const content = readDraft(ws, input.outreachId);
  const approval = currentApproval(ws, input.outreachId);
  const wasApproved = Boolean(approval && approval.fingerprint === content.fingerprint);

  if (!wasApproved && !input.allowUnapproved) {
    throw new AppError(
      'state_violation',
      'This exact content is not approved. Approve it first, or record an external send to log a message you already sent.',
      {
        outreachId: input.outreachId,
        currentFingerprint: content.fingerprint,
        approvedFingerprint: approval?.fingerprint ?? null,
      },
    );
  }

  try {
    return ws.db.transaction(() => {
    // Re-checked inside the write transaction: two concurrent reports with the
    // same key cannot both pass the check above.
    const raced = byKey();
    if (raced) return { event: raced, duplicate: true };
    const snapshotDir = join(ws.paths.revisions, 'sent');
    ensureDir(snapshotDir);
    const draftAbsolute = join(ws.paths.vault, ...content.vaultPath.split('/'));
    const snapshotText = existsSync(draftAbsolute) ? readFileSync(draftAbsolute, 'utf8') : '';
    const snapshotSha = sha256Text(snapshotText);
    const snapshotFile = join(snapshotDir, `${input.outreachId}-${snapshotSha.slice(0, 16)}.md`);
    if (!existsSync(snapshotFile)) writeFileSync(snapshotFile, snapshotText, 'utf8');

    const id = opaqueId('sent');
    const sentAt = input.sentAt ?? nowIso();
    ws.db.run(
      `INSERT INTO sent_events (id, outreach_id, idempotency_key, sent_at_utc, snapshot_revision, snapshot_sha256,
                                snapshot_path, recipient, subject, attachments_json, was_approved, approval_id,
                                source, message_reference, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user_reported', ?, ?, ?)`,
      id,
      input.outreachId,
      input.idempotencyKey,
      sentAt,
      row.current_revision,
      snapshotSha,
      toPosix(join('data', 'revisions', 'sent', `${input.outreachId}-${snapshotSha.slice(0, 16)}.md`)),
      content.recipient,
      content.subject,
      JSON.stringify(content.attachments),
      wasApproved ? 1 : 0,
      approval?.id ?? null,
      input.messageReference ?? null,
      input.note ?? null,
      nowIso(),
    );
    ws.db.run("UPDATE outreach SET state = 'sent', updated_at = ? WHERE id = ?", nowIso(), input.outreachId);
    recordAudit(ws.db, input.actor ?? 'user', wasApproved ? 'outreach.mark_sent' : 'outreach.record_external_send', input.outreachId, {
      idempotencyKey: input.idempotencyKey,
      wasApproved,
      sentAt,
    });
    emitEvent(ws.db, 'outreach:sent', input.outreachId, { wasApproved, sentAt });
    return { event: ws.db.get<SentEventRow>('SELECT * FROM sent_events WHERE id = ?', id) as SentEventRow, duplicate: false };
    });
  } catch (error) {
    // A UNIQUE violation on idempotency_key means the other writer won; the
    // caller still gets the one recorded event rather than a raw driver error.
    if (/UNIQUE constraint failed: sent_events\.idempotency_key/i.test(String((error as Error)?.message ?? error))) {
      const winner = byKey();
      if (winner) return { event: winner, duplicate: true };
    }
    throw error;
  }
}

/** Corrections never rewrite a snapshot; they append an auditable event. */
export function correctSentRecord(
  ws: Workspace,
  sentEventId: string,
  correction: { field: string; value: string; reason: string; actor?: string },
): { auditId: string } {
  const event = ws.db.get<SentEventRow>('SELECT * FROM sent_events WHERE id = ?', sentEventId);
  if (!event) throw new AppError('not_found', `Unknown sent event: ${sentEventId}`, { sentEventId });
  const auditId = recordAudit(ws.db, correction.actor ?? 'user', 'outreach.sent_correction', event.outreach_id, {
    sentEventId,
    field: correction.field,
    value: correction.value,
    reason: correction.reason,
  });
  emitEvent(ws.db, 'outreach:sent_corrected', event.outreach_id, { sentEventId, field: correction.field });
  return { auditId };
}

export function sentHistory(ws: Workspace, outreachId?: string, filter: { universityId?: string } = {}): Record<string, unknown>[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (outreachId) {
    clauses.push('s.outreach_id = ?');
    params.push(outreachId);
  }
  if (filter.universityId) {
    const fragment = outreachInUniversity('o');
    clauses.push(fragment.sql);
    params.push(...bind(fragment, filter.universityId));
  }
  const rows = ws.db.all(
    `SELECT s.* FROM sent_events s JOIN outreach o ON o.id = s.outreach_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY s.sent_at_utc DESC`,
    ...params,
  );
  return rows.map((row) => ({
    ...row,
    corrections: ws.db.all(
      "SELECT * FROM audit_events WHERE action = 'outreach.sent_correction' AND entity_id = ? ORDER BY at ASC",
      String((row as { outreach_id: string }).outreach_id),
    ),
  }));
}

export function sentSnapshotText(ws: Workspace, sentEventId: string): string {
  const event = ws.db.get<SentEventRow>('SELECT * FROM sent_events WHERE id = ?', sentEventId);
  if (!event) throw new AppError('not_found', `Unknown sent event: ${sentEventId}`, { sentEventId });
  const absolute = join(ws.paths.root, ...event.snapshot_path.split('/'));
  if (!existsSync(absolute)) throw new AppError('not_found', 'Snapshot bytes are missing', { path: event.snapshot_path });
  return readFileSync(absolute, 'utf8');
}
