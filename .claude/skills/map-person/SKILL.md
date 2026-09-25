---
name: map-person
description: Job 4. Map and classify the sources that Job 5 should investigate for one person - official profile, personal site, CV, lab pages, Scholar, ORCID, repositories, publisher pages, contact pages and the institutional location. Use for "/map-person <person-id>" or "--ready".
argument-hint: "<person-id> | --ready [--parallel N] | --retry-blocked"
---

# Job 4 — Per-person source mapping

This job finds and validates destinations. It does not read papers; that is
Job 5.

## Before you start

```
npm run research -- reconcile --json
npm run research -- tasks list --job 4 --ready --json
```

Parse `$ARGUMENTS` through `npm run research -- args-parse --file data/tmp/args.txt --json`.
A bare positional argument is a person id; validate it against
`^person-\d{4,}$`.

## Loop

1. `npm run research -- tasks claim --owner claude-<id> --job 4 [--target <person-id>] --json`
2. Read the context packet: it carries the person, their affiliations and any
   sources already known.
3. Launch the `source-mapper` subagent with the Agent tool
   (`subagent_type: source-mapper`, `description: map_person_sources <person-id>`,
   prompt `Packet: <contextPath>. Task <taskId>, owner <owner>, fencing token <n>. Follow config/worker-rules.md. Write result.json to <resultPath>.`).
   Scholar and the other hosts in `fetching.browserHosts` are read through the
   user's one browser, so run one person at a time regardless of `--parallel`.
4. `npm run research -- tasks complete --task <id> --owner <owner> --token <n> --json`

## `--retry-blocked`

Some entries could not be read because no browser was available when the map
was made (`needs_browser`) or the host challenged the request (`blocked`).
Once the Claude in Chrome extension is connected:

```
npm run research -- sources needs-browser --json
```

lists those entries by person. For each person listed, find their Job 4 task
and re-run it, then continue with the loop above:

```
npm run research -- tasks list --job 4 --target <person-id> --json
npm run research -- tasks retry --task <task-id> --json
```

A retried map keeps every entry that was readable the first time; only the
retryable ones are attempted again, through the browser this time.

## Categories to search for

- Official faculty profile and graduate-faculty entry
- Personal academic website and CV
- Lab pages: team, projects, positions, prospective-student instructions
- Google Scholar, ORCID, institutional repository, other verified profiles
- Publication lists, DOI and publisher pages, preprints, accessible full texts
- Official professional contact details and the preferred contact route
- Public institutional office or campus location, as a timezone basis

## Rules specific to this job

- Every entry records: URL, category, how it was discovered, identity
  confidence, access status and the date of the attempt.
- Identity confidence is about whether the source is really this person. A
  Scholar profile with the same name is `uncertain` until something ties it to
  the person; do not attach it as verified.
- If Scholar is blocked or unavailable, record that outcome and continue with
  official bibliographies, repositories and publisher pages. Never record a
  blocked profile as inspected. No browser in the session means
  `needs_browser`. A challenge page from the plain fetch is a reason to try the
  browser; a challenge page in the browser means `captcha` or `blocked`, and
  the worker stops using that host for the run.
- List the categories where you found nothing in `absent_categories`. An empty
  category is a finding.
- The institutional location is a professional location. It is the basis for a
  timezone, not a claim about where the person is.

## After the commit

Job 5 is queued for this person. Continue with `/research-person <person-id>`.
