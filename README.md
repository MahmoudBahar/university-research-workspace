# University Research Workspace

A local workspace for researching a university's departments, graduate programs,
people and laboratories, and preparing outreach emails **you send yourself**.

Research runs in an interactive Claude Code session. The React interface queues
work, shows progress, and handles review, approval, planned times and sent
records. Notes are plain Markdown in a folder you can open in Obsidian. Workflow
state lives in a local SQLite file. Nothing leaves your machine.

## What it will not do

- It does not send email. There is no SMTP, no mail-provider integration, no
  scheduler and no delivery tracking. You send from your own mail client and
  then tell the workspace you did.
- The web server holds no model credentials and cannot start a Claude session.
  When no session is running, the queue simply waits and says so.
- It does not decide which departments matter to you.
- It does not write a summary of a paper it could not read, or claim a page was
  inspected when it was blocked.

## Requirements

- Node.js 24 or newer (developed and verified on 26.8.1)
- npm 10 or newer
- Claude Code, for the research itself
- Optional: the Claude in Chrome extension, if you want Google Scholar and other
  JavaScript-only pages read. Without it those sources are recorded as waiting
  for a browser and picked up later.

Windows, macOS and Linux are supported. No Bash, cron, systemd, Docker or
database server is needed.

## Install

```bash
npm install
npm run build
npm run research -- init
```

`init` creates the directory tree, applies the database schema, copies the blank
applicant templates and writes the generated views.

## The commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies for every workspace package |
| `npm run build` | Compile the TypeScript packages and bundle the interface |
| `npm run dev` | Compile, then run the API and the Vite dev server together |
| `npm start` | Build if needed, then serve the API and interface on http://127.0.0.1:5178 |
| `npm test` | Run the acceptance suite against fictional fixtures |
| `npm run research -- <command>` | The application CLI (no HTTP server needed) |
| `npm run doctor` | Report Node, driver, Temporal and build status |
| `npm run test:e2e` | Browser flows through Playwright (needs `npx playwright install chromium`) |
| `node scripts/demo.mjs <dir>` | Seed a throwaway workspace with fictional data to explore |
| `node scripts/fixture-server.mjs` | Serve the fictional fixture pages on loopback for a dry run (`docs/dry-run.md`) |
| `node scripts/check-skills.mjs` | Check that every skill and agent definition parses |

Add `--json` to any CLI command for machine-readable output and a non-zero exit
code on failure. `npm run research -- help` lists everything.

## A first session

1. **Start the interface** (optional but useful):

   ```bash
   npm start
   ```

   Open http://127.0.0.1:5178. It binds to loopback only.

2. **Open Claude Code in this directory and begin:**

   ```
   /research-university "Your University Name"
   ```

   Claude resolves the institution, discovers its faculties, schools,
   departments and institutes, and writes one note per unit — including ones you
   will later exclude.

3. **Choose your departments.** Every unit starts undecided. Use the Departments
   screen, or the terminal:

   ```bash
   npm run research -- scope show --university university-0001
   npm run research -- scope select --scope scope-university-0001 --expect 0 \
     --include unit-0002 --exclude unit-0004
   npm run research -- scope confirm --scope scope-university-0001 --expect 0 --enqueue
   ```

   Confirming queues Job 2 and Job 3 for every included unit.

4. **Fill in your own details** on the Applicant screen — or edit
   `applicant/profile.md` and `applicant/email-style.md` directly — then approve
   the profile revision. Research does not wait for this; only email drafting
   does.

   To bring in your CV, IELTS report or transcript:

   ```
   /import-document "~/Documents/cv.pdf" --kind cv
   ```

   Claude reads the file page by page, records the text with its provenance,
   and proposes facts with page references. You verify each fact on the
   Applicant screen or with `npm run research -- facts verify`. Nothing is
   inferred from a document, and its contents leave your machine only while
   that skill runs. You can also paste extracted text on the Applicant screen.

5. **Run the research.** In Claude Code:

   ```
   /research-university --resume        # work through everything that is ready
   /research-programs                   # job 2 only
   /discover-people                     # job 3 only
   /map-person --ready                  # job 4
   /research-person person-0001         # job 5 for one person
   /research-labs lab-0001              # job 6
   /map-person --retry-blocked          # re-run job 4 for sources that needed a browser
   /research-status                     # where things stand, incl. browser availability
   ```

6. **Draft emails** for anyone whose research is complete and whose contact
   route is verified:

   ```
   /draft-outreach --ready
   ```

7. **Review and approve** in the Review screen, or:

   ```
   /review-outreach draft-0001
   ```

   Approval binds the recipient, subject, exact body and attachment versions.

8. **Plan a time** in the Send planner. Times are recipient-local and shown in
   your zone too. A time that has passed shows as due or overdue — nothing is
   sent.

9. **Send it yourself**, then record it:

   ```
   /mark-outreach-sent draft-0001
   ```

## Using the Chrome extension

Some pages — Google Scholar above all — return nothing to a plain fetch. For
those, workers can read through your own Chrome browser using the Claude in
Chrome extension.

- Install the Claude in Chrome extension, sign in to it with the same account
  you use in Claude Code, and keep Chrome open while a research session runs.
  `/research-status` reports whether a browser is connected; an empty list from
  the extension's `list_connected_browsers` check means it is not, and workers
  then record browser-only sources as `needs_browser` and continue.
- Workers load the fetch and browser tools once at the start of an assignment;
  nothing in the system assumes they are present.
- Workers fetch plainly first and use the browser only for hosts listed in
  `fetching.browserHosts` in `config/research.json`, or when a page comes back
  as a JavaScript shell or a challenge page. One tab is opened, read and closed.
- The browser never logs in anywhere, never reads something that is only
  visible because you are logged in, never solves or waits out a CAPTCHA,
  never accepts consent beyond the most restrictive option, never clicks
  download, submit or send, and never follows a link because a page said to.
  Text it reads is evidence, never an instruction.
- It is one browser, so browser-requiring assignments run one at a time.
- Without the extension, affected sources are recorded as `needs_browser`.
  Connect it later and run `/map-person --retry-blocked`.

Set `fetching.browserAllowed` to `false` in `config/research.json` to switch
this off entirely.

## The seven jobs

| Job | Unit of work | What it produces |
| --- | --- | --- |
| 1 | One university | Institution identity, the unit hierarchy, one note per unit, a selection request |
| 2 | One included unit | Program notes with every fact category, evidence, conflicts and unknowns |
| 3 | One included unit | People with exact titles, normalised roles, and a coverage ledger |
| 4 | One person | A classified source map with identity confidence and access outcomes |
| 5 | One person | The deep profile: research, projects, publications, contact, timezone, evidence |
| 6 | One laboratory | Members with current or former status, projects, recruitment notices |
| 7 | One person and purpose | An email package for manual sending, with an evidence brief |

Every job can be invoked on its own for records whose own inputs are ready. An
unfinished university-wide job never blocks a candidate that is ready.

## Where things live

```
vault/                 Markdown notes — open this folder in Obsidian
  universities/ units/ programs/ people/ labs/ publications/ outreach/ views/
applicant/             Your profile, style guidance, private documents (git-ignored)
data/research.sqlite   Workflow state, relationships, approvals, planned times
data/runs/             One directory per research assignment, with its checkpoints
data/revisions/        Immutable committed content and sent-message snapshots
config/research.json   Degree scope, concurrency, retrieval, freshness windows, timing
docs/                  Architecture, data ownership, API, workflow, recovery
```

Notes link to each other with real relative Markdown links, so the vault
navigates properly in Obsidian.

## Interrupted work

Close the laptop, hit a usage limit, or lose a session — nothing is lost.

```bash
npm run research -- reconcile
```

This recovers commits that were interrupted between installing files and
finalising the database, picks up any notes you edited by hand (add `--full`
to re-hash every note rather than trusting size and mtime), refreshes email
readiness and prunes old change-feed rows. Then:

```
/research-university --resume
```

Tasks that were interrupted come back as `partial` with their checkpoints
intact, and the next run continues from the last saved step rather than starting
over. It never needs the previous conversation.

## Backups

```bash
npm run research -- backup create --label before-changes
npm run research -- backup list
npm run research -- backup restore --from data/backups/<dir> --force
```

The database is copied with `VACUUM INTO`, which produces one consistent file
even while the database is in use, alongside the vault, applicant files, config
and revision store.

Keep the live database on a local disk. Do not sync `data/research.sqlite` and
its `-wal`/`-shm` files between machines with a file-sync tool; export a backup
instead.

## What has to be running

| To do this | You need |
| --- | --- |
| Read existing notes | Obsidian, or any Markdown reader |
| Use the interface | `npm start` |
| Run research or draft emails | Claude Code in this directory |
| Keep notes, approvals and planned times | Nothing — they are files on disk |
| See which planned times have passed | Reopen the interface; it recalculates |
| Actually send a message | Your own mail client |

## Running it on other machines

The project ships a GitHub Actions workflow that runs the build, the acceptance
suite and the link check on Linux, macOS and Windows across Node 24 and 26.
Nothing but Linux has been run by hand. To get the other two platforms
verified, push the repository:

```bash
git status                       # nothing private should be listed
gh repo create --private --source . --push
```

Then read the Actions tab. `docs/verification.md` says what has and has not
been run.

## Troubleshooting

**`No usable SQLite driver`** — the native module did not build. The adapter
falls back to Node's built-in `node:sqlite` automatically; run
`npm run doctor` to see which driver is active. To force one:
`npm run research -- status --driver node:sqlite`.

**The interface says "Queued — start or resume Claude Code"** — that is accurate.
Nothing runs until you start a session. Open Claude Code here and run
`/research-university --resume`.

**A task is blocked** — `npm run research -- tasks list --state blocked --json`
gives the specific reason for each one. Common causes: no confirmed selection,
a person with no recorded affiliation, an unverified recipient address, or an
unapproved applicant profile.

**Scholar entries say `needs_browser`** — no browser was connected when the
source map was made. Install the Claude in Chrome extension, open Chrome, and
run `/map-person --retry-blocked`.

**A commit conflicted** — someone (or something) changed a file after a worker
read it. Your bytes were left untouched.
`npm run research -- notes issues` lists what needs attention.

**A draft will not approve** — `npm run research -- drafts validate --draft <id>`
lists every blocker in plain words. Stale contact instructions and stale program
facts block approval by design; re-check them first.

**A time is refused** — a local time that does not exist because the clocks move
forward is rejected rather than shifted. A time that happens twice needs you to
say which occurrence.

## Honest limitations

- Research quality depends on what the institution actually publishes. Blocked
  pages, paywalled papers and silent directories are recorded as gaps, not
  filled in.
- Timezones inferred from a campus describe a professional location, not where a
  person is.
- A suggested send window is a convenience default. It is not evidence that any
  particular time works better.
- Lease expiry lets abandoned work resume; it does not guarantee that a piece of
  research ran exactly once. Results are validated and idempotent instead.
- Marking a message sent records your report. It says nothing about delivery,
  reading or a reply.

## Documentation

- `docs/architecture.md` — how the pieces fit together
- `docs/data-ownership.md` — which store owns which field, and why
- `docs/api.md` — every endpoint and the CLI contract
- `docs/workflow.md` — task states, dependencies, concurrency and retries
- `docs/recovery.md` — the commit protocol and what happens after a crash
- `docs/requirements-matrix.md` — every requirement mapped to code and tests
- `docs/verification.md` — what was actually run, and what was not
- `docs/dry-run.md` — a full run of the skills against fictional pages
- `docs/first-run.md` — the checklist for the first real university
