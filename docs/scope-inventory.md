---
title: "Scope Inventory"
status: "active"
version: "1.0.0"
last_updated: "2026-03-30"
tags: [scope, inventory, reference, mri]
---

# Scope Inventory

## Purpose

This file is the concrete inventory for the current standalone repository surface.

Use it when checking whether a route, document, test, or demo asset is inside the active MRI standalone boundary.

## Active Runtime Surfaces

### Backend runtime

1. `src/index.ts`
2. `src/app.ts`
3. `src/config.ts`
4. `src/cases.ts`
5. `src/case-repository.ts`
6. `src/case-storage.ts`
7. `src/case-sqlite-storage.ts`
8. `src/case-planning.ts`
9. `src/case-common.ts`
10. `src/case-exports.ts`
11. `src/case-imaging.ts`
12. `src/case-artifacts.ts`
13. `src/case-presentation.ts`
14. `src/archive-lookup.ts`
15. `src/validation.ts`
16. `src/case-postgres-repository.ts`
17. `src/postgres-bootstrap.ts`

### Built-in frontend runtime

1. `public/workbench/index.html`
2. `public/workbench/review-workbench.css`
3. `public/workbench/review-workbench.js`

### Public HTTP surface

1. `POST /api/cases`
2. `GET /api/cases`
3. `GET /api/cases/:caseId`
4. `POST /api/cases/:caseId/review`
5. `POST /api/cases/:caseId/finalize`
6. `GET /api/cases/:caseId/report`
7. `GET /api/cases/:caseId/exports/dicom-sr`
8. `GET /api/cases/:caseId/exports/fhir-diagnostic-report`
9. `GET /api/cases/:caseId/artifacts/:artifactId`
10. `GET /api/operations/summary`
11. `POST /api/delivery/:caseId/retry`
12. `GET /workbench`
13. `GET /`
14. `GET /healthz`
15. `GET /readyz`
16. `GET /metrics`

### Internal integration rails

1. `POST /api/internal/ingest`
2. `GET /api/internal/inference-jobs`
3. `POST /api/internal/inference-jobs/claim-next`
4. `POST /api/internal/inference-jobs/requeue-expired`
5. `POST /api/internal/inference-callback`
6. `GET /api/internal/delivery-jobs`
7. `POST /api/internal/delivery-jobs/claim-next`
8. `POST /api/internal/delivery-callback`
9. `POST /api/internal/dispatch/claim`
10. `POST /api/internal/dispatch/heartbeat`
11. `POST /api/internal/dispatch/fail`

## Active Documentation Surfaces

### Product boundary

1. `README.md`
2. `docs/scope-lock.md`
3. `docs/scope-inventory.md`
4. `docs/api-scope.md`
5. `docs/status-model.md`

### Architecture and target direction

1. `docs/architecture/overview.md`
2. `docs/architecture/neuro-first-mvp-slice.md`
3. `docs/architecture/mvp-work-package-map.md`
4. `docs/architecture/reporting-and-export-contract.md`
5. `docs/open-source-target-architecture.md`
6. `docs/roadmap-and-validation.md`

### Academic and claim-boundary docs

1. `docs/academic/evidence-and-claims-policy.md`
2. `docs/academic/formal-system-analysis.md`

### Verification and release evidence

1. `docs/launch-readiness-checklist.md`
2. `docs/verification/launch-evidence-index.md`
3. `docs/verification/runtime-baseline-verification.md`
4. `docs/verification/standalone-gap-audit-2026-03-27.md`
5. `docs/verification/archive-viewer-seam-audit-2026-03-27.md`
6. `docs/verification/presentation-surface-audit-2026-03-27.md`
7. `docs/verification/demo-flow-audit-2026-03-27.md`
8. `docs/verification/workbench-frontend-audit-2026-03-27.md`
9. `docs/verification/durable-delivery-queue-audit-2026-03-27.md`
10. `docs/verification/inference-queue-lease-audit-2026-03-27.md`
11. `docs/verification/postgres-bootstrap-audit-2026-03-27.md`
12. `docs/verification/release-validation-packet.md`
13. `docs/releases/v1-go-no-go.md`

### Demo-facing materials

1. `docs/demo/demo-script.md`
2. `docs/demo/operator-transcript-2026-03-27.md`
3. `docs/demo/social-preview-brief.md`
4. `docs/screenshots/workbench-queue.png`
5. `docs/screenshots/workbench-review.png`
6. `docs/screenshots/workbench-report.png`
7. `docs/screenshots/workbench-delivery.png`

## Active Verification Surfaces

1. `tests/workflow-api.test.ts`
2. `tests/memory-case-service.test.ts`
3. `tests/postgres-case-service.test.ts`
4. `tests/postgres-bootstrap.test.ts`
5. `tests/validation-limits.test.ts`
6. `tests/archive-error-types.test.ts`
7. `tests/postgres-payload-roundtrip.test.ts`
8. `.github/workflows/ci.yml`
9. `.github/workflows/docs-governance.yml`

## Current Demo Asset Reality

The repository currently contains:

1. synthetic workflow test inputs inside API and service tests
2. a built-in synthetic-demo workbench at `GET /workbench`
3. a written demo script
4. an operator transcript with screenshot-backed UI evidence
5. release and publication runbooks
6. a local persisted delivery-job queue with worker-facing list and claim rails
7. a local persisted inference-job queue with worker-facing list, claim, and stale-claim requeue rails

The repository does not yet contain:

1. an OHIF-backed or production-grade imaging review frontend
2. a hosted or distributed worker deployment proof
3. a seeded named demo-case pack as a first-class standalone runtime command

## Explicitly Out Of Scope In The Current Repository

1. built-in PACS or DICOM archive implementation
2. built-in medical image viewer engine
3. Python worker runtime closure
4. production PostgreSQL-backed durability beyond the current local-proof seam
5. distributed or broker-backed queue infrastructure beyond the local persisted delivery and inference queues
6. hospital or EMR integration claims
7. autonomous diagnosis claims

## How To Use This File

1. use `docs/scope-lock.md` for the high-level product boundary
2. use `docs/scope-inventory.md` for the exact active repository surface
3. use `docs/api-scope.md` for HTTP boundaries only
4. use `docs/status-model.md` for persisted workflow states only