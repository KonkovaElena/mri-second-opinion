# GitHub Settings Worksheet

Date: 2026-03-27

## Purpose

This worksheet is the copy-paste-ready source for configuring the public GitHub repository.

Use it when filling out repository settings after the standalone MRI repository is created.

## About panel

### Description

Clinician-in-the-loop MRI second-opinion workflow baseline with a standalone TypeScript API and restart-safe local persistence.

### Website

Leave blank until one of these exists:

1. a public documentation site
2. a stable GitHub Pages site for this repository
3. a real public project or product landing page

### Topics

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

## Repository features

### Issues

Enable.

Reason:

1. bug reports are routed through issue forms
2. feature requests are intentionally scoped
3. docs and scope drift are first-class intake paths

### Discussions

Optional.

Enable only if someone will actually triage them.

### Projects

Optional.

Do not enable just for appearance.

### Wiki

Disable unless there is a concrete need for community-editable content outside the governed docs set.

## Security settings

### Private vulnerability reporting

Enable if available for the repository.

If it is not enabled, keep `SECURITY.md` accurate and ensure the shared security inbox remains valid.

## Actions

### Enable Actions

Required.

Expected workflows:

1. `ci.yml`
2. `docs-governance.yml`

## Branch protection

Apply only after hosted workflows are stable.

Recommended protected-branch checks once live:

1. require PRs for default branch updates
2. require passing checks for CI and docs-governance
3. restrict force-pushes
4. restrict branch deletion

## Social preview

Use the asset described in `../demo/social-preview-brief.md`.

Prepared file in the repository:

1. `docs/demo/social-preview.png`

Preferred text embedded in the image:

1. title: `MRI Second Opinion`
2. subtitle: `Clinician-in-the-loop workflow baseline`
3. footer: `MRI-only | TypeScript API | Not launch-ready`

## Keep blank unless real

Do not populate these until they are real:

1. homepage URL
2. product website
3. demo URL
4. maintainer roster
5. production readiness claims

## Recording rule

After applying any of these settings in GitHub, record the hosted result in `github-go-live-checklist.md` and `../verification/launch-evidence-index.md`.