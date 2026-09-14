# Verification

What was actually run, on what, and what was not. Numbers here come from real
runs on this machine, not from the fact that a config file exists.

## Environment used

| | |
| --- | --- |
| Platform | Linux 7.0.0-31-generic, x64 |
| Node.js | 26.8.1 (the workspace requires ≥ 24) |
| npm | 11.19.0 |
| Claude Code | 2.1.267 |
| SQLite driver | `better-sqlite3` 13.0.3, compiled from source for this Node ABI |
| Temporal | the runtime's own implementation; `temporal-polyfill` is the fallback on Node 24 |
| Browser | Chromium headless shell 153.0.8010.12 via Playwright 1.63 |

`npm run doctor` reports these on any machine.

## What ran

| Suite | Command | Result |
| --- | --- | --- |
| Core and API acceptance | `npm test` | 79 tests, 79 passed (68 before this round) |
| Browser flows | `npm run test:e2e` | 11 tests, 11 passed (about 14 s), three consecutive clean runs |
| Type checking | `npm run build` (`tsc -b` plus the web bundle) | clean |
| Web type checking | `npx tsc -p apps/web/tsconfig.json --noEmit` | clean |
| Link check on a seeded vault | `npm run research -- verify-links` | 0 broken links, 0 case collisions |
| Runtime report | `npm run doctor` | driver and Temporal as above; schema version 2, no migration warnings |
| Skill and agent frontmatter | `node scripts/check-skills.mjs` | 19 definitions, 0 failing |
| Fixture site | `node scripts/fixture-server.mjs` | 35 files; clean URLs, `?page=2`, the 403 listing and the JavaScript-shell profile all answer as designed |

All fixtures describe **Northvale Institute of Technology**, an institution that
does not exist, at `.invalid` domains — a TLD reserved by RFC 2606 that can never
resolve. No real university, department or person was researched or contacted at
any point.

## The fifteen acceptance criteria

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | User selection prevents excluded-unit research; scope changes preserve past artifacts | `02-scope`: an excluded unit's task is blocked and refuses to be claimed; after a scope change the program note is byte-identical and ineligible tasks are cancelled |
| 2 | Job 7 drafts for a ready person while other Job 5 tasks are unfinished | `02-scope`: a draft validates while three other people are still at Job 4 |
| 3 | Joint appointments and newly discovered assistants deduplicate | `03-identity`: a cross-listed person keeps one record with two affiliations; a known assistant found on a lab roster is matched by profile URL; a shared display name creates a candidate, not a merge |
| 4 | Worker crash preserves checkpoints; an expired owner's late commit is rejected | `04-recovery`: two checkpoints survive lease expiry and are readable by the new owner; the old owner's commit fails with `fencing_rejected` while the new owner's succeeds |
| 5 | A crash between file installation and database finalisation recovers idempotently | `04-recovery`: a commit is forced into `applying` with the file on disk and no index row; recovery finalises it, and replaying twice leaves exactly one revision |
| 6 | Repeating a completed task, or double-clicking mark-sent, does not duplicate | `05-idempotency`: re-enqueueing returns the same task id and re-applying the same result adds no units; the same idempotency key yields one sent event |
| 7 | Manual edits reconciled; concurrent edits surface conflicts | `06-editing`: hand edits become user revisions; a stale `expectedSha` is refused and the other writer's bytes survive; invalid YAML is reported without touching the file |
| 8 | Editing an approved recipient, body, subject or attachment invalidates approval | `07-approval`: all four cases return the draft to `needs_review`; also proven in the browser (`e2e/flows`) |
| 9 | Sent snapshots remain historical after later edits or document replacement | `07-approval`: the snapshot is unchanged after an out-of-band file edit; the sent row keeps the subject it was sent with |
| 10 | DST ambiguity, nonexistent times, and cross-zone date rollover | `08-timezones`: 02:30 on a spring-forward date is refused with the nearest valid times; 01:30 on a fall-back date needs an explicit occurrence and the two differ by an hour; 09:00 Tokyo is the previous day in Vancouver |
| 11 | Relative links resolve with portable paths and duplicate display names | `01-pipeline` and `06-editing`: zero broken links across a fully populated vault; duplicate titles are reported, not rejected; reserved Windows names are refused |
| 12 | Blocked Scholar, inaccessible PDFs, abstract-only papers and conflicting sources are truthful | `09-evidence`: the blocked profile is `blocked` and `investigated: 0`; the abstract-only note says the full text was not read; the metadata-only note records a gap; both readings of a conflicting program fact survive |
| 13 | A due time never marks a message sent or attempts delivery | `05-idempotency`: an overdue plan leaves the state `approved` with no sent event; `e2e/flows` shows the same in the interface |
| 14 | Invalid uploaded paths and unsafe Markdown do not expose files or execute scripts | `10-safety`: four traversal attempts refused; unportable filenames refused; documents reachable only by registered id; script markup stored as text, and sanitised by an allow-list before rendering |
| 15 | Backup and restore preserve notes, relationships, revisions and workflow state | `11-backup`: after destroying and restoring, relationship and revision counts match, the profile is byte-identical, the send plan keeps its resolved instant, and the sent record keeps `was_approved` |

## Browser flows

Run against the real API and core on a seeded fictional workspace:

1. The overview states that no Claude assignment is executing, rather than
   implying work is underway.
2. A department is included, saved as a draft version and confirmed; the
   confirmation reports what was cancelled and re-queued, and prior research
   survives.
3. The queue shows a partially finished pipeline and the exact skill command.
4. A person page keeps rank and role category distinct, labels the campus-based
   timezone as inferred, and shows abstract-only and metadata-only papers as
   such alongside a blocked source.
5. An approved email is edited and returns to review with the reason; the new
   revision is approved separately.
6. A nonexistent local time is refused; a valid one is planned and shows as
   overdue while the draft stays `approved`.
7. Marking sent is explicit and lands in immutable history with a readable
   snapshot.

Two application defects were found this way and fixed: a lab roster was
overwriting a person's academic title with their lab role, and rendered notes
were showing their YAML frontmatter as body text. A third problem was in the
harness rather than the application — Playwright can start the web server before
`globalSetup` runs, so re-seeding by deleting the workspace left the server
attached to a removed database. Seeding now happens in `npm run test:e2e`
before Playwright starts anything. The suite was run three times in a row after
the fix, passing 7/7 each time in about 4.4 seconds.

After the redesign, four interface flows were added in `tests/e2e/ui.spec.ts`:

8. The theme choice persists across a reload; choosing "system" removes the
   attribute again.
9. Collapsing a faculty hides its departments; "Expand all" restores them.
10. The university switcher filters the people request, follows the user to
    the Programs page through the URL, and "All universities" clears it.
11. Ctrl+K opens the command palette; typing a name and pressing Enter opens
    that person's profile.

The full suite of 11 passed three times in a row after integration. The
redesigned screens were also captured headlessly at 1280 px in light and dark
and at 420 px, every route plus the person page, palette, email workspace and
the mobile drawer, and inspected; no console errors were logged. One defect was
found during integration and fixed: the "latest extraction" lookup ordered by
timestamp only, so two rows written in the same millisecond could come back in
either order; the queries now break ties on `rowid`.

## Platforms

Only **Linux** was executed here. `.github/workflows/ci.yml` runs the same build,
acceptance suite and link check on `ubuntu-latest`, `macos-latest` and
`windows-latest` across Node 24 and 26, plus the browser flows on Linux. Until
that workflow has run, macOS and Windows are **configured but unverified**.

Portability was designed for rather than assumed: no shell is invoked anywhere
(`spawn` is always called with `shell: false`), paths are stored posix-style and
converted on use, filenames are checked against Windows reserved names and
characters, link resolution is checked case-insensitively, and the SQLite
adapter falls back to Node's built-in `node:sqlite` where the native module
cannot be built.

## Skill and agent loading

All nineteen definitions are parsed by `scripts/check-skills.mjs` for valid YAML,
the required `name` and `description` fields, a string `argument-hint` on
skills, and the absence of `tools:` and `model:` keys on agents (they inherit
the session's tools, which is what lets them reach the browser). Four skills
initially failed in the first round: an unquoted `argument-hint` beginning with
`[` parses as a broken YAML flow sequence. Every hint is now quoted, and all
eleven skills and eight agents parse.

Eleven skills under `.claude/skills/*/SKILL.md` and eight agents under
`.claude/agents/*.md` use the `name` + `description` frontmatter that Claude Code
2.1.267 reads, matching the format of the skills already installed on this
machine. Shared worker rules live at `config/worker-rules.md` rather than inside
`.claude/agents/`, so nothing there is mistaken for an agent definition.

## Gates

What changed since the first verification, and what each gate needs now.

| Gate | State | Evidence |
| --- | --- | --- |
| Isolated subagent execution end to end | **Prepared, not run.** Every skill now names the Agent tool, the `subagent_type` and the exact prompt; `scripts/fixture-server.mjs` and `docs/dry-run.md` give a full run against fictional pages. The run itself was deferred by the user. | A `source-mapper` subagent launched from this session (the same agent definition the skills dispatch) reported that it inherits `Bash`, `Read` and `Write` directly and all 22 `mcp__claude-in-chrome__*` tools plus `WebFetch` and `WebSearch` as deferred tools loadable with one `ToolSearch` call, which is exactly what step 0 of the retrieval ladder tells workers to do. The Claude in Chrome extension was **not connected** during this session (`list_connected_browsers` returned an empty list; `tabs_context_mcp` answered "Browser extension is not connected"), so the read of a fixture page through the browser tools was not exercised. |
| Live research quality | **Open by nature.** Only a real run shows it. | `docs/first-run.md` is the checklist for that run and for recording what it shows. |
| macOS and Windows | **Configured, not run.** The workflow in `.github/workflows/ci.yml` covers both across Node 24 and 26; it runs on the first push. | Git repository initialised; push instructions in README. |
| PDF text extraction | **Closed by design.** There is no extractor; Claude reads the document through `/import-document` and the CLI records text and provenance (`method: claude_read`, page count, date). Pasted text is `manual_paste`. Both paths are tested through the ingress. | `10-safety`: a PDF and a PNG report `unavailable` with the `/import-document` hint; text handed in keeps `method: claude_read`, its page count and `review_state: unreviewed`, and embedded instructions are stored verbatim; an unreadable scan is recorded with its reason and no text. `12-api`: the extract endpoint's three body shapes. |
| Long-running lease renewal | **Partly closed.** `leases.maxRenewals` is enforced and tested; multi-hour behaviour is still unobserved. | `13-maintenance`: renewals are counted per run and the request past the cap fails with `state_violation`. |
| Browser retrieval | **Not run.** The ladder is tested at the schema, database and API boundary (`needs_browser`, `fetch_method`, `sources needs-browser`) and the fixture server offers a JavaScript-shell page for it, but no page was read through the browser tools because the extension was not connected, and no real host was contacted. | Tool inheritance confirmed by the probe above. To close: connect the extension, then follow `docs/dry-run.md` and check that `/scholar/citations?user=aosei` is recorded with `fetch_method: browser`. |

Suites after this round: `npm test` 79/79, `npm run test:e2e` 11/11 (three
consecutive runs), `npm run build` clean, `node scripts/check-skills.mjs` 19/19.

## Design-review fixes verified in this round

`tests/acceptance/13-maintenance.test.ts` covers the items from the design
review that changed behaviour: the renewal cap; migration checksums (an edited
migration is reported and never re-run); `reconcile` skipping unchanged notes
by size and modification time while still catching edits, and pruning old
change-feed rows without touching audit rows; `program_facts_unrecorded` as a
warning at draft time and a blocker at approval; a `needs_browser` outcome and
its fetch method round-tripping from a result file into the registry and API;
and a source result that omits `access_status` being rejected instead of read as
accessible. `12-api` additionally proves that a mutation without an allowed
`Origin` or `Sec-Fetch-Site: same-origin` is refused, and every `university`
filter, the search endpoint (with LIKE escaping and scoping), unit progress and
the revision endpoint. The `markSent` idempotency change is covered by the
existing `05-idempotency` case plus the deterministic key the interface now
derives from the draft fingerprint.

## Deliberate non-features

Absent by design, not overlooked: SMTP or any mail-provider integration,
automatic scheduling, delivery or read tracking, an unattended runner, an API
key or Agent SDK dependency, and any code path that lets the web server start a
model session.
