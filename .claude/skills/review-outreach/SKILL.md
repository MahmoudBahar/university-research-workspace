---
name: review-outreach
description: Review an email draft and, when the user explicitly approves it, record approval of that exact revision. Shows the recipient, subject, body, chosen attachments, the recipient's stated requirements and any blocker. Use for "/review-outreach <draft-id>" or "--all".
argument-hint: "<draft-id> | --all [--approve] [--return \"<reason>\"] [--archive \"<reason>\"]"
---

# Review an outreach draft

Approval is the user's decision. This skill presents the package and records
what the user decides. It never approves on its own initiative, and approval is
not implied by the user asking you to show them a draft.

## Show the package

```
npm run research -- reconcile --json
npm run research -- drafts validate --draft <draft-id> --json
npm run research -- drafts show --draft <draft-id> --json
```

`drafts validate` re-reads the file from disk and recomputes its fingerprint
before anything else, so what you show is what exists right now.

Present:

- To, subject and the exact body
- Selected attachments with their versions and hashes, or "none selected"
- The recipient's stated contact requirements and whether each is satisfied
- Every blocker and warning from validation, in the user's words not codes
- The current fingerprint

## Approving

Only after the user says clearly that they approve this version:

```
npm run research -- drafts approve --draft <draft-id> --fingerprint <exact fingerprint> --json
```

The fingerprint must be the one from the validation you just showed. If the file
changed in between, the command refuses with `revision_conflict` — re-read and
show the user the current version instead of retrying with the old hash.

Approval binds the recipient, subject, exact body and attachment versions.
Changing any of them afterwards invalidates it automatically.

## Returning or archiving

```
npm run research -- drafts return --draft <draft-id> --reason "<what to change>"
npm run research -- drafts archive --draft <draft-id> --reason "<why>"
```

## Contact conflicts

If validation reports `contact_conflict_do_not_email` or
`contact_conflict_portal_only`, do not look for a way around it. Show the
recipient's own instruction and its source, and ask the user how they want to
proceed. A published address does not override a stated instruction.

## After approval

Approval does not send anything and does not schedule anything. Tell the user
the next steps are their own: choose a planned time if they want a reminder
(`npm run research -- send-plan set ...` or the Send planner screen), send the
message from their mail client, then record it with `/mark-outreach-sent`.
