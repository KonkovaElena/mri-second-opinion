# Runtime Baseline Verification

Date: 2026-04-12

## Scope

This note records the current standalone runtime baseline after the publication reconciliation waves, export closure, and the latest validation plus persistence hardening pass were verified locally.

It is the current-state runtime note for the standalone repository path.

It is not a target-architecture document and it intentionally excludes superseded route names, deleted files, and intermediate publication scaffolding that no longer match the merged app.

## Verified Artifacts

1. `package.json`
2. `package-lock.json`
3. `.env.example`
4. `src/config.ts`
5. `src/app.ts`
6. `src/index.ts`
7. `src/cases.ts`
8. `src/case-repository.ts`
9. `src/case-sqlite-storage.ts`
10. `src/case-postgres-repository.ts`
11. `src/postgres-bootstrap.ts`
12. `src/archive-lookup.ts`
13. `src/validation.ts`
14. `public/workbench/index.html`
15. `.github/workflows/ci.yml`
16. `.github/workflows/docs-governance.yml`
17. `tests/validation-limits.test.ts`
18. `tests/archive-error-types.test.ts`
19. `tests/postgres-payload-roundtrip.test.ts`

## Verified Behaviors

## 1. Dependency installation and build

Confirmed locally from the standalone repository root.

The current cross-platform install baseline is `npm ci`, followed by `npm run build`.

This was revalidated locally on 2026-04-12 against the checked-in `package.json` and `package-lock.json`. The frozen-install path now succeeds cleanly under the current Node 24 baseline, which closes the earlier install-lane caveat that required `npm install --omit=optional`.

## 2. Full standalone test baseline

Confirmed locally.

The current standalone suite passes via `npm test` (`node --import tsx --test tests/**/*.test.ts`) with `239` total tests, `238` passing, `0` failures, and `1` skipped.

The latest hardening pass extends the baseline with semantic payload-size validation, archive lookup graceful-degradation coverage, PostgreSQL payload round-trip preservation for Unicode content, multiline review comments, floating-point measurements, large sequence inventories, archive circuit-breaker coverage, pagination or presentation coverage for list/detail surfaces, reader-study metrics coverage, reviewer-auth JWKS coverage, plus prior hyper-deep audit (structured error logging, Dockerfile HEALTHCHECK, Helmet/CSP), runtime-hardening coverage, and GitHub publication-lane verification.

The strongest current verification anchors are:

1. `tests/workflow-api.test.ts`
2. `tests/memory-case-service.test.ts`
3. `tests/postgres-bootstrap.test.ts`
4. `tests/postgres-case-service.test.ts`
5. `tests/validation-limits.test.ts`
6. `tests/archive-error-types.test.ts`
7. `tests/postgres-payload-roundtrip.test.ts`

## 3. Runtime startup and baseline endpoints

Confirmed locally.

The service starts from built output and the baseline endpoints return successfully:

1. `/`
2. `/healthz`
3. `/readyz`
4. `/metrics`

The root endpoint exposes the live public and internal route inventory plus pointers to the scope, readiness, and verdict docs.

The `/metrics` surface remains a bounded placeholder export rather than a production metrics program.

## 4. Workflow API closure

Confirmed locally.

The current merged runtime exposes and validates these public endpoints:

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

The current merged runtime also exposes these internal bounded-slice endpoints:

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

The route-level tests cover create, review, finalize, report retrieval, evidence-bundle retrieval, finalized-only export guards, artifact retrieval, delivery retry, reader-study metrics, inference completion, delivery completion, ingest idempotency, malformed JSON normalization, semantic request-size enforcement, archive-lookup degradation paths, HMAC-guarded dispatch claim or heartbeat rails, dispatch failure classification, durable job claims, and expired inference-job requeue behavior.

## 5. Restart-safe local persistence

Confirmed locally.

The current standalone baseline persists workflow state across restart through:

1. the default SQLite-backed runtime path used by the live app
2. the snapshot-backed path used for zero-config or fixture-driven verification
3. the PostgreSQL-backed service path exercised in the current local test suite

The persistence proof now covers:

1. case records
2. inference jobs
3. delivery jobs
4. retry history
5. operation transcript
6. operations summary rebuild

This is restart-safe local persistence proof.

It is not yet release-linked or hosted PostgreSQL operational evidence.

## 6. Clean-database PostgreSQL bootstrap proof

Confirmed locally.

The current repository now has local clean-database PostgreSQL proof through:

1. `tests/postgres-bootstrap.test.ts`
2. `npm run db:migrate:smoke`
3. `docs/verification/postgres-bootstrap-audit-2026-03-27.md`

This closes the local migration and bootstrap proof for the current baseline.

## 7. PostgreSQL service-path and payload-preservation proof

Confirmed locally.

`tests/postgres-case-service.test.ts` and `tests/postgres-payload-roundtrip.test.ts` exercise the merged PostgreSQL repository path through the current `MemoryCaseService` model and verify:

1. delivery-queue restart survival
2. inference-job persistence through claim and callback completion
3. expired claimed inference jobs can be requeued
4. Unicode and mixed-script strings survive create, inference, and review persistence
5. multiline review comments, floating-point measurements, and large sequence inventories round-trip without loss

This is local service-path evidence only.

It is not yet hosted or release-linked PostgreSQL operations evidence.

## 8. Request validation and archive-enrichment hardening

Confirmed locally.

`tests/validation-limits.test.ts` and `tests/archive-error-types.test.ts` verify that the current public and internal intake paths reject oversized semantic payloads, preserve explicit validation boundaries, and degrade gracefully when the bounded archive lookup seam returns not-found, server-error, or network-failure states.

The verified hardening scope includes:

1. boundary enforcement for patient identifiers, study UIDs, free-text fields, sequence inventories, findings, summaries, and artifact payloads
2. archive enrichment when bounded lookup returns valid study metadata
3. case creation without false-negative failures when bounded archive lookup returns `404`, `500`, or network-level errors

## 9. Built-in workbench and read-side presentation

Confirmed locally.

The current standalone baseline serves `GET /workbench` as the built-in operator-equivalent surface.

The workbench is wired to live endpoints for:

1. queue visibility
2. case detail
3. clinician review
4. finalize action
5. report preview
6. delivery retry

The read-side presentation layer now exposes explicit case, report, inference-job, delivery-job, and operations-summary envelopes through `src/case-presentation.ts`.

## 10. Derived artifact and viewer-seam truth

Confirmed locally.

The current report surface persists both legacy artifact references and typed `derivedArtifacts` descriptors.

Those descriptors now carry:

1. `artifactType`
2. `storageUri`
3. `archiveLocator`
4. `viewerReady`
5. `viewerDescriptor`

`viewerReady` is intentionally conservative and only becomes true when trustworthy archive-binding metadata exists.

## 11. Reconciliation note

This file intentionally supersedes older current-state claims that no longer match the merged runtime.

Specifically, this note does not claim current proof for:

1. `GET /operator`
2. `src/artifact-store.ts`
3. `tests/postgres-integration.test.ts`
4. an active Redis-backed dispatch substrate

Those references belonged to earlier intermediate publication states and should not be reused as current runtime truth.

## Current limits

This verification proves a truthful local standalone workflow baseline only.

It does not prove:

1. hosted or release-linked workflow execution on the current public head
2. managed PostgreSQL operations beyond the local bootstrap and service proofs
3. a production worker fleet or distributed lease coordination runtime
4. an OHIF deployment or production clinical review workstation
5. launch-ready clinical or operational maturity

## Verdict contribution

This note supports the current `PUBLIC_GITHUB_READY` repository-content verdict.

By itself, it does not upgrade the verdict beyond what is recorded in `docs/releases/v1-go-no-go.md` and `docs/verification/launch-evidence-index.md`.