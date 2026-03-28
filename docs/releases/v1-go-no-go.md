# MRI Standalone v1 Go/No-Go

Date: 2026-03-29

## Allowed Verdicts

Only these verdicts are allowed:

1. `NOT_READY`
2. `INTERNAL_DEMO_READY`
3. `PUBLIC_GITHUB_READY`

## Current Verdict

`PUBLIC_GITHUB_READY`

## Why

The seven launch gates in `../launch-readiness-checklist.md` remain satisfied for the conservative public-publication posture: the repository is independently buildable, the bounded workflow slice is locally verified, the built-in review workbench and synthetic demo path are real, public repository hygiene is hosted-proof-backed on the latest fully hosted-validated head, and documentation honesty is aligned to current runtime truth. The current pushed head already extends Wave 2A truth with local artifact persistence and public artifact retrieval, but Wave 1.5 still needs one same-head hosted `ci` plus `docs-governance` capture after the active docs reconciliation before the next runtime wave advances. That gap does not reopen the conservative publication verdict. Remaining gaps are still real, and they belong to higher product-maturity work rather than to safe public GitHub publication.

## Evidence Basis

For the current evidence ledger and the publication reconciliation lessons behind this verdict, use `../verification/launch-evidence-index.md` together with `../verification/publication-retrospective-audit-2026-03-27.md`.

The active evidence ledger also records that the current local and remote `main` head is `f6021ecdb45f4ecf5aece2c52cc0e6f462361d49`, while the latest head with both hosted `ci` and `docs-governance` proof is `1e340b978bfa35a2ed339adcdb0d2add56cc08c3`; that keeps Wave 1.5 evidence closure open until the next docs-reconciliation head carries both hosted workflows without changing the repository-level verdict.

Supporting artifacts that exist now:

1. `../launch-readiness-checklist.md`
2. `../verification/launch-evidence-index.md`
3. `../demo/demo-script.md`
4. `../scope-lock.md`
5. `../scope-inventory.md`
6. `../public-vocabulary.md`
7. `../status-model.md`
8. `../api-scope.md`
9. `../architecture/overview.md`
10. `../verification/runtime-baseline-verification.md`
11. `../verification/archive-viewer-seam-audit-2026-03-27.md`
12. `../verification/presentation-surface-audit-2026-03-27.md`
13. `../verification/demo-flow-audit-2026-03-27.md`
14. `../verification/workbench-frontend-audit-2026-03-27.md`
15. `../verification/durable-delivery-queue-audit-2026-03-27.md`
16. `../verification/standalone-closure-audit-2026-03-27.md`
17. `../demo/operator-transcript-2026-03-27.md`
18. `public-github-and-mvp-path.md`
19. `../architecture/mvp-work-package-map.md`
20. `../verification/public-repository-hygiene-review.md`
21. `../verification/postgres-bootstrap-audit-2026-03-27.md`
22. `../verification/inference-queue-lease-audit-2026-03-27.md`

Open evidence that still blocks higher product-maturity claims:

1. same-head hosted `ci` plus `docs-governance` capture on the next docs-reconciliation head as part of Wave 1.5 evidence closure
2. release-linked or hosted workflow execution beyond the local bounded slice
3. broader real-PostgreSQL runtime durability proof beyond clean bootstrap and targeted queue coverage
4. distributed or external worker execution proof

## Upgrade Rules

Move to `INTERNAL_DEMO_READY` only when:

1. repository independence is proven
2. one full synthetic workflow path works
3. frontend and backend paths used in the demo are real

Use `PUBLIC_GITHUB_READY` only when:

1. the seven launch gates in `../launch-readiness-checklist.md` are satisfied for the publication-safe repository posture
2. evidence is recorded in `../verification/launch-evidence-index.md`
3. README and demo materials remain truthful to runtime reality
4. any current-head hosted-evidence gap is explicitly called out in the evidence ledger instead of being silently treated as already closed

Use `public-github-and-mvp-path.md` when separating publication readiness from MVP closure work.

`PUBLIC_GITHUB_READY` means the repository is safe to publish publicly on GitHub without misleading readers about scope or maturity. It does not mean internal MVP closure, launch readiness, clinical readiness, or production deployment readiness.

## Change Discipline

This file must be updated only when the verdict changes or when new evidence materially changes the justification for the current verdict.