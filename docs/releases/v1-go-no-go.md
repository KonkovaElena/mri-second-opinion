# MRI Second Opinion v1 Go/No-Go

Date: 2026-03-29
Last updated: 2026-04-03

## Allowed Verdicts

Only these verdicts are allowed:

1. `NOT_READY`
2. `INTERNAL_DEMO_READY`
3. `PUBLIC_GITHUB_READY`

## Current Verdict

`PUBLIC_GITHUB_READY`

## Authority Snapshot

<!-- AUTHORITY:GO_NO_GO_SNAPSHOT:START -->
- Last reviewed: 2026-04-14
- Current verdict: `PUBLIC_GITHUB_READY`
- Latest hosted-validated head: `3f42a4b8d3f912f9eb84ca0f6bf3e1d56f932170`
- Previous hosted-validated head: `1e340b978bfa35a2ed339adcdb0d2add56cc08c3`
- Wave 1.5 hosted-validated head: `04cb0a57d1e64f8a5cf03a22b4a5c60d37dffc3a`
- Latest documented local validation snapshot: 2026-04-14 via `npm ci`, `npm run build`, and `npm test` with 258 total tests, 257 passing, 0 failing, and 1 skipped
<!-- AUTHORITY:GO_NO_GO_SNAPSHOT:END -->

## Why

The seven launch gates in `../launch-readiness-checklist.md` remain satisfied for the conservative public-publication posture: the repository is independently buildable, the bounded workflow slice is locally verified, the built-in review workbench and synthetic demo path are real, public repository hygiene is hosted-proof-backed on the latest documented hosted-validated head, and documentation honesty is aligned to the current runtime truth file rather than to duplicated counters spread across multiple authority docs.

The current object-scoped authorization baseline still enforces tenant-scoped isolation across case, report, export, and artifact access paths together with reviewer-scoped mutation authorization on review and finalize flows. The remaining blockers for stronger readiness claims are higher-maturity concerns, not publication honesty concerns.

The remaining blockers for stronger claims are:

1. x-tenant-id isolation relies on a plain header rather than a cryptographically signed tenant token
2. worker fetch control is materially stronger than before, but the long-term target is still signed or API-allowlisted input provenance rather than caller-supplied URL surfaces
3. the latest hosted evidence still lags the current green local head

These are real blockers for production, clinical, and stronger security-readiness claims.

They do not invalidate `PUBLIC_GITHUB_READY`, because this verdict is about safe and honest repository publication, not about deployment safety.

## Evidence Basis

For the current evidence ledger and the publication reconciliation lessons behind this verdict, use `../verification/launch-evidence-index.md` together with `../verification/publication-retrospective-audit-2026-03-27.md`, `../verification/runtime-and-production-boundary-revalidation-2026-04-03.md`, and `../verification/release-validation-packet.md`.

The active evidence ledger records the latest hosted-validated head and the latest documented local full-suite snapshot in a single machine-readable source of truth. That closes the route-count and validation-metric drift that had started to appear between README, release docs, and roadmap docs.

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

1. real Python compute proof beyond the current bounded single-volume NIfTI worker and delivery loops
2. release-linked or hosted workflow execution beyond the local bounded slice
3. broader real-PostgreSQL runtime durability proof beyond clean bootstrap and targeted queue coverage
4. distributed or external worker execution proof
5. actor-scoped clinician and operator authority plus object-level authorization on public workflow surfaces
6. closed worker egress policy for public-to-worker volume references
7. synchronized hosted evidence and committed release artifacts

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