# Requirement to implementation matrix

Every requirement from `UNIVERSITY_RESEARCH_ARCHITECTURE.md` and
`CLAUDE_CODE_BUILD_PROMPT.md`, where it lives in the code, and how it was
verified. `docs/verification.md` records what was actually run.

Test references are file names under `tests/acceptance/` (Node's test runner)
and `tests/e2e/` (Playwright).

## A. Product and execution model

| Requirement | Implementation | Verification |
| --- | --- | --- |
| `/research-university "Name"` starts discovery | `.claude/skills/research-university/SKILL.md`; `startUniversityResearch` in `packages/core/src/jobs/orchestration.ts` | `01-pipeline` |
| Seven independently runnable jobs | `packages/core/src/tasks/definitions.ts`; one skill each under `.claude/skills/` | `01-pipeline`, `02-scope` |
| Persistent state; conversation memory never required | Everything reads from SQLite and the vault; `reconcileVault` on every entry point | `04-recovery` |
| Interactive Claude Code is the orchestrator | Skills drive `tasks claim` → subagent → `tasks complete` | `12-api`, `e2e/flows` |
| UI queues work and shows the exact command | `GET /api/queue/commands`; `apps/web/src/routes/Queue.tsx`, `Overview.tsx` | `12-api`, `e2e/flows` |
| "Queued — start or resume Claude Code" when nothing runs | `Queue.tsx` notice driven by `status.activeRuns` | `e2e/flows` |
| No API key, Agent SDK, unattended runner or paid connector | No such dependency exists; `/api/bootstrap` states the execution model | `12-api` |
| Emails are for manual sending | No mail transport anywhere; `markSent` records a user report only | `05-idempotency`, `07-approval` |

## B. Technology and platforms

| Requirement | Implementation | Verification |
| --- | --- | --- |
| TypeScript npm workspaces | Root `package.json` workspaces; project references in `tsconfig.build.json` | `npm run build` |
| React + Vite frontend | `apps/web` (React 19, Vite 8, React Router 7) | `npm run build`, `e2e/flows` |
| Express local API | `apps/server/src/app.ts` | `12-api` |
| Shared core used by API and CLI | `packages/core`, imported by both | `12-api` and every CLI test |
| SQLite through a small adapter | `packages/db/src/driver.ts` — better-sqlite3 first, `node:sqlite` fallback | `npm run doctor`; adapter selection reported by `diagnose` |
| Migrations, short transactions | `packages/db/src/migrations/index.ts`, `Database.transaction` with SAVEPOINTs and bounded busy retries | every test |
| Markdown with typed YAML frontmatter and real links | `packages/core/src/notes/*`, `packages/core/src/schemas/notes.ts` | `01-pipeline`, `06-editing` |
| Node 24 LTS, pinned deps | `engines.node >= 24`; `save-exact=true`; exact versions in every manifest | `npm run doctor` |
| Maintained IANA support with explicit DST handling | `packages/core/src/time/temporal.ts`, `planner.ts` | `08-timezones` |
| Windows, macOS, Linux; no Bash/cron/systemd/Docker | Node APIs throughout; `scripts/*.mjs` spawn without a shell; portable filename checks | Linux locally; `.github/workflows/ci.yml` for all three |
| `npm install|run dev|run build|start|test|run research` | `package.json` scripts, all cross-platform | README |

## C. The seven jobs

| Job | Contract | Applier | Worker | Verification |
| --- | --- | --- | --- | --- |
| 1 University and department discovery | `UniversityDiscoveryResult` | `applyUniversityDiscovery` | `university-discoverer` | `01-pipeline`, `02-scope` |
| 2 MASc program research | `ProgramResearchResult` | `applyProgramResearch` | `program-researcher` | `01-pipeline`, `09-evidence` |
| 3 People discovery | `PeopleDiscoveryResult` | `applyPeopleDiscovery` | `people-discoverer` | `01-pipeline`, `03-identity` |
| 4 Source mapping | `SourceMapResult` | `applySourceMap` | `source-mapper` | `01-pipeline`, `09-evidence` |
| 5 Deep person research | `PersonResearchResult` | `applyPersonResearch` | `person-researcher` | `01-pipeline`, `09-evidence` |
| 6 Laboratory research | `LabResearchResult` | `applyLabResearch` | `lab-researcher` | `01-pipeline`, `03-identity` |
| 7 Email drafting | `OutreachDraftResult` | `applyOutreachDraft` | `email-drafter` | `01-pipeline`, `07-approval` |
| Verification | `VerificationResult` | `applyVerification` | `verifier` | `01-pipeline` |

Schemas: `packages/core/src/jobs/schemas.ts`. Appliers: `packages/core/src/jobs/apply.ts`.

### Job-specific rules

| Rule | Where | Verification |
| --- | --- | --- |
| A note for every discovered unit, including excluded ones | `applyUniversityDiscovery` writes one note per unit before any selection | `01-pipeline` asserts 5 notes for 5 units |
| Units default to undecided; no silent selection | `scope_units` empty until the user decides; `effectiveUnitDecision` returns `undecided` | `02-scope`, `10-safety` |
| Explicit child decisions override inherited ones | `effectiveUnitDecision` walks explicit-first | `02-scope` |
| Exact degree names preserved; no substitution | `official_title`/`award` recorded verbatim; `no_program_found` | `01-pipeline` (verbatim IELTS and funding wording) |
| Degree scope gate | `applyProgramResearch` filters on `config.degreeScope` | `apply.ts` `excludedByDegreeScope` in the summary |
| Rank ≠ role category | Separate `official_title` and `role_category` columns and enums | `01-pipeline` asserts assistant vs assistant professor |
| Directory pagination and a coverage ledger | `coverage` block written into the unit note | `01-pipeline` |
| One person record across departments and labs | `resolveOrCreateEntity` with strong anchors | `03-identity` |
| Names alone never merge | `ANCHOR_STRENGTH`; weak anchors only raise a duplicate candidate | `03-identity` |
| Source map records category, provenance, identity, access, dates | `person_sources` + source-map note | `01-pipeline`, `09-evidence` |
| Blocked Scholar recorded, never claimed as inspected | Access status persisted; note says so | `09-evidence` |
| Fresh isolated context per candidate | `buildContextPacket` writes one packet per run directory | `01-pipeline`; isolation gate in `docs/verification.md` |
| Configurable candidate concurrency | `config.concurrency.candidates`, enforced in `claimTask` | `queue.ts`; surfaced in the Queue screen |
| Full publication inventory; honest summary labels | `summary_basis` of `full_text`/`abstract_only`/`metadata_only` | `09-evidence` |
| Shared publication note between co-authors | Publication resolved by DOI; `author_entity_ids` accumulates | `01-pipeline`, `09-evidence` |
| Preprint distinguished from final version | `is_preprint`, `version_of` | `09-evidence` |
| Budget exhaustion leaves the task partial | `scope.budget_exhausted` → state `partial` | `09-evidence` |
| Targeted verifier | `verify_person` job and `verifier` agent | `01-pipeline` |
| New assistants added to the registry with role and source | Job 5 and 6 create entities, stub notes and discovery-queue rows | `03-identity` |
| Lab membership evidence; former members preserved | `relationships.status`, `observed_at`; lab note wording | `03-identity` |
| Person and lab enrichment do not deadlock | Job 6 has no hard dependency on Job 5, or vice versa | `01-pipeline` runs both |
| Job 7 eligibility gate | `evaluateEmailReadiness` | `09-evidence`, `07-approval` |
| Unknown availability may be a question, never a claim | Supervision section wording; no blocker for `no_public_information` | `09-evidence` |
| Attachments default to none | `createDraft` with an empty list; the note says so | `09-evidence` |
| Portal-only or do-not-email blocks ordinary outreach | `contact_conflict_*` blockers; `createDraft` refuses | `09-evidence` |

## D. Dependency and workflow engine

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Per-record prerequisites, no global phase | `computeBlockers` evaluates live state per task | `02-scope` |
| Jobs 2 and 3 independent after selection | `enqueueScopedWork` queues both; neither depends on the other | `02-scope` |
| Direct invocation, filters, pause, retry, resume, refresh, status | CLI `tasks` verbs; `retryTask`, `cancelTask`, `reclaimExpiredLeases` | `05-idempotency`, `04-recovery` |
| All nine task states | `TaskState` union, used throughout | `02-scope`, `04-recovery`, `09-evidence` |
| Task identity includes scope version, inputs, params, schema | `taskDedupeKey` | `05-idempotency` |
| Idempotent enqueue | `dedupe_key` UNIQUE; `enqueueTask` returns the existing task | `05-idempotency` |
| Refreshing style must not rerun discovery | Identity excludes unrelated inputs; drafts and discovery are separate targets | `05-idempotency` |
| Configurable defaults | `config/research.json` | `docs/workflow.md` |
| Short-transaction claim with owner, lease, fencing token | `claimTask` | `04-recovery` |
| Reclaimed tasks reject late commits | Token equality in `validatePreconditions` and `assertOwnership` | `04-recovery` |
| No exactly-once claim; idempotent accepted results | Documented in `docs/workflow.md`; replay proven idempotent | `04-recovery` |
| Workers write only to their run directory | Packets and results live under `data/runs/<run-id>/` | `01-pipeline` |
| Live scope and input revisions validated before commit | `validatePreconditions` | `02-scope` |
| Prepared commit manifests, per-entity locks, retained revisions, atomic replace, idempotent replay | `packages/core/src/commit/*` | `04-recovery` |
| External edits preserved on conflict | `applyCommit` phase 1 refuses and records the conflict | `04-recovery` |
| Fresh session recovers pending commits and resumes | `recoverCommits` in `reconcileVault`, called on CLI and server start | `04-recovery` |
| Backoff with jitter, persisted cooldowns | `failTask`; `next_attempt_at`; cooldown is a blocker | `queue.ts`, `docs/workflow.md` |
| Distinct error categories | `AppErrorCode`; `failTask` categories | `12-api` status codes |

## E. Data ownership and Markdown editing

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Central entity registry with stable ids and canonical paths | `packages/core/src/registry.ts`; `entities` table | `01-pipeline` |
| SQLite owns identity, scope, relationships, sources, tasks, review, times | Schema in `packages/db/src/migrations` | `11-backup` |
| Markdown owns research, summaries, email content, applicant files | `vault/`, `applicant/` | `06-editing` |
| Copied content is a rebuildable index | `note_index.body_text`, documented | `docs/data-ownership.md` |
| Reconcile on startup, explicit, open, approval, mark-sent, file change | `reconcileVault`, `reconcileDraft` at each of those points | `06-editing`, `07-approval` |
| Hashes checked even if a watcher missed an event | Reconciliation hashes every file | `06-editing` |
| Manual edits preserved; visible conflicts, never last-write-wins | `applyUserEdit`, `composeGeneratedNote` | `06-editing` |
| Invalid frontmatter does not destroy a file | `parseNote` throws; bytes untouched; issue recorded | `06-editing` |
| Protected id and relationship changes become conflicts | Id change refused; edited blocks preserved and reported | `06-editing` |
| Real relative links throughout | `markdownLink`, `relativeNoteLink` | `01-pipeline`, `06-editing` |
| Link checker, duplicate titles, case collisions, portable names | `checkLinks`, `assertPortableFilename` | `06-editing`, `10-safety` |

## F. Applicant documents and writing context

| Requirement | Implementation | Verification |
| --- | --- | --- |
| `applicant/` tree with blank templates | Created by `init` from `templates/applicant-*.md` | `init` output |
| Versioned private documents with ids and hashes | `importDocument`; `documents` and `document_versions` | `07-approval`, `10-safety` |
| Extracted facts carry a source and verification status | `document_extractions`, `extracted_facts` | `10-safety` |
| Extraction unavailable → manual entry, never fabrication | `extractDocumentText` reports `unavailable` with guidance | `10-safety` |
| Approved applicant revision required for email claims | `approvedApplicantRevision` gate in readiness | `09-evidence` |
| Only the approved summary loads into ordinary contexts | `resolveWritingGuidance` returns the approved bytes | `orchestration.ts` packets |
| Attachment selection per email, defaulting to none | `createDraft`/`updateDraft` | `09-evidence` |
| Replacing bytes invalidates the affected approval | Fingerprint includes attachment version and hash | `07-approval` |
| Private material out of source control | `.gitignore` | file contents |

## G. Email approval, timing and sent history

| Requirement | Implementation | Verification |
| --- | --- | --- |
| `draft → needs_review → approved → sent`, plus archive | `outreach.state`; `drafts.ts`, `review.ts` | `07-approval` |
| Approval binds recipient, subject, exact body, attachment versions | `draftFingerprint` | `07-approval` |
| Any such change returns it to review | `reconcileDraft` invalidates and flips state | `07-approval`, `e2e/flows` |
| Readiness re-evaluated before approval | `evaluateEmailReadiness(stage: 'approve')` | `readiness.ts` |
| Planned time stores wall time, zone, instant, display zone | `send_plans` | `11-backup` |
| Zone evidence and inference shown | `zone_basis` surfaced in the API and UI | `e2e/flows` |
| DST gaps and repeated times handled explicitly | `resolveLocalTime` | `08-timezones`, `e2e/flows` |
| Editable weekday window, labelled a heuristic | `suggestSendWindow` rationale text | `08-timezones` |
| No SMTP, scheduling, or delivery polling | None exists | grep; `docs/verification.md` |
| Passing a time only changes a view | `dueState`; state never changes | `05-idempotency`, `e2e/flows` |
| Mark-sent needs explicit report, snapshot, source, idempotency key | `markSent` | `05-idempotency`, `07-approval` |
| Never infer sent from approval, copying or elapsed time | Only `markSent` writes a sent event | `05-idempotency` |
| Record an already-sent changed or unapproved message | `allowUnapproved` path; `was_approved` kept false | `05-idempotency` |
| Sent records immutable; corrections append | `correctSentRecord` writes an audit event | `07-approval` |

## H. React application and API

| Screen | Route | Component |
| --- | --- | --- |
| Overview and job progress | `/` | `Overview.tsx` |
| Department hierarchy and scope selection | `/scope` | `ScopeSelection.tsx` |
| Program browser | `/programs` | `Programs.tsx` |
| People table | `/people` | `People.tsx` |
| Person profile, source map, publications | `/people/:id` | `PersonDetail.tsx` |
| Lab browser and relationships | `/labs`, `/labs/:id` | `Labs.tsx` |
| Task queue, blockers, retry, concurrency | `/queue` | `Queue.tsx` |
| Applicant profile, documents, style | `/applicant` | `Applicant.tsx` |
| Email editor, preview, brief, attachments, diff | `/outreach/:id` | `EmailWorkspace.tsx` |
| Explicit approval | `/review` | `Review.tsx` |
| Timezone planner, due/overdue, mark sent | `/planner` | `SendPlanner.tsx` |
| Sent history and corrections | `/sent` | `SentHistory.tsx` |
| Relationship view | `/connections` | `Connections.tsx` |
| Settings and backup | `/settings` | `Settings.tsx` |

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Same core rules through UI and CLI | Both call `packages/core` | `12-api` |
| Queued distinguished from executing | `status.activeRuns` drives the notice | `e2e/flows` |
| Loopback binding, host/origin/session checks | `apps/server/src/security.ts` | `12-api` |
| Sanitised Markdown | `apps/web/src/lib/markdown.ts` (DOMPurify allow-list) | `10-safety`, code review |
| Registered document ids and validated paths | `documentBytes` + `resolveWithin` | `10-safety`, `12-api` |
| No user string reaches a shell | `spawn` without a shell; no `exec` anywhere | grep in `docs/verification.md` |
| Version-aware note and draft endpoints | `expectedSha`, `expectedVersion`, `fingerprint` | `12-api` |
| Idempotent mutation commands | `idempotencyKey` on mark-sent; upserts elsewhere | `05-idempotency`, `12-api` |
| Activity through polling or SSE | `/api/events`, `/api/events/stream` | `12-api` |
| Accessible labels and keyboard navigation | Labelled controls, roles, skip link, visible focus | `e2e/flows` role-based selectors |

## I. Files and Claude integration

| Requirement | Location |
| --- | --- |
| `CLAUDE.md`, `README.md`, `package.json`, lockfile | repository root |
| `apps/web`, `apps/server` | present |
| `packages/core`, `packages/db`, `packages/cli` | present |
| `config`, `templates`, `docs` | present |
| Applicant directories | `applicant/{overrides,documents,extracted}` |
| Vault directories | `vault/{universities,units,programs,people,labs,publications,sources,outreach,views}` |
| Data directories | `data/{runs,revisions,commits,cache,backups,tmp}` and `research.sqlite` |
| `tests/fixtures` and automated tests | `tests/fixtures/`, `tests/acceptance/`, `tests/e2e/` |
| Ten project skills | `.claude/skills/*/SKILL.md` |
| Eight workers | `.claude/agents/*.md` |
| Root skill supports `--job 1-7`, `--resume`, scoped refresh | `research-university/SKILL.md` |
| `$ARGUMENTS` used safely | `args-parse --file`; never interpolated into a shell |
| Model choice configurable, defaults to inherit | `workers.model: "inherit"`; no model id hard-coded in any agent |
| Concise `CLAUDE.md`; long instructions in skills | 100 lines vs. detailed skills |
| CLI verbs | `docs/api.md` |
| Completion requires validated artifacts | `applyJobResult` → schema → preconditions → commit |

## J. Research integrity

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Official sources preferred | `config/source-policy.md`, repeated in every agent | policy files |
| Confirmed / inferred / unknown / conflicting kept distinct | `EvidenceStatus`; `claim_index.evidence_status` | `09-evidence` |
| Dates and qualifiers preserved | `checked_at` separate from publication dates | `01-pipeline` |
| Never infer accepting students or funding | Explicit wording in notes and agents; no such inference in code | `09-evidence` |
| Never invent addresses, identities or qualifications | Recipient requires `confirmed` evidence; claims need sources | `09-evidence` |
| Inaccessible sources recorded with alternatives | `access_status`, `blocked[]`, `absent_categories` | `09-evidence` |
| No authentication or CAPTCHA bypass | Stated in policy and every agent; no such code exists | policy files |
| Retrieved text treated as untrusted evidence | Stated everywhere; proven not to affect state | `10-safety` |
| Freshness by source and claim type | `config.freshness`; `claim_index.freshness_class` | `readiness.ts` |
| Stale critical facts re-checked before approval | `stage: 'approve'` promotes them to blockers | `readiness.ts` |
| Historical summaries not regenerated needlessly | Publication notes keyed by DOI; unchanged content is skipped | `commit.ts` skip path |

## K. Verification and completion

The fifteen acceptance criteria are listed with their evidence in
`docs/verification.md`.
