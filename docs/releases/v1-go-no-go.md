# MRI Standalone v1 Go/No-Go

Date: 2026-03-26

## Allowed Verdicts

Only these verdicts are allowed:

1. `NOT_READY`
2. `INTERNAL_DEMO_READY`
3. `PUBLIC_GITHUB_READY`

## Current Verdict

`NOT_READY`

## Why

The standalone repository now has a verified wave1 workflow API baseline, HMAC-signed internal mutation routes, replay rejection for signed nonces, local restart-safe file-backed durability, a durable local queue/read-model layer for inference and delivery stages, explicit queue and worker diagnostics on the operations summary, first-class persisted study-context/QC/findings artifact surfaces, typed artifact-reference projections, pinned reviewed and finalized release versions, a bounded signed worker transcript path, an optional PostgreSQL-backed repository path, local clean-database PostgreSQL migration proof, Postgres restart-survival integration tests, a CI postgres-smoke job, and hosted CI proof for the standalone subtree, but a reproducible synthetic demo packet, screenshot-backed UI closure, hosted or operator-run demo evidence, and broader release-grade operational proof are still incomplete.

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
11. `../architecture/reporting-and-export-contract.md`

Missing evidence required for a higher verdict:

1. screenshot bundle for queue, case detail, evidence, review, report, and delivery surfaces
2. operator runbook proof that the bounded demo can be executed repeatably in the intended local setup and timed under ten minutes
3. broader worker and operational evidence beyond the current bounded local scaffold
4. hosted or externally repeatable workflow evidence beyond the current local wave1 baseline

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

PR-17 updates may expand the evidence basis and tighten the `NOT_READY` justification, but they must not imply a verdict upgrade without the PR-18 demo packet.

The current PR-18 packet adds a synthetic-input provenance note and a bounded end-to-end transcript, but it still does not close the screenshot-backed demo gate.