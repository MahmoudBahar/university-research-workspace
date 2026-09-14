---
name: mark-outreach-sent
description: Record that the user sent a message themselves. Requires their explicit report, stores an immutable snapshot of what was sent, and is idempotent. Also handles recording a message that was changed or was never approved. Use for "/mark-outreach-sent <draft-id>".
argument-hint: "<draft-id> [--at <ISO instant>] [--reference \"<message id>\"] [--external] [--note \"<what differed>\"]"
---

# Record a sent message

This records a fact the user reports. It sends nothing, and it never implies
delivery, reading or a reply.

## Only on an explicit report

Record a send only when the user has actually told you they sent it. Never infer
it from approval, from copying the body, from a planned time passing, or from
elapsed time. If you are not certain, ask.

## Normal case: the approved content was sent

```
npm run research -- reconcile --json
npm run research -- drafts show --draft <draft-id> --json
npm run research -- mark-sent --draft <draft-id> --key <idempotency-key> --json
```

Use a stable idempotency key, for example `<draft-id>-<the instant the user
reports>`. Running the command twice with the same key records one event and
reports `duplicate: true`.

Add `--at <ISO instant>` when the user sent it earlier than now, and
`--reference` for their own message id or link.

The core re-reads the draft and re-fingerprints it before recording, so the
snapshot is the content as it actually stands.

## The content was changed or was never approved

If the user sent something that does not match an approval, the plain command
refuses. Confirm with the user what was actually sent, then:

```
npm run research -- mark-sent --draft <draft-id> --key <key> --allow-unapproved --note "<what differed>" --json
```

The record permanently keeps the fact that this version was not approved. That
is the point — do not approve it retroactively to make the record look tidier.

## Corrections

Sent records are immutable. A correction is a new event:

```
npm run research -- sent correct --event <sent-event-id> --field sent_at_utc --value "<corrected>" --reason "<why>"
```

## What to tell the user

Confirm what was recorded: the draft, the timestamp, the recipient, the subject,
the attachments, and whether the content was approved. Then say plainly that
this is their report and nothing about delivery is known.
