# Recovery

## The problem

SQLite writes and Markdown writes cannot be one transaction. A crash between
them would otherwise leave a task marked complete with no files, or files with
no index. The commit protocol closes that gap.

## The protocol

1. **Stage.** Content is written into `data/commits/<commit-id>/staged/`, hashed,
   and checked against the hash each target file is expected to have. The task's
   fencing token and the live scope version are validated.
2. **Prepare.** A manifest is written durably to
   `data/commits/<commit-id>/manifest.json` and a row is inserted with state
   `prepared`. Nothing has changed in the vault yet.
3. **Apply.** Under a per-entity lock, every file is checked, then installed:
   previous bytes are copied into the content-addressed revision store, new
   content is written to a temporary sibling and renamed over the target.
4. **Finalise.** In one short transaction, the database operations run:
   relationships, note revisions, the index, task state, events.
5. **Commit.** The manifest is marked `committed` and the lock released.

## Replay

`reconcileVault()` — run by `npm run research -- reconcile`, and automatically
when the CLI or server starts — finds every commit still in `prepared` or
`applying` and applies it again. It then walks the vault for notes edited by
hand, skipping files whose size and mtime are unchanged (`reconcile --full`
re-hashes every file), refreshes email readiness for people whose claims
changed, and prunes change-feed rows older than `events.retentionDays`. The
audit log is never pruned. Replay is idempotent:

- a file that already has the target hash is skipped;
- a file that still has its expected prior hash is installed;
- every database operation is an upsert keyed so that repeating it changes
  nothing.

A manifest written before its database row was inserted is also recovered:
recovery scans `data/commits/` for orphans and adopts them.

## Conflicts

If a file has neither its expected prior hash nor the target hash, something
outside this commit changed it. The commit stops with `revision_conflict`, the
existing bytes are left exactly as they are, the commit is marked `conflict`
with the detail, and it is reported. Nothing is overwritten to make recovery
tidier.

## Rejected results

A recovered commit whose fencing token no longer matches, or whose scope version
has been superseded, is marked `rolled_back` with the reason. The staged files
stay on disk for inspection.

## After an interruption

A new session:

1. reads saved state — no transcript required;
2. recovers incomplete commits;
3. reclaims leases that expired, so those tasks become `partial`;
4. resumes from the last committed checkpoint.

It may redo the step that was in flight when the interruption happened. That is
the intended cost.

```bash
npm run research -- reconcile --json
npm run research -- tasks reclaim --json
npm run research -- status --json
```

Then in Claude Code: `/research-university --resume`.

## Backups

```bash
npm run research -- backup create --label before-big-change
npm run research -- backup list
npm run research -- backup restore --from data/backups/<dir> --force
```

The database is copied with `VACUUM INTO`, which yields a single consistent file
even while WAL is active — no `-wal`/`-shm` files need to travel with it. The
vault, applicant files, config and revision store are copied alongside, with a
manifest recording the database hash and file count.

Restore closes the database first, which is why it is a CLI operation rather
than a button in the interface. Restoring over an existing workspace requires
`--force`.

Keep the live database on a local disk. Syncing `data/research.sqlite` and its
WAL files between machines with a file-sync tool corrupts them; export a backup
instead.
