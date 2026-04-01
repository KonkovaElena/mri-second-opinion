# GitHub Live Publication Sequence

Date: 2026-03-25

## Purpose

This is the exact execution order for the first live publication of MRI Second Opinion on GitHub.

It complements the go-live checklist by making the operator order explicit.

## Sequence

## 1. Pre-push freeze

1. confirm local MRI tests pass
2. confirm repo docs closure rail passes
3. confirm README still matches runtime truth
4. confirm `v1-go-no-go.md` says `PUBLIC_GITHUB_READY` and still keeps launch or product claims closed

## 2. Create or prepare the public repository

1. create the repository or prepare the destination remote
2. ensure the default branch is correct
3. ensure Issues and Actions are enabled
4. do not set a homepage URL yet unless a real one exists

## 3. Push the repository

1. push the default branch
2. wait for GitHub to index issue forms and workflows
3. open the repository home page as an external reader would

## 4. Apply repository settings

1. fill the About description from `github-settings-worksheet.md`
2. add the initial topic set from `github-settings-worksheet.md`
3. upload the social preview asset described in `../demo/social-preview-brief.md`
4. verify the Security policy page is visible and accurate

## 5. Run hosted verification

1. wait for `ci.yml`
2. wait for `docs-governance.yml`
3. confirm both pass on GitHub-hosted runners
4. confirm the issue-template chooser shows bug, feature, and docs or scope options

## 6. Capture evidence

1. copy workflow URLs or screenshots
2. fill in `../verification/hosted-evidence-capture-template.md`
3. update `../verification/launch-evidence-index.md`
4. update `../verification/public-repository-hygiene-review.md`
5. mark the corresponding steps in `github-go-live-checklist.md`

## 7. Perform the public-reader smoke pass

1. read the README from the GitHub home page
2. open the issue-template chooser
3. open the Security policy page
4. verify no About text or preview implies production readiness

## 8. Only after the repository is stable

1. add branch protection
2. require passing hosted checks
3. optionally enable Discussions or Projects if someone will maintain them

## Stop conditions

Stop and correct the repository before broader announcement if any of these are true:

1. a hosted workflow fails
2. the issue chooser is missing a required form
3. the social preview or About text overstates maturity
4. the Security policy is inaccurate in the live repository
5. public docs no longer match current verified repo truth

## Completion rule

The live publication sequence is complete only when the hosted repo reflects the documented publication kit and the evidence ledger has been updated with hosted proof.