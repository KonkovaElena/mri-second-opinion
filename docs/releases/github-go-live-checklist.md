# GitHub Go-Live Checklist

Date: 2026-03-25

## Purpose

This checklist is the operator rail for making MRI Standalone public on GitHub without introducing misleading metadata, missing repo settings, or unverifiable readiness claims.

Use it in two passes:

1. before the first public push
2. immediately after the repository is live on GitHub

## Status keys

- `[ ]` not done
- `[-]` in progress
- `[x]` complete

## Phase 1. Pre-push repository check

- [x] README explains what exists today and what is still missing
- [x] `docs/releases/v1-go-no-go.md` still says `NOT_READY`
- [x] `docs/releases/public-github-and-mvp-path.md` separates Track A publication from Track B MVP closure
- [x] `docs/releases/github-publication-playbook.md` defines About metadata, topics, and social-preview posture
- [x] contributor intake covers bug, feature, and docs or scope drift
- [x] `SECURITY.md`, `SUPPORT.md`, and `GOVERNANCE.md` exist and do not invent fake ownership
- [x] standalone local tests pass
- [x] docs closure rail passes

## Phase 2. First push to GitHub

- [ ] create or publish the standalone repository
- [ ] enable GitHub Actions
- [ ] verify Issues are enabled
- [ ] confirm issue-form chooser shows bug, feature, and docs or scope templates
- [ ] confirm Security tab or private reporting route is configured as documented
- [ ] upload social preview asset
- [ ] set About description
- [ ] set repository topics
- [ ] leave homepage blank unless a real public URL exists

## Phase 3. Hosted evidence capture

- [ ] `ci.yml` passes on GitHub-hosted runners
- [ ] `docs-governance.yml` passes on GitHub-hosted runners
- [ ] hosted workflow URLs or screenshots are recorded in `docs/verification/launch-evidence-index.md`
- [ ] public-repository-hygiene review is updated with hosted proof
- [ ] launch evidence and README remain mutually consistent after push

## Phase 4. Publication safety review

- [ ] no GitHub About text implies production readiness
- [ ] no topic suggests unimplemented worker, frontend, or deployment completeness
- [ ] no screenshot or social-preview asset looks like a fake shipping UI
- [ ] no public doc uses autonomous-diagnosis language
- [ ] no public issue template invites PHI or real clinical uploads

## Phase 5. Immediate post-publication triage

- [ ] first external issue is triaged through the intended templates
- [ ] docs or scope drift reports are handled using the docs-scope path
- [ ] security reporting instructions are still correct in the live repository
- [ ] branch protection and required checks are added only after workflows are stable

## Completion rule

This checklist may be marked complete only when all GitHub-hosted items are complete and the repository still truthfully remains `NOT_READY` unless the higher readiness evidence says otherwise.
