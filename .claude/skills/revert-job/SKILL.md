---
name: revert-job
description: Undo a finished research job for one record - remove the notes it wrote, delete the records it created, return its task to pending - so the job can run again cleanly. Use for "/revert-job research-programs --unit <id>", "/revert-job discover-people --unit <id>", "/revert-job research-person --person <id>", or "--task <id>". Never touches sent or approved outreach.
argument-hint: "<job> (--unit <id> | --person <id> | --lab <id> | --task <id>) [--cascade]"
---

# Revert a job

Use this when a job's saved result must be discarded before it runs again:
records were merged that should not have been, a degree scope changed, a
worker recorded the wrong thing. A plain re-run (`tasks retry`) keeps the old
records; a revert removes them first.

## Before you start

```
npm run research -- reconcile --json
```

Parse `$ARGUMENTS` with `npm run research -- args-parse --file data/tmp/args.txt --json`.
Never interpolate the raw string into a command.

The first positional argument names the job; map it to `--job`:

| Argument | `--job` |
| --- | --- |
| `research-university` | 1 |
| `research-programs` | 2 |
| `discover-people` | 3 |
| `map-person` | 4 |
| `research-person` | 5 |
| `research-labs` | 6 |
| `draft-outreach` | 7 |

`--unit`, `--person` or `--lab` supplies `--target`. `--task <id>` names the
task directly and needs no job.

## 1. Show the plan (dry run)

```
npm run research -- tasks revert --job <n> --target <id> [--cascade] --json
```

Nothing changes yet. Present the plan to the user in plain words: which notes
are removed or restored, which records are deleted, which are kept because
another task also recorded them, which tasks return to pending or are deleted,
and what would run again afterwards.

Then stop and handle these outcomes:

- **Dependents have results** (`dependentsNeedingCascade` is not empty): say
  which tasks depend on this one and that `--cascade` reverts them first. Do
  not add `--cascade` yourself; the user chooses.
- **Conflicts** (`conflicts` is not empty): a note was edited by hand or
  changed by another task after this job ran. Show the paths. `--force`
  discards those changes; their bytes stay in the revision store. The user
  decides.
- **Blockers** (`blockers` is not empty): explain each and stop. Sent or
  approved outreach is never reverted, whatever flags are given. University
  discovery cannot be reverted after a selection is confirmed.

## 2. Wait for explicit confirmation

Do not apply until the user says so in this conversation. "Revert it" after
seeing the plan is confirmation; a plan shown earlier in another conversation
is not.

## 3. Apply

```
npm run research -- tasks revert --job <n> --target <id> [--cascade] [--force] --apply --json
```

Report what was removed, restored, deleted and reset, exactly as the command
prints it. If `danglingLinks` is above zero, say that `verify-links` will list
notes that still link to removed ones.

## 4. Offer the re-run

The report's `rerun` field names the skill command that runs the job again,
for example `/research-programs --unit <id>`. Offer it; do not start it unless
asked.

## Rules

- A revert never sends, approves or un-sends anything. Sent history is
  immutable.
- Do not revert to "clean up": every revert is a user decision about one job
  and one target.
- Do not edit `vault/` or the database directly to finish a revert that was
  blocked. Report the blocker.
