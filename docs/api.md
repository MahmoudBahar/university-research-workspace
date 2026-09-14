# API and CLI

## Security model

The API binds to `127.0.0.1` and nothing else. Every request must satisfy:

1. **Loopback** — the peer address is `127.0.0.1` or `::1`.
2. **Host** — the `Host` header is `127.0.0.1:<port>` or `localhost:<port>`.
   This blocks DNS-rebinding, where a hostile name resolves to your loopback.
3. **Origin** — if an `Origin` header is present it must be an allowed origin:
   the server's own, plus the Vite dev server during development.
4. **Provenance on mutations** — every non-GET request must carry either an
   `Origin` on the allowlist or `Sec-Fetch-Site: same-origin`. Browsers always
   send one of the two for a page on this app; a request that carries neither
   did not come from such a page and is refused.
5. **Session token** — every mutation must also carry `x-urw-session` matching
   the token generated at startup and written to `data/session.json` (mode
   0600). The comparison is constant-time.

`GET /api/bootstrap` hands the token to a page that already satisfies the first
three checks. A page on another origin cannot read the response, so it cannot
obtain the token, and its own mutations are refused twice over.

The loopback and Host checks (1–2) run on every route, including the static
interface bundle, and before any request body is parsed. Only `/api` routes
parse JSON.

Other properties: document routes accept registered ids only and resolve paths
inside the private directory (`resolveWithin` refuses anything that escapes);
no user string is ever passed to a shell; every mutation body is validated with
Zod; Markdown is sanitised in the browser before it reaches the DOM.

## Errors

Errors are `{ "error": "<code>", "message": "...", "detail": { ... } }`.

| Code | Status | Meaning |
| --- | --- | --- |
| `invalid_input` | 400 | Failed validation, or an impossible local time |
| `access_denied` | 403 | Host, origin or session check failed |
| `not_found` | 404 | Unknown id or missing file |
| `conflict` | 409 | Lock held, or a protected field was changed |
| `revision_conflict` | 409 | The expected hash or version had moved on |
| `scope_violation` | 409 | The result targets a superseded scope version |
| `dependency_blocked` | 409 | A prerequisite is not met |
| `fencing_rejected` | 409 | The task was reclaimed by another owner |
| `state_violation` | 409 | Not valid for the record's current state |
| `contact_conflict` | 409 | The recipient asked not to be contacted this way |
| `rate_limited` | 429 | Transient, with a saved cooldown |
| `capability_unavailable` | 501 | No extractor for that file type, for example |

## Endpoints

### Bootstrap and status

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/bootstrap` | Session token, allowed origins, status, next actions, execution mode |
| GET | `/api/status` | Full workspace status and suggested next actions |
| GET | `/api/settings` · PUT | Read and write `config/research.json`, plus runtime facts |

### Registry

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/universities` | Universities with unit counts and selection summaries |
| GET | `/api/entities/:id` | One entity with its aliases and relationships |
| GET | `/api/relationships?entity=&limit=&university=` | Typed, sourced relationships (`university` is ignored when `entity` is given) |
| GET | `/api/units?university=` | The unit tree with effective decisions |
| GET | `/api/units/progress?university=` | Per-unit task, people and program counts (see below) |
| GET | `/api/programs?university=` · `/api/programs/:id` | Program list and detail with claims |
| GET | `/api/people?unit=&ready=&university=` | People with affiliations, labs and readiness |
| GET | `/api/people/:id` | Profile, source map (with `fetch_method` and `latest_fetch_method`), publications, relationships, tasks |
| GET | `/api/labs?university=` · `/api/labs/:id` | Laboratories and their membership evidence |
| GET | `/api/duplicates?university=` · POST `/api/duplicates/merge` | Duplicate candidates and merges |
| GET | `/api/discovery-queue` | Discoveries awaiting your decision |
| GET | `/api/search?q=&limit=&university=` | Cross-entity search (see below) |

#### The `university` filter

Every list endpoint accepts an optional `university=<university-id>`. Without it
the query is exactly what it was before the parameter existed. With it, a row
belongs when:

- a **program** has that `university_id`;
- a **person** is affiliated with one of its units, or is a member or director
  of a lab it owns;
- a **lab** has that `university_id`, or has none recorded and a member who is
  affiliated with one of its units;
- a **draft**, **send plan** or **sent record** belongs through its program or
  its recipient;
- a **task** is governed by the university's selection scope, or targets the
  university itself;
- a **relationship** or **duplicate candidate** has either side in the
  university.

An unknown id simply matches nothing.

#### `GET /api/search`

`q` (1–100 characters, required), `limit` (1–50, default 20), `university`
(optional). Returns `{ results: [{ kind, id, title, subtitle, href }], truncated }`.
`kind` is one of `person`, `draft`, `program`, `unit`, `lab`, `task`, `note`,
`university`; `href` is the interface route that shows the hit. Matching is a
case-insensitive substring match with `%`, `_` and `\` treated literally.
Prefix matches rank first, then kinds in the order above. A `note` hit is a
match in a note's title or body whose entity is not already listed.

#### `GET /api/units/progress`

`{ units: [{ unitId, name, unitType, decision, depth, tasks: { total, complete,
blocked, running, pending, failed }, people: { total, researchComplete,
emailReady }, programs }] }` for every unit of the university, in tree order.
Task counts cover the unit's own tasks plus the tasks of the people affiliated
with it. Derived on request; nothing is cached.

### Selection

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/scopes/:id` | — |
| PUT | `/api/scopes/:id/selection` | `{ expectedVersion, decisions[], personExceptions?, note? }` |
| POST | `/api/scopes/:id/confirm` | `{ expectedVersion, enqueue }` |
| POST | `/api/scopes/:id/enqueue` | — |

`expectedVersion` is mandatory. A stale value is refused with
`revision_conflict` rather than applied.

### Notes

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/notes?path=<vault-relative>` | Text, hash, frontmatter and revision history |
| PUT | `/api/notes` | `{ path, text, expectedSha }` |
| GET | `/api/issues` · POST `/api/issues/:id/resolve` | Open note issues |

### Queue

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/tasks?job=&state=&target=&ready=&university=` | Tasks with blockers, counts, job catalogue, concurrency, execution mode |
| POST | `/api/tasks` | `{ job, targetId, params?, priority? }` |
| GET | `/api/tasks/:id` | Task, checkpoints, runs, and the skill command to run it |
| POST | `/api/tasks/:id/retry` · `/cancel` | Retry, or cancel with a reason |
| POST | `/api/tasks/reclaim` | Reclaim expired leases |
| GET | `/api/queue/commands` | The exact skill commands for what is ready |

`/api/tasks` reports `execution.mode: "interactive_claude_code"`. The server
cannot start a research run and does not pretend otherwise.

### Applicant and documents

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/applicant` | Profile and style files with revision and approval state |
| PUT | `/api/applicant/:kind` | `{ text, expectedSha?, name? }` |
| POST | `/api/applicant/:kind/approve` | `{ sha256 }` |
| GET | `/api/documents` | Documents, versions and recorded facts |
| POST | `/api/documents` | `{ kind, originalFilename, contentBase64, displayName?, documentId? }` |
| GET | `/api/documents/:id/content?version=` | Bytes, by registered id only |
| POST | `/api/documents/:id/extract` | See below |
| POST | `/api/documents/:id/review` | `{ version, state }` |
| POST | `/api/facts` · `/api/facts/:id/verify` | Record and verify a fact |

Documents are uploaded as a payload, never as a path the server then reads.
`GET /api/documents` lists each version with its latest `extraction`
(`method`, `status`, `text_path`, `page_count`, `created_at`) or `null`.

#### `POST /api/documents/:id/extract`

The server itself extracts only plain text and Markdown. A PDF or any other
binary is never parsed here: Claude reads it through the `/import-document`
skill, or a person pastes the text. The body chooses the path:

| Body | Effect |
| --- | --- |
| `{}` or `{ version }` | Built-in extraction for `.txt`/`.md`; anything else is recorded `unavailable` with a hint to run `/import-document <id>` |
| `{ text, method: 'manual_paste' \| 'claude_read', pageCount?, version?, detail? }` | Stores the text verbatim under `applicant/extracted/`, records the method as provenance, audits `document.extract_external`. Empty text is refused |
| `{ status: 'unavailable', detail, method?, version? }` | Records that the document could not be read (image-only scan, corrupt file) with the reason and no text |

In every case the document version stays `unreviewed` until a person verifies
it; extracted text is data and is never interpreted.

### Outreach

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/outreach?state=&person=&university=` | Draft list |
| GET | `/api/outreach/:id` | Reconciles first, then content, approval, plan, sends, revisions |
| GET | `/api/outreach/:id/revisions/:revision` | One stored revision: `{ revision, recipient, subject, body, fingerprint, source, created_at }` (404 if absent) |
| PUT | `/api/outreach/:id` | `{ expectedSha, recipient?, subject?, body?, attachments? }` |
| POST | `/api/outreach/:id/validate` | Re-read from disk and validate |
| POST | `/api/outreach/:id/approve` | `{ fingerprint, note? }` — the exact fingerprint |
| POST | `/api/outreach/:id/return` · `/archive` | `{ reason, undo? }` |

### Timing and sending

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/outreach/:id/suggest-time` | An editable weekday-morning suggestion |
| PUT | `/api/outreach/:id/send-plan` | `{ date, time, zone?, occurrence?, note? }` |
| GET | `/api/send-plans?university=` | Plans with recalculated due state and zone drift |
| POST | `/api/outreach/:id/mark-sent` | `{ idempotencyKey, sentAt?, messageReference?, note?, allowUnapproved? }` |
| GET | `/api/sent?university=` · `/api/sent/:id/snapshot` | History and immutable snapshots |
| POST | `/api/sent/:id/correct` | `{ field, value, reason }` — appends, never rewrites |

A nonexistent local time returns 400 with `detail.code = "nonexistent_local_time"`
and the nearest valid times. An ambiguous one returns
`detail.code = "ambiguous_local_time"` with both instants; pass `occurrence`.

`mark-sent` is idempotent on `idempotencyKey`: the same key returns the one
recorded event with `duplicate: true`, including when two reports race. The
interface derives its default key from the draft id and the approved
fingerprint, so a repeated click records one send; recording a second, separate
send needs a new key on purpose.

### Changes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/events?since=&limit=` | Poll the change feed |
| GET | `/api/events/stream?since=` | The same feed as server-sent events (`hello`, `change`, `ping`; one shared poller serves every open stream) |

Change-feed rows older than `events.retentionDays` (default 30) are pruned by
`reconcile`. Rows mirrored from the audit trail (`audit:*`) are never pruned;
the audit table itself is immutable.

### Maintenance

| Method | Path |
| --- | --- |
| POST | `/api/maintenance/reconcile` (`{ full? }`) · `/check-links` · `/views` · `/backup` |
| GET | `/api/maintenance/backups` |

`reconcile` skips a note whose size and mtime match the index without
re-reading it; `{ "full": true }` re-hashes every note. Its report includes
`skippedByStat`, `prunedEvents` and `readinessRefreshed` (every person's
derived `email_ready` is recomputed on each run).

## CLI

Invoked as `npm run research -- <command>`. It runs core operations directly and
never needs the HTTP server. Add `--json` for structured output and a non-zero
exit code on error. Global options: `--root <dir>`, `--driver <name>`, `--json`.

```
init                       Create directories, schema and blank templates
status                     Progress, ready work, blockers, next actions
diagnose                   Node, driver, Temporal, integrity, paths
reconcile [--full]         Recover commits and pick up manual edits (--full re-hashes every note)
verify-links               Check relative links and portable filenames
views                      Rebuild the generated dashboards
args-parse --file <path>   Parse raw skill arguments without a shell

university start --name "..." [--homepage <url>] [--domain <d>]
university list

scope show    --university <id>
scope select  --scope <id> --expect <v> --include <unit-id> --exclude <unit-id>
scope confirm --scope <id> --expect <v> [--enqueue]
scope enqueue --scope <id> [--jobs research_programs,discover_people]

tasks list [--job 1-7] [--state <s>] [--target <id>] [--ready]
tasks enqueue --job <1-7> --target <id> [--param k=v] [--priority <n>]
tasks claim --owner <id> [--task <id>] [--job <n>] [--target <id>] [--lease <s>] [--force]
tasks packet --task <id>
tasks renew --task <id> --owner <id> --token <n>     (capped by leases.maxRenewals per run)
tasks checkpoint --task <id> --owner <id> --token <n> --kind <k> [--label <t>]
tasks checkpoints --task <id>
tasks complete --task <id> --owner <id> --token <n> [--result <path>]
tasks fail --task <id> --owner <id> --token <n> --error "..." [--category <c>]
tasks retry|cancel --task <id>
tasks reclaim

people list [--unit <id>]
people ready

sources needs-browser [--person <id>]   Sources whose last outcome (needs_browser, blocked,
                                        captcha, rate_limited) a browser retrieval may resolve

drafts list|show|validate|history --draft <id>
drafts create --file <path>
drafts edit --draft <id> --expect-sha <sha> [--recipient|--subject|--body-file|--attach doc:v]
drafts approve --draft <id> --fingerprint <sha256>
drafts return|archive --draft <id> --reason "..."

send-plan suggest --draft <id>
send-plan set --draft <id> --date YYYY-MM-DD --time HH:MM [--zone <IANA>] [--occurrence earlier|later]
send-plan list
mark-sent --draft <id> --key <idempotency-key> [--at <ISO>] [--allow-unapproved]
sent list [--draft <id>]
sent correct --event <id> --field <f> --value <v> --reason "..."

applicant show|snapshot|write|approve --kind profile|style
documents import --kind <k> --file <path>
documents list
documents extract --document <id> [--version <n>]                       built-in (.txt/.md only)
documents extract --document <id> --text-file <path> --method claude_read|manual_paste [--pages <n>]
documents extract --document <id> --status unavailable --detail "<why>" [--method claude_read]
documents review --document <id> --version <n> --state <s>
facts add|list|verify

notes show|write|history --path <vault-path>
notes issues [--resolve <id>]
entities duplicates
entities merge --keep <id> --merge <id> --reason "..."
backup create|list|restore
```

`diagnose` also reports the schema version and warns when an applied
migration's recorded checksum no longer matches the source (an edited migration
is never re-run).

Completion is not a flag you set. `tasks complete` validates the result against
its schema, checks the live scope version and fencing token, installs the
artifacts and flips the state in one recoverable commit — or it fails and the
task stays where it was.
