# GitHub Operator Packet

Date: 2026-03-25

## Purpose

This file is the single-file operator packet for publishing MRI Standalone on GitHub.

It consolidates:

1. the required repository posture
2. the copy-paste metadata
3. the live publication order
4. the hosted evidence capture steps

Use this file as the main runbook on publication day.

## Repository posture

Publish the repository as:

1. MRI-only
2. clinician-in-the-loop
3. workflow baseline
4. open-source and contribution-ready
5. not launch-ready

Do not publish it as:

1. a production clinical system
2. a complete frontend-plus-worker platform
3. an autonomous diagnostic product
4. a finished imaging platform

## Copy-paste GitHub settings

### About description

Clinician-in-the-loop MRI second-opinion workflow baseline with a standalone TypeScript API and restart-safe local persistence.

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

### Homepage field

Leave blank until a real public URL exists.

### Social preview text

1. title: `MRI Second Opinion`
2. subtitle: `Clinician-in-the-loop workflow baseline`
3. footer: `MRI-only | TypeScript API | Not launch-ready`

## Publication-day sequence

## 1. Pre-push verification

1. confirm MRI tests pass
2. confirm docs closure rail passes
3. confirm README matches runtime truth
4. confirm `v1-go-no-go.md` still says `NOT_READY`

## 2. Repository setup

1. create or prepare the public repository
2. enable Issues and Actions
3. leave homepage empty unless real

## 3. First push

1. push the default branch
2. wait for issue forms and workflows to appear
3. inspect the repo home page as an external user would

## 4. Apply GitHub metadata

1. set the About description above
2. apply the topic set above
3. upload the social preview asset described in `../demo/social-preview-brief.md`
4. confirm the Security policy page matches `SECURITY.md`

## 5. Hosted verification

1. wait for `ci.yml`
2. wait for `docs-governance.yml`
3. confirm both pass
4. confirm bug, feature, and docs or scope issue forms are visible

## 6. Capture hosted evidence

1. fill in `../verification/hosted-evidence-capture-template.md`
2. update `../verification/launch-evidence-index.md`
3. update `../verification/public-repository-hygiene-review.md`
4. mark off `github-go-live-checklist.md`

## 7. Public announcement gate

Only after hosted verification passes:

1. review `first-public-announcement-draft.md`
2. check that it still matches repo truth
3. publish the announcement in the intended channel

## Stop conditions

Stop and correct before any announcement if:

1. a hosted workflow fails
2. issue forms are missing or routed incorrectly
3. About text or preview image overstates maturity
4. Security reporting is inaccurate in the live repository
5. README and evidence docs drift apart

## Quick links

1. `github-publication-playbook.md`
2. `github-go-live-checklist.md`
3. `github-settings-worksheet.md`
4. `github-live-publication-sequence.md`
5. `github-metadata-copy.md`
6. `first-public-announcement-draft.md`
7. `../verification/hosted-evidence-capture-template.md`
8. `../demo/social-preview-brief.md`