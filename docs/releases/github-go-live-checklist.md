# GitHub Go-Live Checklist

Date: 2026-03-28

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
- [x] `docs/releases/v1-go-no-go.md` says `PUBLIC_GITHUB_READY` while still keeping launch-ready, clinical-ready, and production-ready claims closed
- [x] `docs/releases/public-github-and-mvp-path.md` separates Track A publication from Track B MVP closure
- [x] `docs/releases/github-publication-playbook.md` defines About metadata, topics, and social-preview posture
- [x] contributor intake covers bug, feature, and docs or scope drift
- [x] `SECURITY.md`, `SUPPORT.md`, and `GOVERNANCE.md` exist and do not invent fake ownership
- [x] standalone local tests pass
- [x] docs closure rail passes

## Phase 2. First push to GitHub

- [x] create or publish the standalone repository
- [x] enable GitHub Actions
- [x] verify Issues are enabled
- [x] confirm issue-form chooser shows bug, feature, and docs or scope templates (3 YAML templates + `config.yml` with `blank_issues_enabled: false`)
- [-] confirm Security tab or private reporting route is configured as documented (SECURITY.md exists; GitHub private reporting requires manual activation in Settings > Security)
- [-] upload prepared social preview asset via GitHub UI (`docs/demo/social-preview.png`; brief in `docs/demo/social-preview-brief.md`)
- [x] set About description
- [-] set repository topics (requires GitHub UI; recommended set in `docs/releases/github-metadata-copy.md` and mirrored in `docs/releases/pending-manual-github-actions.md`)
- [x] leave homepage blank unless a real public URL exists (confirmed blank via API)

## Phase 3. Hosted evidence capture

- [x] `ci.yml` passes on GitHub-hosted runners
- [x] `docs-governance.yml` passes on GitHub-hosted runners
- [x] hosted workflow URLs or screenshots are recorded in `docs/verification/launch-evidence-index.md`
- [x] public-repository-hygiene review is updated with hosted proof
- [x] launch evidence and README remain mutually consistent after push

Current hosted proof recorded:

1. `docs-governance` success on `1eac899`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23555671232`
2. `ci` success on `177094a`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374310`
3. `docs-governance` success on `177094a`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374341`
4. `docs-governance` success on `8f851b3`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23557754782`
5. `docs-governance` success on `49b794c`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23557837645`
6. `ci` success on `6c2cfee`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23682412690`
7. `docs-governance` success on `6c2cfee`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23682412696`

## Phase 4. Publication safety review

- [x] no GitHub About text implies production readiness (description: "Clinician-in-the-loop MRI second-opinion workflow baseline")
- [x] no topic suggests unimplemented worker, frontend, or deployment completeness (topics currently empty; recommended list in metadata-copy.md is scope-safe)
- [x] no screenshot or social-preview asset looks like a fake shipping UI (none uploaded)
- [x] no public doc uses autonomous-diagnosis language (verified in documentation-honesty-review)
- [x] no public issue template invites PHI or real clinical uploads (templates scoped to bug, feature, docs)

## Phase 5. Immediate post-publication triage

- [-] first external issue is triaged through the intended templates (no external issues yet; 5 open items are Dependabot PRs)
- [-] docs or scope drift reports are handled using the docs-scope path (no drift reports yet)
- [x] security reporting instructions are still correct in the live repository (SECURITY.md references GitHub Private Vulnerability Reporting + fallback email)
- [-] branch protection and required checks are added only after workflows are stable (workflows are stable; requires manual GitHub Settings > Branches action)

Manual-only follow-up is consolidated in `docs/releases/pending-manual-github-actions.md`.

## Completion rule

This checklist may be marked complete only when all GitHub-hosted items are complete and the repository metadata, README, and readiness docs still truthfully support the current repository verdict `PUBLIC_GITHUB_READY` without implying launch readiness, clinical readiness, or production deployment readiness.
