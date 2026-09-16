---
name: research-programs
description: Job 2. Research the primary graduate programs (the degree families in config/research.json degreeScope.primary, such as MASc and MMath) for the academic units the user has included, cross-checking department pages against the graduate calendar. Use for "/research-programs", "--unit <id>", or when the queue shows ready research_programs tasks.
argument-hint: "[--unit <unit-id>] [--all]"
---

# Job 2 — Graduate program research

The degrees in scope come from `config/research.json` → `degreeScope.primary`
(for example `MASc` and `MMath`). The packet repeats them under
`config.degreeScope`. Nothing in this skill assumes one particular degree.

## Before you start

```
npm run research -- reconcile --json
npm run research -- tasks list --job 2 --ready --json
```

If nothing is ready, say why. The usual reason is that no department selection
has been confirmed: Job 2 only runs for included units.

Parse `$ARGUMENTS` with `npm run research -- args-parse --file data/tmp/args.txt --json`.
Never interpolate the raw string into a command.

## Loop

For each ready task:

1. `npm run research -- tasks claim --owner claude-<id> --job 2 --json`
   (add `--target <unit-id>` for a specific unit)
2. Read the context packet it names.
3. Launch the `program-researcher` subagent with the Agent tool
   (`subagent_type: program-researcher`, `description: research_programs <unit-id>`,
   prompt `Packet: <contextPath>. Task <taskId>, owner <owner>, fencing token <n>. Follow config/worker-rules.md. Write result.json to <resultPath>.`).
4. When it has written `result.json`:
   `npm run research -- tasks complete --task <id> --owner <owner> --token <n> --json`

## What the research must produce

Every category in the packet, filled from official sources:

identity · overview · structure · attendance · research · curriculum ·
eligibility · application · supervision · funding and cost · contact · evidence

Plus `extensions` for anything sourced that does not fit a category.

## Rules specific to this job

- Preserve the exact official program title and award. A MEng is not a MASc,
  and an MSc is not an MMath.
- Record `degree_family` as the short award code exactly as it appears in
  `degreeScope.primary` (`MASc`, `MMath`, …). The applier matches on that code;
  a program whose family is not in scope is excluded from the commit.
- Related degrees are recorded only when `config/research.json` enables them
  through `degreeScope.allowRelated`. Otherwise note them and move on.
- If none of the primary degrees exists in a unit, record the official pages
  you searched and the result in `no_program_found`. Never substitute another
  degree.
- Each program's own page (or its own calendar entry) comes first in its
  `sources`, with category `program_page` or `graduate_calendar`. A department
  page that lists several programs is category `other`. Two programs must never
  share their first program page: a shared page is reported as
  `sharedSourcePages` and identifies nobody.
- Cross-check the department page against the graduate calendar. Where they
  disagree, record both readings with their dates in `conflicts`. Do not pick.
- Never convert a percentage requirement into a GPA unless the institution
  publishes the conversion. Quote the requirement as written.
- Distinguish a funding guarantee from a possibility, in the institution's own
  words. An assistantship page is not evidence of an available position.
- Record the academic year or intake each fact applies to.
- A joint program gets one canonical record linked to every administering unit.

## Report

State which units were covered, which programs were recorded, what conflicted,
what stayed unknown, and which pages were inaccessible.
