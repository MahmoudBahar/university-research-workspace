---
name: discover-people
description: Job 3. Discover professors, associate and assistant professors, and publicly listed assistants and researchers for the included academic units, with an auditable coverage ledger. Use for "/discover-people", "--unit <id>", or when ready discover_people tasks exist.
argument-hint: "[--unit <unit-id>] [--all]"
---

# Job 3 — Faculty and assistant discovery

## Before you start

```
npm run research -- reconcile --json
npm run research -- tasks list --job 3 --ready --json
```

Parse `$ARGUMENTS` through `npm run research -- args-parse --file data/tmp/args.txt --json`.

## Loop

1. `npm run research -- tasks claim --owner claude-<id> --job 3 --json`
2. Read the context packet.
3. Launch the `people-discoverer` subagent with the Agent tool
   (`subagent_type: people-discoverer`, `description: discover_people <unit-id>`,
   prompt `Packet: <contextPath>. Task <taskId>, owner <owner>, fencing token <n>. Follow config/worker-rules.md. Write result.json to <resultPath>.`).
4. `npm run research -- tasks complete --task <id> --owner <owner> --token <n> --json`

## What must be captured per person

Full name · exact official title · normalised role category · profile URL ·
ORCID where stated · professional email and its evidence status ·
public research themes · any relationship a source actually supports · sources.

## Rules specific to this job

- Academic rank and role category are different things. Assistant Professor,
  Associate Professor and Professor are ranks. A research assistant, graduate
  student, postdoctoral researcher and administrative assistant each have their
  own role category. Never treat an assistant as a supervisor.
- Record an assistant's relationship to a professor only where a source says so.
- Graduate-supervision eligibility and contact suitability are separate pieces of
  evidence from the academic title. Record them separately or leave them unknown.
- Handle pagination and every directory category. The coverage ledger must list
  the pages actually fetched, whether pagination was followed, and what was
  inaccessible.
- One canonical person record across departments and labs. A shared name is not
  enough to merge; an official profile URL or a verified ORCID is.
- Newly discovered people who are outside the included scope are still recorded.
  They appear in the discovery queue for the user to decide about.

## After the commit

Job 4 tasks are queued automatically for each person found in scope. Report the
count and offer to continue with `/map-person --ready`.
