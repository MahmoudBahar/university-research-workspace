---
name: research-status
description: Inspect progress across all seven jobs - what is ready, what is blocked and precisely why, which candidates are ready for an email, which drafts need review, and which planned send times have passed. Use for "/research-status" or when the user asks where things stand.
argument-hint: "[--job 1-7] [--person <id>] [--blocked] [--json]"
---

# Research status

## Always reconcile first

```
npm run research -- reconcile --json
```

This recovers commits interrupted by a crash or quota limit and picks up notes
edited by hand. Reporting status without it can show stale numbers.

## Gather

```
npm run research -- status --json
npm run research -- tasks list --json
npm run research -- people ready --json
npm run research -- drafts list --json
npm run research -- send-plan list --json
npm run research -- notes issues --json
npm run research -- entities duplicates --json
```

Narrow with `--job`, `--target` or `--state` when the user asked about one job
or one person. Parse `$ARGUMENTS` through
`npm run research -- args-parse --file data/tmp/args.txt --json`.

## Retrieval capability

Load `mcp__claude-in-chrome__list_connected_browsers` with one `ToolSearch`
call (`select:mcp__claude-in-chrome__list_connected_browsers`; it is deferred
until then). If it loads, call it: an empty list means the Claude in Chrome
extension is not connected, so report "browser: not connected". If it does not
load, report that the browser tools are absent from this session. Then:

```
npm run research -- sources needs-browser --json
```

Report the count of sources waiting for a browser and, if any exist and a
browser is connected, suggest `/map-person --retry-blocked`. If no browser is
connected, say that Scholar and other JavaScript-only pages will keep being
recorded as `needs_browser` until the Claude in Chrome extension is running.

### Checks for the user to clear

Rows with `access_status` `captcha` or `blocked` stopped at a check that only
the user can pass. List them grouped by person: name, person id, source
category and the full `url` from the JSON (not a shortened one). Tell the user
to open each URL in their Chrome, complete the check themselves, then run
`/map-person <person-id> --retry-blocked` for that person. Do not open these
pages or attempt the checks yourself. Leave `rate_limited` rows out of this
list; they clear on their own and are retried with the rest.

## Report

Structure the answer as:

1. **Where the university stands** — selection version, included units, whether
   a draft selection is waiting to be confirmed.
2. **Per job** — complete, running, pending, blocked. For blocked work, give the
   specific reason from `blockers`, not a generic "waiting".
3. **Candidates** — who is research-complete, who is email-ready, and for anyone
   who is not, the exact blockers.
4. **Outreach** — drafts by state, which need review, which are approved, which
   planned times have passed. Say plainly that a passed time means nothing was
   sent.
5. **Data health** — open note issues, duplicate candidates, incomplete commits.
6. **Retrieval** — browser connected or not, sources waiting for one, and the
   checks waiting for the user to clear, with their URLs.
7. **What to run next** — the exact command.

## Things to say honestly

- If no Claude session is running, queued work is not progressing. The interface
  shows "Queued — start or resume Claude Code" for the same reason.
- A task in `partial` has usable checkpoints and will resume, not restart.
- A `stale` task ran against a scope version that is no longer current; its
  result cannot be committed as current.
- A cooldown (`next_attempt_at`) is a saved retry time, not a live wait.
