# Data ownership

"Source of truth" applies per field, not per file.

| Data | Authoritative location | Other representations |
| --- | --- | --- |
| Entity ids, canonical paths, relationships, affiliations, scope selections | SQLite registry and relationship tables | Generated note links and frontmatter |
| Research narrative, authored assertions, publication summaries | Markdown in `vault/`, plus committed revisions | `note_index.body_text`, a rebuildable index |
| Source URLs, fetch outcomes and the fetch method (`web_fetch`, `browser`, `web_search`, `manual`, `none`) | SQLite `sources`, `source_observations` and `person_sources` | Generated source references in notes |
| Extracted document text and how it was produced (`utf8_read`, `claude_read`, `manual_paste`, or `none` with a reason) | `applicant/extracted/*.txt` plus the `document_extractions` provenance row | Nothing; facts cite the text, they do not restate it |
| Task state, leases, retries, dependencies, commit status | SQLite workflow tables | Generated dashboards under `vault/views/` |
| Email recipient, subject, body, chosen attachments | The current draft Markdown | Parsed index rows and immutable approved snapshots |
| Approval and sent history | SQLite events plus snapshot files | The interface's history views |
| Planned sending time | SQLite `send_plans` | A read-only projection in the draft note |
| Applicant profile and style | `applicant/*.md` and approved revisions | Versioned context packets |
| Document bytes | Files under `applicant/documents/` | Registry metadata with hash and version |

## Generated sections in notes

Machine-authored content lives inside markers:

```markdown
<!-- urw:begin id="related-records" hash="a1b2c3…" -->
- Department: [Example department](../../units/unit-0001.md)
<!-- urw:end id="related-records" -->
```

The hash is of the block's content when it was written. Reconciliation compares
it to what is there now:

- unchanged → a regeneration replaces the block;
- changed by hand → your text is kept, and an issue is raised for review.

Everything outside the markers is yours. It survives every regeneration.

## Protected identity

The `id` in a note's frontmatter is the entity's identity. Editing it by hand is
refused with a conflict rather than silently repointing the registry or
discarding your file. Renaming a note's `title` is fine and does not change its
id. Relocating a note goes through the core so inbound links are updated.

## Optimistic concurrency

Every user-facing write carries the hash or revision the caller believed was
current:

- notes: `expectedSha`
- drafts: `expectedSha`, and a content fingerprint for approval
- scope: `expectedVersion`
- applicant files: `expectedSha`

If the stored value has moved on, the write is refused with `revision_conflict`
and the existing bytes are untouched. Nothing is resolved by last-write-wins.

## Reconciliation

`reconcileVault()` runs on CLI start, on server start, and on demand. It:

1. recovers commits interrupted between installing files and finalising state;
2. hashes every note and compares it with the index;
3. records changed files as user revisions;
4. reports invalid YAML without touching the bytes;
5. reports edited generated blocks and identity mismatches;
6. reports indexed notes whose files have disappeared.

Hashes are compared even when a file watcher missed an event.

## Content-addressed revisions

Committed bytes are stored under `data/revisions/<first two hex>/<sha256>.bin`.
That is how an approved applicant revision can still be read after the working
file has moved on, and how a sent snapshot stays readable after the draft is
edited.

## What stays out of version control

`.gitignore` excludes runtime state, private documents, extracted text, machine
settings — and, by default, the vault itself, because research notes and drafts
contain personal information about real people. Export deliberately with
`npm run research -- backup create`.
