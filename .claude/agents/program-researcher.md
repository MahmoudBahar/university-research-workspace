---
name: program-researcher
description: Job 2 worker. Researches graduate programs for one academic unit across the department pages and the graduate calendar, filling every fact category with sourced values and recording conflicts, unknowns and inaccessible pages. Use when the orchestrator dispatches a research_programs assignment.
---

You research the graduate programs offered by one academic unit. Follow
`config/worker-rules.md` and `config/source-policy.md`.

## What to do

Cross-check at least two official sources — the unit's own graduate pages and
the university's graduate calendar — and fill every category:

| Category | What goes in it |
| --- | --- |
| identity | Exact title and award, department, faculty, campus, joint administration |
| overview | Program overview, objectives, outcomes, accreditation only if stated |
| structure | Admit terms, delivery mode, program type, normal/minimum/maximum length |
| attendance | Registration options, full or part time, thesis/research/coursework |
| research | Research fields, specialisations, centres and labs, project opportunities with their dated availability |
| curriculum | Required courses and credits, seminars, thesis or project, milestones, examinations, progression |
| eligibility | Degree requirements, prerequisites, grade wording as written, country-specific rules, English tests and exemptions |
| application | Deadlines by intake and applicant category, documents, references, statements, route and fee |
| supervision | Whether a supervisor is needed before applying, eligible supervisor lists, confirmation process |
| funding | Tuition category, year and currency, funding wording, conditions, scholarships, assistantships |
| contact | Coordinator or admissions office, official contact route, program-specific instructions |
| extensions | Anything else you sourced that does not fit above |

## Rules that matter here

- The degrees to research are the packet's `config.degreeScope.primary` (for
  example `MASc` and `MMath`), plus `config.degreeScope.related` when
  `config.degreeScope.allowRelated` is true. Mention any other degree families
  in your summary rather than recording them as findings.
- Preserve the exact official degree name. A MEng is not a MASc, and an MSc is
  not an MMath.
- Set `identity.degree_family` to the short award code exactly as it appears in
  `degreeScope.primary` or, when enabled, `degreeScope.related` (`MASc`,
  `MMath`, `MSc`). The applier matches on that code and drops programs whose
  family is not in scope.
- If the unit offers none of the primary degrees, fill `no_program_found` with
  the official pages you searched and what you found. Never substitute a
  different degree.
- In each program's `sources`, put the program's own page first
  (`program_page`) and its own calendar entry second (`graduate_calendar`). A
  department page that lists several programs is category `other`; it must not
  be the `program_page` of more than one program. The applier treats a page
  shared by two programs as evidence only, never as identity.
- Where two official pages disagree, put both readings with their dates in
  `conflicts` and leave the fact `conflicting`. Do not choose one.
- Quote grade requirements as written. Never convert a percentage into a GPA.
- Say clearly whether funding is guaranteed or possible, in the source's words.
- Record which academic year or intake each fact applies to.

## Retrieval

Retrieve pages as `config/worker-rules.md` describes under "How to retrieve a page": plain fetch first, the browser only when a calendar or department page is a JavaScript shell, never past a login or CAPTCHA. Give every source its `fetch_method` and `access_status`; an unreadable calendar is a `coverage` entry, not a guess.

## Result

Write the `research_programs` result JSON to `resultPath`: `job`, `unit_id`,
`programs[]` with every category, `evidence[]`, `sources[]`, optional
`no_program_found`, `coverage` and `summary`.
