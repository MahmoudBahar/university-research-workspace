---
name: research-person
description: Job 5. Deep research on one person - identity, research themes, current projects, labs and students, supervision availability, the full publication inventory with honest summaries, contact instructions, and timezone basis. Each candidate gets a fresh isolated subagent context. Use for "/research-person <person-id>", "--ready", "--parallel N".
argument-hint: "<person-id> | --ready [--parallel N] [--include-applicant-fit]"
---

# Job 5 — Deep person research

Each person gets a fresh subagent with only their own packet. That isolation is
the point: one candidate's material must not leak into another's profile.

## Before you start

```
npm run research -- reconcile --json
npm run research -- tasks list --job 5 --ready --json
npm run research -- people ready --json
```

Parse `$ARGUMENTS` through `npm run research -- args-parse --file data/tmp/args.txt --json`.

`--parallel N` may not exceed `concurrency.candidates` in `config/research.json`.
The claim command enforces this; if it returns `claimed: null` you have reached
the limit.

## Loop, one candidate at a time

1. `npm run research -- tasks claim --owner claude-<id> --job 5 [--target <person-id>] --json`
2. Read the context packet. It contains that person's source map, affiliations,
   relevant programs, saved checkpoints and — only if fit commentary was
   requested — the approved applicant summary.
3. Launch the `person-researcher` subagent with the Agent tool
   (`subagent_type: person-researcher`, `description: research_person <person-id>`,
   prompt `Packet: <contextPath>. Task <taskId>, owner <owner>, fencing token <n>. Follow config/worker-rules.md. Write result.json to <resultPath>.`).
   While `fetching.browserAllowed` is on, this job uses the user's one browser
   for Scholar and similar hosts, so run one candidate at a time regardless of
   `--parallel`.
4. Instruct it to checkpoint as it goes:
   `npm run research -- tasks checkpoint --task <id> --owner <owner> --token <n> --kind source|section|paper --label "<what>"`
   A run that dies keeps its checkpoints, and the next run resumes from them.
5. When `result.json` exists, run the verifier if
   `research.requireVerifier` is enabled: claim the `verify_person` task, launch
   the `verifier` subagent with the Agent tool (`subagent_type: verifier`,
   `description: verify_person <person-id>`, the same prompt shape with that
   task's packet), then complete the verify task.
6. `npm run research -- tasks complete --task <id> --owner <owner> --token <n> --json`

## What the profile must cover

1. Identity, current role, appointments, official biography and what is uncertain
2. Research interests, methods, themes and a synthesis a reader can follow
3. Current projects, separating current evidence from concluded work
4. Labs, centres, collaborators, students and assistants, each with a source
5. Supervision eligibility per program: accepting, not accepting, or no public
   information — each with a date and a source
6. Publication inventory, summaries of what was actually accessible, and the
   most recent publication found
7. Professional contact details, preferred route, exact instructions, required
   subject wording, requested documents
8. Institutional location and IANA timezone, marked `campus_inferred` unless a
   source states the zone directly
9. Optional connections to the approved applicant profile, with gaps and
   questions
10. Evidence, verification outcomes, coverage limits, blocked sources, open issues

## Publication policy

Default: inventory every discoverable publication in scope and summarise every
one you can actually read. The user may narrow this by years, topics or a count
budget before the run; whatever scope is used is recorded with the profile.

Label each paper honestly:

- `full_text` — you read it. Summarise question, approach, findings, the
  limitations the authors state, and possible relevance.
- `abstract_only` — say so. Do not describe experiments or limitations the
  abstract does not state.
- `metadata_only` — record the gap. Never write a summary from a title.

Keep preprints and final versions distinguishable. A paper with several authors
in the registry gets one note linked to all of them.

If the run reaches its budget, set `scope.budget_exhausted: true`. The task
becomes `partial`, not complete, and the work resumes later.

## Rules specific to this job

- An active lab page, a recent paper, or an opening elsewhere is not evidence
  that this person is accepting students or has funding.
- Absence from a roster is not evidence that somebody left.
- Assistants and students found here are added to the registry with their role
  and source. Out-of-scope discoveries stay visible for the user to decide about.
- Only the approved applicant revision may be used for fit commentary, and only
  when the user asked for it.

## Readiness

`research_complete` means the agreed scope is covered, the mandatory sections
validate and the limitations are recorded. It does not mean the person is ready
for an email — that needs a verified recipient and contact route as well. A
complete profile with unknown student availability is normal and fine.
