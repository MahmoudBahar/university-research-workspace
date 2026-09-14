---
name: draft-outreach
description: Job 7. Prepare an email package for one person for the user to send by hand - recipient, subject, body, evidence brief, chosen attachments, contact-requirement check and a suggested time window. Use for "/draft-outreach <person-id>" or "--ready". This never sends anything.
argument-hint: "<person-id> | --ready [--program <program-id>] [--purpose initial_contact] [--campaign <name>]"
---

# Job 7 — Email preparation

This job writes a draft for the user to send from their own mail client. There
is no mail transport in this system, and nothing here schedules a send.

## Before you start

```
npm run research -- reconcile --json
npm run research -- people ready --json
npm run research -- tasks list --job 7 --ready --json
```

Parse `$ARGUMENTS` through `npm run research -- args-parse --file data/tmp/args.txt --json`.

`people ready` shows who is research-complete and, for those who are not
email-ready, exactly what blocks them. Read the blockers out to the user rather
than working around them.

## Eligibility

A draft needs all of:

- `research_complete` for that person
- a recipient address whose evidence status is `confirmed`
- a resolved contact route (not `do_not_email`, not `portal_only`)
- an approved applicant profile revision
- any program facts the message actually relies on, still inside their
  freshness window

Unknown student availability does not block anything. The message may ask.

## Loop

1. `npm run research -- tasks claim --owner claude-<id> --job 7 [--target <person-id>] --json`
2. Read the packet. It contains the profile, the program note if one is used,
   the readiness report, the three levels of writing guidance and the approved
   applicant profile.
3. Launch the `email-drafter` subagent with the Agent tool
   (`subagent_type: email-drafter`, `description: draft_outreach <person-id>`,
   prompt `Packet: <contextPath>. Task <taskId>, owner <owner>, fencing token <n>. Follow config/worker-rules.md. Write result.json to <resultPath>.`).
4. `npm run research -- tasks complete --task <id> --owner <owner> --token <n> --json`
   This creates the package and validates it into `needs_review`.

## The package

- To, subject, and the exact body the user will paste
- A separate evidence brief: why this person, what evidence was used, and what
  was deliberately not claimed
- Links to the supporting profile, program and publication notes
- Selected attachment ids, filenames, versions and hashes — none by default
- The applicant-profile and email-style revisions the draft was written against
- The recipient's stated contact requirements and whether each is satisfied
- A suggested time window, clearly labelled as a convenience default

## Writing rules

- Three levels of guidance apply, most specific wins: general style, then a
  university or program override, then a person-specific override.
- Preserve the user's voice and facts. Assert only what the approved applicant
  revision supports.
- Never say a paper was read when only its abstract was available.
- No invented qualifications, no funding promises, no generic flattery.
- Follow the recipient's own stated requirements — a required subject line, a
  requested one-page CV — and record whether each was satisfied.
- If the person says not to email, or directs applicants to a portal, stop.
  Surface the conflict and ask the user how they want to proceed. A published
  address does not override a stated instruction.
- Internal reasoning and citations stay in the brief, never in the body.

## After drafting

Tell the user the draft id and that review is next: `/review-outreach <draft-id>`,
or the Review screen in the interface.
