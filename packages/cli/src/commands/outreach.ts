import { readFileSync } from 'node:fs';
import {
  approveDraft,
  archiveDraft,
  correctSentRecord,
  createDraft,
  listOutreach,
  markSent,
  readDraft,
  reconcileDraft,
  returnToDraft,
  sendPlanner,
  sentHistory,
  setSendPlan,
  suggestPlan,
  unarchiveDraft,
  updateDraft,
  validateDraftPackage,
  approvalHistory,
  activeSendPlan,
} from '@urw/core';
import type { CommandSpec } from '../context.js';
import { emit, table, truncate } from '../output.js';
import { flagBool, flagString, requireFlag } from '../args.js';

export const outreachCommands: Record<string, CommandSpec> = {
  'drafts list': {
    summary: 'List outreach drafts with their review state.',
    usage: 'drafts list [--state <state>] [--person <id>] [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = listOutreach(ws, { state: flagString(ctx.args, 'state'), personId: flagString(ctx.args, 'person') });
      emit(
        ctx.out,
        table(
          rows.map((row) => ({
            id: String(row['id']),
            person: truncate(row['person_title'], 26),
            state: String(row['state']),
            revision: String(row['current_revision']),
            sent: String(row['sent_count']),
          })),
          ['id', 'person', 'state', 'revision', 'sent'],
        ),
        rows,
      );
    },
  },

  'drafts show': {
    summary: 'Show the current draft content and its fingerprint.',
    usage: 'drafts show --draft <id> [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const id = requireFlag(ctx.args, 'draft');
      reconcileDraft(ws, id);
      const content = readDraft(ws, id);
      const plan = activeSendPlan(ws, id);
      emit(
        ctx.out,
        [
          `To: ${content.recipient}`,
          `Subject: ${content.subject}`,
          `Fingerprint: ${content.fingerprint}`,
          `Attachments: ${content.attachments.length === 0 ? 'none' : content.attachments.map((a) => `${a.filename} (${a.document_id} v${a.version})`).join(', ')}`,
          plan ? `Planned: ${plan.local_date} ${plan.local_time} ${plan.recipient_zone} (${plan.utc_instant})` : 'Planned: not scheduled',
          '',
          '--- message body ---',
          content.body,
          '--- end body ---',
        ],
        { content, plan },
      );
    },
  },

  'drafts create': {
    summary: 'Create a draft package from a JSON file (used by the Job 7 worker or by hand).',
    usage: 'drafts create --file <path>',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const input = JSON.parse(readFileSync(requireFlag(ctx.args, 'file'), 'utf8')) as Record<string, unknown>;
      const created = createDraft(ws, {
        personId: String(input['person_id']),
        purpose: String(input['purpose'] ?? 'initial_contact'),
        programId: (input['program_id'] as string | null) ?? null,
        campaign: String(input['campaign'] ?? 'default'),
        recipient: String(input['recipient']),
        subject: String(input['subject']),
        body: String(input['body']),
        attachments: ((input['attachments'] as { document_id: string; version?: number }[]) ?? []).map((a) => ({
          document_id: a.document_id,
          version: a.version ?? 0,
          filename: '',
          sha256: '',
        })),
        contactRequirements: (input['contact_requirements'] as never) ?? [],
        supportingLinks: ((input['supporting_links'] as { label: string; vault_path: string }[]) ?? []).map((l) => ({
          label: l.label,
          vaultPath: l.vault_path,
        })),
        briefMarkdown: String(input['brief'] ?? 'No brief supplied.'),
        timingNote: input['timing_note'] as string | undefined,
        actor: 'user',
      });
      const validation = validateDraftPackage(ws, created.outreachId);
      emit(ctx.out, `Draft ${created.outreachId} (${created.created ? 'created' : 'existing'}) state=${validation.state}`, {
        ...created,
        validation,
      });
    },
  },

  'drafts edit': {
    summary: 'Edit recipient, subject, body or attachments through the core rules.',
    usage: 'drafts edit --draft <id> --expect-sha <sha> [--recipient <addr>] [--subject <text>] [--body-file <path>] [--attach doc-0001:2]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const bodyFile = flagString(ctx.args, 'bodyFile');
      const attachments = (ctx.args.flags['attach'] === undefined
        ? undefined
        : (Array.isArray(ctx.args.flags['attach']) ? ctx.args.flags['attach'] : [String(ctx.args.flags['attach'])]).map((spec) => {
            const [documentId, version] = spec.split(':');
            return { document_id: documentId as string, version: version ? Number(version) : undefined };
          })) as { document_id: string; version?: number }[] | undefined;
      const result = updateDraft(ws, {
        outreachId: requireFlag(ctx.args, 'draft'),
        expectedSha: requireFlag(ctx.args, 'expectSha'),
        recipient: flagString(ctx.args, 'recipient'),
        subject: flagString(ctx.args, 'subject'),
        body: bodyFile ? readFileSync(bodyFile, 'utf8') : undefined,
        attachments,
        actor: 'user',
      });
      emit(
        ctx.out,
        [
          `Draft revision ${result.revision}, fingerprint ${result.fingerprint}`,
          result.approvalInvalidated ? `Approval invalidated: ${result.reason}` : 'No approval was affected.',
        ],
        result,
      );
    },
  },

  'drafts validate': {
    summary: 'Re-read the draft from disk and validate the package.',
    usage: 'drafts validate --draft <id> [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const report = validateDraftPackage(ws, requireFlag(ctx.args, 'draft'));
      emit(
        ctx.out,
        [
          `State: ${report.state} (ready: ${report.ready ? 'yes' : 'no'})`,
          `Fingerprint: ${report.fingerprint}`,
          ...report.issues.map((issue) => `  [${issue.severity}] ${issue.code}: ${issue.message}`),
        ],
        report,
      );
      if (!report.ready) process.exitCode = 2;
    },
  },

  'drafts approve': {
    summary: 'Approve the exact revision you reviewed. Requires the current fingerprint.',
    usage: 'drafts approve --draft <id> --fingerprint <sha256> [--note <text>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = approveDraft(ws, {
        outreachId: requireFlag(ctx.args, 'draft'),
        expectedFingerprint: requireFlag(ctx.args, 'fingerprint'),
        note: flagString(ctx.args, 'note'),
        actor: 'user',
      });
      emit(ctx.out, `Approved revision ${result.revision} (${result.approvalId}).`, result);
    },
  },

  'drafts return': {
    summary: 'Return an approved draft for editing, invalidating the approval.',
    usage: 'drafts return --draft <id> --reason <text>',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      returnToDraft(ws, requireFlag(ctx.args, 'draft'), requireFlag(ctx.args, 'reason'));
      emit(ctx.out, 'Returned to draft.', { ok: true });
    },
  },

  'drafts archive': {
    summary: 'Archive a draft.',
    usage: 'drafts archive --draft <id> --reason <text> [--undo]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const id = requireFlag(ctx.args, 'draft');
      if (flagBool(ctx.args, 'undo')) {
        unarchiveDraft(ws, id);
        emit(ctx.out, 'Unarchived.', { ok: true });
        return;
      }
      archiveDraft(ws, id, requireFlag(ctx.args, 'reason'));
      emit(ctx.out, 'Archived.', { ok: true });
    },
  },

  'drafts history': {
    summary: 'Show approval history for a draft.',
    usage: 'drafts history --draft <id> [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = approvalHistory(ws, requireFlag(ctx.args, 'draft'));
      emit(ctx.out, table(rows, ['revision', 'fingerprint', 'approved_at', 'approved_by', 'invalidated_at', 'invalidated_reason']), rows);
    },
  },

  'send-plan suggest': {
    summary: 'Suggest an editable weekday working-hours window in the recipient zone.',
    usage: 'send-plan suggest --draft <id> [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const suggestion = suggestPlan(ws, requireFlag(ctx.args, 'draft'));
      emit(ctx.out, JSON.stringify(suggestion, null, 2), suggestion);
    },
  },

  'send-plan set': {
    summary: 'Record a planned local time. This never sends anything.',
    usage: 'send-plan set --draft <id> --date YYYY-MM-DD --time HH:MM [--zone <IANA>] [--occurrence earlier|later] [--note <text>]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const plan = setSendPlan(ws, {
        outreachId: requireFlag(ctx.args, 'draft'),
        date: requireFlag(ctx.args, 'date'),
        time: requireFlag(ctx.args, 'time'),
        zone: flagString(ctx.args, 'zone'),
        disambiguation: flagString(ctx.args, 'occurrence') as 'earlier' | 'later' | undefined,
        note: flagString(ctx.args, 'note'),
        actor: 'user',
      });
      emit(
        ctx.out,
        [
          `Planned ${plan.local_date} ${plan.local_time} in ${plan.recipient_zone} (${plan.zone_basis})`,
          `UTC instant: ${plan.utc_instant}`,
          `Your zone: ${JSON.stringify((plan.rendering as { display: { formatted: string } }).display.formatted)}`,
          'A planned time is a reminder only. Nothing is sent automatically.',
        ],
        plan,
      );
    },
  },

  'send-plan list': {
    summary: 'Show planned times with recalculated due and overdue views.',
    usage: 'send-plan list [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = sendPlanner(ws);
      emit(
        ctx.out,
        table(
          rows.map((row) => ({
            draft: row.outreachId,
            person: truncate(row.personTitle, 24),
            state: row.state,
            planned: row.recipientRendering?.formatted ?? '-',
            yours: row.displayRendering?.formatted ?? '-',
            due: row.due ?? '-',
            sent: row.sent ? 'yes' : 'no',
            drift: row.drift?.drifted ? 'yes' : '-',
          })),
          ['draft', 'person', 'state', 'planned', 'yours', 'due', 'sent', 'drift'],
        ),
        rows,
      );
    },
  },

  'mark-sent': {
    summary: 'Record that you sent the message yourself. Requires an idempotency key.',
    usage: 'mark-sent --draft <id> --key <idempotency-key> [--at <ISO instant>] [--reference <text>] [--note <text>] [--allow-unapproved]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = markSent(ws, {
        outreachId: requireFlag(ctx.args, 'draft'),
        idempotencyKey: requireFlag(ctx.args, 'key'),
        sentAt: flagString(ctx.args, 'at'),
        messageReference: flagString(ctx.args, 'reference'),
        note: flagString(ctx.args, 'note'),
        allowUnapproved: flagBool(ctx.args, 'allowUnapproved'),
        actor: 'user',
      });
      emit(
        ctx.out,
        [
          result.duplicate ? 'This send was already recorded; nothing changed.' : 'Send recorded.',
          `Event: ${result.event.id}`,
          `Sent at: ${result.event.sent_at_utc}`,
          `Approved content: ${result.event.was_approved ? 'yes' : 'no (recorded as an external send)'}`,
          'This records your report only. It does not imply delivery, reading or a reply.',
        ],
        result,
      );
    },
  },

  'sent list': {
    summary: 'Show immutable sent history with corrections.',
    usage: 'sent list [--draft <id>] [--json]',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const rows = sentHistory(ws, flagString(ctx.args, 'draft'));
      emit(
        ctx.out,
        table(
          rows.map((row) => ({
            id: String(row['id']),
            draft: String(row['outreach_id']),
            sent_at: String(row['sent_at_utc']),
            recipient: truncate(row['recipient'], 28),
            approved: row['was_approved'] ? 'yes' : 'no',
            corrections: String((row['corrections'] as unknown[]).length),
          })),
          ['id', 'draft', 'sent_at', 'recipient', 'approved', 'corrections'],
        ),
        rows,
      );
    },
  },

  'sent correct': {
    summary: 'Append a correction to sent history. The original snapshot is never rewritten.',
    usage: 'sent correct --event <id> --field <name> --value <text> --reason <text>',
    handler: async (ctx) => {
      const ws = await ctx.workspace();
      const result = correctSentRecord(ws, requireFlag(ctx.args, 'event'), {
        field: requireFlag(ctx.args, 'field'),
        value: requireFlag(ctx.args, 'value'),
        reason: requireFlag(ctx.args, 'reason'),
        actor: 'user',
      });
      emit(ctx.out, `Correction recorded as audit event ${result.auditId}.`, result);
    },
  },
};
