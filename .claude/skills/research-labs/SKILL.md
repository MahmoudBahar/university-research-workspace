---
name: research-labs
description: Job 6. Research a laboratory from a discovered record or a URL you supply - people, current and former membership with evidence, projects, facilities, dated recruitment notices, contact rules and timezone basis. Use for "/research-labs <lab-id>", "--url <lab url>", "--university <id>".
argument-hint: "<lab-id> | --url <https://...> [--unit <unit-id>] [--ready]"
---

# Job 6 — Laboratory research

Lab research is normally non-blocking: it enriches people without either job
waiting on the other.

## Before you start

```
npm run research -- reconcile --json
npm run research -- tasks list --job 6 --ready --json
```

Parse `$ARGUMENTS` through `npm run research -- args-parse --file data/tmp/args.txt --json`.

## Starting from a URL

If the user supplies a URL for a lab that has no record yet, create it first
through the identity service so it deduplicates against anything already known:

```
npm run research -- tasks enqueue --job 6 --target <lab-id> --param url=<url>
```

If no lab id exists, run the assignment against the discovered record that Job 5
created, or ask the user to confirm which lab they mean. Do not invent an id.

## Loop

1. `npm run research -- tasks claim --owner claude-<id> --job 6 [--target <lab-id>] --json`
2. Read the context packet.
3. Launch the `lab-researcher` subagent with the Agent tool
   (`subagent_type: lab-researcher`, `description: research_lab <lab-id>`,
   prompt `Packet: <contextPath>. Task <taskId>, owner <owner>, fencing token <n>. Follow config/worker-rules.md. Write result.json to <resultPath>.`).
   Lab sites that render nothing without JavaScript are read through the
   browser; run such assignments one at a time.
4. `npm run research -- tasks complete --task <id> --owner <owner> --token <n> --json`

## What must be captured

Official name · institution and units · directors and PIs · other staff and
students · current and former membership with observed dates · research themes ·
projects · publications · facilities where public · collaborations · dated
recruitment notices · contact instructions · location and timezone basis ·
information that was not available.

## Rules specific to this job

- Membership carries evidence and an observed date. Absence from a current
  roster is not by itself proof that somebody left; preserve former members
  where a source identifies them explicitly.
- A recruitment notice is recorded with its date and source. An active lab page
  is not evidence that a funded opening exists.
- New people go through the same identity service. A lab roster is not
  authoritative for someone's academic title — that stays as their own profile
  states it, and the lab role is recorded on the relationship.
- Expansion is bounded per run by `research.expansionBudgetPerRun`. Everything
  discovered is still persisted; only the follow-up research is capped.
