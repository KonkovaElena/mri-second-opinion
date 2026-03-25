# GitHub Publication Playbook

Date: 2026-03-25

## Purpose

This document is the operational playbook for publishing MRI Standalone on GitHub without overstating maturity.

Use it when configuring the repository home page, About metadata, issue intake, and first public release posture.

## Publication posture

The repository should be published as:

1. MRI-only
2. clinician-in-the-loop
3. workflow baseline
4. open-source and contribution-ready
5. not launch-ready

It should not be published as:

1. a full imaging platform
2. an autonomous diagnostic product
3. a production-ready clinical system
4. a complete frontend-plus-worker deployment

## Repository card

Use this short card anywhere a compact project summary is needed.

### One-line summary

Clinician-in-the-loop MRI second-opinion workflow baseline with a standalone TypeScript API and restart-safe local persistence.

### Current verified baseline

1. standalone install, build, and local tests
2. public workflow API for case intake, list, detail, review, finalize, report retrieval, and delivery retry
3. internal ingest, inference callback, and delivery callback endpoints
4. restart-safe local snapshot persistence
5. conservative release verdict discipline

### Not included yet

1. PostgreSQL durability
2. Redis queueing
3. object-store artifact durability
4. real worker execution path
5. frontend review workspace
6. hosted evidence of public CI success history

### Intended audience

1. contributors evaluating a focused MRI workflow baseline
2. engineers preparing the next runtime seams
3. reviewers checking claim discipline and readiness evidence

## GitHub About settings

Configure the repository About panel with the same honesty level as the README.

### Recommended description

Clinician-in-the-loop MRI second-opinion workflow baseline with a standalone TypeScript API and restart-safe local persistence.

### Homepage field

Leave blank until one of these exists:

1. a public documentation site
2. a real demo or product landing page
3. a stable GitHub Pages site dedicated to this standalone repository

Do not point the homepage field at parent-project internals or aspirational architecture docs alone.

### Recommended topics

GitHub topics should stay under 20 items and use lowercase letters, numbers, and hyphens.

Recommended initial set:

1. `mri`
2. `medical-imaging`
3. `radiology`
4. `second-opinion`
5. `clinical-review`
6. `typescript`
7. `nodejs`
8. `express`
9. `workflow-orchestration`
10. `research-use-only`

Do not add topics for capabilities that are not present yet, such as a real frontend, Orthanc integration, production queueing, or deployment-grade inference.

## Social preview

GitHub recommends a PNG, JPG, or GIF under 1 MB and at least 640x320 pixels, with 1280x640 preferred for best display.

Recommended social-preview brief:

1. title: `MRI Second Opinion`
2. subtitle: `Clinician-in-the-loop workflow baseline`
3. footer ribbon: `MRI-only | TypeScript API | Not launch-ready`

Visual direction:

1. use one MRI-inspired visual motif, not a fake product screenshot
2. prefer solid-background readability over transparency tricks
3. avoid clinical-performance claims or diagnostic language in the image itself

## README landing structure

The repository home page should let an outsider answer five questions quickly.

1. what is this
2. what works today
3. what does not work yet
4. how do I run it locally
5. where is the readiness evidence

The preferred section order is:

1. title and one-line positioning
2. scope and non-goals
3. repository snapshot
4. current verified baseline
5. quick start
6. community-health and safety surfaces
7. launch-readiness and evidence links
8. deeper architecture and academic references

## Detailed publication plan

## Phase 1. Before making the repository public

1. confirm local build and test pass from clean checkout
2. keep README, scope docs, and readiness docs aligned
3. ensure contributor-intake surfaces cover bug, feature, and docs or scope drift
4. keep the verdict `NOT_READY` until hosted evidence exists and the higher gates close

## Phase 2. First GitHub push

1. enable GitHub Actions
2. verify `ci.yml` and `docs-governance.yml` pass remotely
3. set About description, topics, and social preview
4. pin or highlight release and evidence docs in the README rather than only architecture docs

## Phase 3. Immediately after public publication

1. record hosted workflow URLs or screenshots in `docs/verification/launch-evidence-index.md`
2. re-run the public-repository-hygiene review with hosted evidence present
3. verify that issue forms route the first external reports cleanly
4. check that no public doc still implies unimplemented frontend or worker completeness

## Phase 4. Toward higher readiness

1. close one end-to-end synthetic demo slice
2. add durable database-backed state
3. add queue-backed execution and operations visibility
4. add a real review surface
5. reconsider verdict only after evidence exists

## Maintainer checklist for GitHub Settings

Apply these settings at publication time:

1. About description set to the recommended one-line summary
2. homepage left blank unless a real public URL exists
3. initial topics added and reviewed
4. social preview uploaded
5. Issues enabled
6. Projects or Discussions enabled only if someone will actually triage them
7. branch protection and required checks configured after hosted workflows are stable

## Evidence links

Use this playbook together with:

1. `public-github-and-mvp-path.md`
2. `v1-go-no-go.md`
3. `../launch-readiness-checklist.md`
4. `../verification/launch-evidence-index.md`
5. `../verification/public-repository-hygiene-review.md`
6. `github-go-live-checklist.md`
7. `github-metadata-copy.md`
8. `github-settings-worksheet.md`
9. `github-live-publication-sequence.md`
10. `github-operator-packet.md`
11. `../demo/social-preview-brief.md`
