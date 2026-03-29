# Runtime Baseline Verification

Date: 2026-03-27

## Scope

This note records the current standalone runtime baseline after the stash-pop merge was reconciled and the final docs-governance drift was corrected on the pushed public head.

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
12. `public/workbench/index.html`
13. `.github/workflows/ci.yml`
14. `.github/workflows/docs-governance.yml`

## Verified Behaviors

## 1. Dependency installation and build

Confirmed locally from the standalone repository root.

`npm ci` and `npm run build` both complete successfully against the checked-in lockfile and current TypeScript sources.

## 2. Full standalone test baseline

Confirmed locally.

The reconciled standalone suite passes via `npx tsx --test tests/*.test.ts` with `53` passing tests and `0` failures.

The strongest current verification anchors are:

1. `tests/workflow-api.test.ts`
2. `tests/memory-case-service.test.ts`
3. `tests/postgres-bootstrap.test.ts`
4. `tests/postgres-case-service.test.ts`

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
7. `GET /api/operations/summary`
8. `POST /api/delivery/:caseId/retry`

The current merged runtime also exposes these internal bounded-slice endpoints:

1. `POST /api/internal/ingest`
2. `GET /api/internal/inference-jobs`
3. `POST /api/internal/inference-jobs/claim-next`
4. `POST /api/internal/inference-jobs/requeue-expired`
5. `POST /api/internal/inference-callback`
6. `GET /api/internal/delivery-jobs`
7. `POST /api/internal/delivery-jobs/claim-next`
8. `POST /api/internal/delivery-callback`

The route-level tests cover create, review, finalize, delivery retry, inference completion, delivery completion, ingest idempotency, malformed JSON normalization, durable job claims, and expired inference-job requeue behavior.

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

## 7. PostgreSQL service-path proof

Confirmed locally.

`tests/postgres-case-service.test.ts` exercises the merged PostgreSQL repository path through the current `MemoryCaseService` model and verifies:

1. delivery-queue restart survival
2. inference-job persistence through claim and callback completion
3. expired claimed inference jobs can be requeued

This is local service-path evidence only.

It is not yet hosted or release-linked PostgreSQL operations evidence.

## 8. Built-in workbench and read-side presentation

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

## 9. Derived artifact and viewer-seam truth

Confirmed locally.

The current report surface persists both legacy artifact references and typed `derivedArtifacts` descriptors.

Those descriptors now carry:

1. `artifactType`
2. `storageUri`
3. `archiveLocator`
4. `viewerReady`
5. `viewerDescriptor`

`viewerReady` is intentionally conservative and only becomes true when trustworthy archive-binding metadata exists.

## 10. Reconciliation note

This file intentionally supersedes older current-state claims that no longer match the merged runtime.

Specifically, this note does not claim current proof for:

1. `POST /api/internal/dispatch/claim`
2. `POST /api/internal/dispatch/heartbeat`
3. `GET /operator`
4. `src/artifact-store.ts`
5. `tests/postgres-integration.test.ts`
6. an active Redis-backed dispatch substrate
7. nonce replay enforcement in the merged `src/app.ts` (note: HMAC request signing IS active on dispatch routes since Wave 2; only nonce replay wiring remains absent)

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