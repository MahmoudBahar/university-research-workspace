# Note templates

Each template shows the typed frontmatter a note of that kind must carry and the
section skeleton the generators produce. Generated sections are wrapped in
`<!-- urw:begin id="..." hash="..." -->` / `<!-- urw:end id="..." -->` markers.

Everything outside those markers is yours. It is preserved when a note is
regenerated. If you edit inside a generated block, the core keeps your text and
raises a reviewable issue instead of overwriting it.

`applicant-profile.md` and `applicant-email-style.md` are copied into
`applicant/` by `npm run research -- init` when those files do not exist yet.
