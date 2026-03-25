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

The standalone repository now has a verified wave1 workflow API baseline, local restart-safe file-backed durability, a durable local queue/read-model layer for inference and delivery stages, first-class persisted study-context/QC/findings artifact surfaces, a bounded structural run surface with typed derived artifacts and branch-execution visibility, an optional PostgreSQL-backed repository path, local clean-database PostgreSQL migration proof, Postgres restart-survival integration tests (3 tests covering restart, full lifecycle, and delete), a CI postgres-smoke job, and hosted CI proof for the standalone subtree, but a real worker execution path, frontend completeness, demo reproducibility, and broader release-grade operational evidence are still incomplete.

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

1. hosted API contract verification for the declared workflow surface
2. release-linked restart-persistence verification against the intended durable-state path
3. broader PostgreSQL operational evidence beyond the current local integration tests and CI-configured migration verification
4. a real worker execution proof beyond the current persisted local artifact contract
5. screenshot-backed frontend closure proof
6. reproducible synthetic demo transcript
7. workflow-level evidence beyond the current local wave1 baseline

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