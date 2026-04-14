---
title: "Scope Inventory"
status: "active"
version: "1.0.1"
last_updated: "2026-04-01"
tags: [scope, inventory, reference, mri]
---

# Scope Inventory

## Purpose

This file is the concrete inventory for the current standalone repository surface.

Use it when checking whether a route, document, test, or demo asset is inside the active MRI Second Opinion boundary.

## Active Runtime Surfaces

### Backend runtime

1. `src/index.ts`
2. `src/app.ts`
3. `src/config.ts`
4. `src/cases.ts`
5. `src/case-contracts.ts`
6. `src/case-common.ts`
7. `src/case-repository.ts`
8. `src/case-storage.ts`
9. `src/case-sqlite-storage.ts`
10. `src/case-planning.ts`
11. `src/case-exports.ts`
12. `src/case-imaging.ts`
13. `src/case-artifacts.ts`
14. `src/case-artifact-storage.ts`
15. `src/case-presentation.ts`
16. `src/archive-lookup.ts`
17. `src/validation.ts`
18. `src/case-postgres-repository.ts`
19. `src/postgres-bootstrap.ts`
20. `src/health.ts`
21. `src/hmac-auth.ts`
22. `src/internal-auth.ts`
23. `src/request-context.ts`
24. `src/replay-store.ts`
25. `src/db-migrations.ts`
26. `src/workflow-packages.ts`
27. `src/http-runtime.ts`

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
7. `GET /api/cases/:caseId/evidence-bundle`
8. `GET /api/cases/:caseId/exports/dicom-sr`
9. `GET /api/cases/:caseId/exports/fhir-diagnostic-report`
10. `GET /api/cases/:caseId/artifacts/:artifactId`
11. `GET /api/operations/summary`
12. `POST /api/reader-study/concordance`
13. `POST /api/delivery/:caseId/retry`
14. `GET /workbench`
15. `GET /`
16. `GET /healthz`
17. `GET /readyz`
18. `GET /metrics`

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
6. `docs/public-vocabulary.md`
7. `docs/executive-summary-ru.md`
8. `docs/fundamental_analysis_report.md`

### Architecture and target direction

1. `docs/architecture/overview.md`
2. `docs/architecture/neuro-first-mvp-slice.md`
3. `docs/architecture/mvp-work-package-map.md`
4. `docs/architecture/reporting-and-export-contract.md`
5. `docs/open-source-target-architecture.md`
6. `docs/roadmap-and-validation.md`

### Academic and claim-boundary docs

1. `docs/academic/action-plan.md`
2. `docs/academic/evidence-and-claims-policy.md`
3. `docs/academic/formal-system-analysis.md`
4. `docs/academic/project-fundamentals.md`
5. `docs/academic/deep-academic-analysis.md`
6. `docs/academic/bias-analysis-framework.md`
7. `docs/academic/reader-study-protocol.md`
8. `docs/academic/subgroup-analysis-plan.md`
9. `docs/academic/pms-activation.md`
10. `docs/academic/regulatory-positioning.md`
11. `docs/academic/model-licensing-and-deployment-gates.md`
12. `docs/academic/open-source-rationale.md`
13. `docs/academic/competitive-analysis.md`
14. `docs/academic/ecosystem-landscape-march-2026.md`
15. `docs/academic/external-evidence-register-march-2026.md`

### Regulatory governance

1. `docs/regulatory/pccp-plan.md`
2. `docs/regulatory/iec-62304-classification.md`
3. `docs/regulatory/iso-14971-risk-baseline.md`
4. `docs/regulatory/data-governance-policy.md`
5. `docs/regulatory/pms-plan.md`

### Security governance

1. `docs/security/sbom-policy.md`
2. `docs/security/threat-model.md`
3. `docs/security/vulnerability-response-sop.md`

### Verification and release evidence

1. `docs/launch-readiness-checklist.md`
2. `docs/verification/launch-evidence-index.md`
3. `docs/verification/runtime-baseline-verification.md`
4. `docs/verification/release-validation-packet.md`
5. `docs/verification/standalone-gap-audit-2026-03-27.md`
6. `docs/verification/standalone-closure-audit-2026-03-27.md`
7. `docs/verification/archive-viewer-seam-audit-2026-03-27.md`
8. `docs/verification/presentation-surface-audit-2026-03-27.md`
9. `docs/verification/demo-flow-audit-2026-03-27.md`
10. `docs/verification/workbench-frontend-audit-2026-03-27.md`
11. `docs/verification/durable-delivery-queue-audit-2026-03-27.md`
12. `docs/verification/inference-queue-lease-audit-2026-03-27.md`
13. `docs/verification/postgres-bootstrap-audit-2026-03-27.md`
14. `docs/verification/wave-2b-bounded-compute-audit-2026-03-29.md`
15. `docs/verification/publication-retrospective-audit-2026-03-27.md`
16. `docs/verification/repository-audit-2026-03-25.md`
17. `docs/verification/ai-auditor-handoff-2026-03-25.md`
18. `docs/verification/architecture-and-publication-audit-2026-03-25.md`
19. `docs/verification/documentation-honesty-review.md`
20. `docs/verification/external-audit-report-2026-03-28.md`
21. `docs/verification/hosted-evidence-capture-template.md`
22. `docs/verification/hyperdeep-audit-2026-03-26.md`
23. `docs/verification/operator-surface-verification.md`
24. `docs/verification/public-repository-hygiene-review.md`
25. `docs/verification/worker-artifact-contract-samples.md`

### Release and publication

1. `docs/releases/public-github-and-mvp-path.md`
2. `docs/releases/v1-go-no-go.md`
3. `docs/releases/pending-manual-github-actions.md`
4. `docs/releases/github-go-live-checklist.md`
5. `docs/releases/github-live-publication-sequence.md`
6. `docs/releases/github-publication-playbook.md`
7. `docs/releases/github-operator-packet.md`
8. `docs/releases/github-settings-worksheet.md`
9. `docs/releases/github-metadata-copy.md`
10. `docs/releases/github-publication-copy-pack.md`
11. `docs/releases/first-public-announcement-draft.md`

### Demo-facing materials

1. `docs/demo/demo-script.md`
2. `docs/demo/demo-transcript.md`
3. `docs/demo/operator-transcript-2026-03-27.md`
4. `docs/demo/social-preview-brief.md`
5. `docs/demo/social-preview.png`
6. `docs/demo/synthetic-demo-input-provenance.md`
7. `docs/screenshots/workbench-queue.png`
8. `docs/screenshots/workbench-review.png`
9. `docs/screenshots/workbench-report.png`
10. `docs/screenshots/workbench-delivery.png`

## Active Verification Surfaces

1. `tests/workflow-api.test.ts`
2. `tests/memory-case-service.test.ts`
3. `tests/postgres-case-service.test.ts`
4. `tests/postgres-bootstrap.test.ts`
5. `tests/validation-limits.test.ts`
6. `tests/archive-error-types.test.ts`
7. `tests/postgres-payload-roundtrip.test.ts`
8. `tests/case-artifacts.test.ts`
9. `tests/config.test.ts`
10. `tests/db-migrations.test.ts`
11. `tests/execution-contract.test.ts`
12. `tests/postgres-integration.test.ts`
13. `tests/runtime-hardening.test.ts`
14. `.github/workflows/ci.yml`
15. `.github/workflows/docs-governance.yml`

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