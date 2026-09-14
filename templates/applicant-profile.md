---
schema_version: 1
id: applicant-profile
type: applicant_profile
title: Applicant profile
revision: 0
checked_at: 2026-01-01
tags: []
---

# Applicant profile

This file starts empty on purpose. Nothing here is imported from anywhere else.
Fill in only facts you can support, then approve the revision before any email
draft cites them:

```
npm run research -- applicant approve --kind profile --sha <sha256 from applicant show>
```

## Identity

- Full name:
- Current location and time zone:
- Contact email you will send from:

## Education

- Degree, institution, dates, and result:
- Thesis or major project title and one-line description:

## Research background

- Areas you have actually worked in:
- Methods and tools you can evidence:
- Publications, preprints, or reports (with links where public):

## Experience

- Roles, dates, and what you did:

## Language and test results

- Test, date taken, overall score, section scores:
- Source document (import it with `documents import`):

## Interests and goals

- What you want to work on and why:
- Programs and intakes you are targeting:

## Constraints and preferences

- Funding needs, timing constraints, location constraints:

## Evidence references

List the document ids and pages that support the claims above. Facts without a
reference stay unverified and must not appear as claims in an email.
