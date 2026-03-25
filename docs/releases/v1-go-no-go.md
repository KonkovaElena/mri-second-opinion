# MRI Standalone v1 Go/No-Go

Date: 2026-03-25

## Allowed Verdicts

Only these verdicts are allowed:

1. `NOT_READY`
2. `INTERNAL_DEMO_READY`
3. `PUBLIC_GITHUB_READY`

## Current Verdict

`NOT_READY`

## Why

The standalone repository now has a verified wave1 workflow API baseline and local restart-safe file-backed durability, but evidence for hosted CI success history, queue-backed execution, database-backed durability, frontend completeness, and demo reproducibility is still incomplete.

## Evidence Basis

Supporting artifacts that exist now:

1. `../launch-readiness-checklist.md`
2. `../verification/launch-evidence-index.md`
3. `../demo/demo-script.md`
4. `../scope-lock.md`
5. `../status-model.md`
6. `../api-scope.md`
7. `../architecture/overview.md`
8. `../verification/runtime-baseline-verification.md`
9. `public-github-and-mvp-path.md`
10. `../architecture/mvp-work-package-map.md`

Missing evidence required for a higher verdict:

1. CI success evidence proving standalone install and build in GitHub Actions
2. hosted API contract verification for the declared workflow surface
3. hosted or release-linked restart-persistence verification
4. screenshot-backed frontend closure proof
5. reproducible synthetic demo transcript
6. workflow-level evidence beyond the current local wave1 baseline

## Upgrade Rules

Move to `INTERNAL_DEMO_READY` only when:

1. repository independence is proven
2. one full synthetic workflow path works
3. frontend and backend paths used in the demo are real

Move to `PUBLIC_GITHUB_READY` only when:

1. all seven launch gates in `../launch-readiness-checklist.md` are satisfied
2. evidence is recorded in `../verification/launch-evidence-index.md`
3. README and demo materials remain truthful to runtime reality

Use `public-github-and-mvp-path.md` when separating publication readiness from MVP closure work.

That publication path may justify making the repository public earlier, but it does not change the meaning of the formal `PUBLIC_GITHUB_READY` verdict.

## Change Discipline

This file must be updated only when the verdict changes or when new evidence materially changes the justification for the current verdict.