# The first real university

A checklist for the first run against an institution that exists. Read it
after the dry run in `docs/dry-run.md` has shown that dispatch works.

## Before you start

- [ ] `npm run research -- reconcile` reports no incomplete commits.
- [ ] `config/research.json` has `research.requireVerifier: true`. Keep it on
      for the first run; the verifier is what re-checks addresses and contact
      instructions before an email can be approved.
- [ ] `concurrency.candidates` is 1. Parallel candidates share one browser and
      one usage budget; go wider only once you have seen a serial run finish.
- [ ] The Claude in Chrome extension is installed and Chrome is open if you
      want Scholar profiles read. Without it, those entries are recorded as
      `needs_browser` and picked up later with `/map-person --retry-blocked`.
- [ ] Your applicant profile is written and approved, or you accept that Job 7
      will wait.
- [ ] `npm run research -- backup create --label before-first-run`.

## Scope small

- [ ] Start with **one department**. Confirm the selection, run Jobs 2 and 3,
      and read the results before including more units.
- [ ] Read the Job 3 coverage ledger. Were all directory categories covered?
      Was pagination followed? Is an inaccessible adjunct list recorded rather
      than silently missing?
- [ ] Open the discovery queue in the interface. People and labs found outside
      the selection are waiting there for your decision; nothing was dropped.

## Before the first email

- [ ] Spot-check **three profiles** against their sources yourself: open the
      official page and confirm the title, the address and the contact
      instruction. If any of the three is wrong, stop and report it before
      drafting anything.
- [ ] For every person you intend to write to, read their evidence section:
      which papers were `full_text`, which `abstract_only`, which
      `metadata_only`. The draft may only speak about what was read.
- [ ] Check `npm run research -- people ready --json`. Anyone not email-ready
      shows the exact blocker; do not work around it.
- [ ] Read the evidence brief of the first draft, then the body, then compare.
      Everything asserted about you must be in the approved applicant revision.

## Sending

- [ ] Approve only the exact revision you read. Any later edit returns it to
      review.
- [ ] Send from your own mail client. Then `/mark-outreach-sent <draft-id>`.
      A planned time passing means nothing was sent.

## After the run

- [ ] `npm run research -- verify-links --json` — no broken links.
- [ ] `npm run research -- notes issues --json` — resolve or acknowledge each.
- [ ] `npm run research -- entities duplicates --json` — decide each candidate;
      the core never merges on a shared name.
- [ ] Note in `docs/verification.md` what the run showed about research
      quality: how complete the roster was, what was blocked, what the verifier
      refuted. That is the only evidence there is for the "live research
      quality" gate.
