# Runtime Baseline Verification

Date: 2026-03-25

## Scope

This note records the first independently installable, buildable, and workflow-capable runtime baseline for the MRI standalone subtree.

## Verified Artifacts

1. `package.json`
2. `package-lock.json`
3. `tsconfig.json`
4. `.env.example`
5. `src/config.ts`
6. `src/app.ts`
7. `src/index.ts`
8. `.github/workflows/ci.yml`

## Verified Behaviors

## 1. Dependency installation

Confirmed locally.

`npm ci` completed successfully inside `external/mri-second-opinion` against the checked-in lockfile.

## 2. TypeScript build

Confirmed locally.

`npm run build` completed successfully and emitted `dist/` output.

## 3. Runtime startup

Confirmed locally.

The standalone service started successfully from built output using a dedicated test port.

## 4. Baseline endpoints

Confirmed locally.

The following endpoints returned `200` during the runtime smoke check:

1. `/`
2. `/healthz`
3. `/readyz`
4. `/metrics`

The root endpoint identified the service as a `wave1-api` baseline and exposed the current public and internal route inventory. The `/metrics` surface is still a placeholder export, which is useful for baseline operability checks but not yet evidence of a production metrics program.

## 5. Workflow API closure

Confirmed locally.

The standalone service now exposes and validates these workflow endpoints:

1. `POST /api/cases`
2. `GET /api/cases`
3. `GET /api/cases/:caseId`
4. `POST /api/cases/:caseId/review`
5. `POST /api/cases/:caseId/finalize`
6. `GET /api/cases/:caseId/report`
7. `GET /api/operations/summary`
8. `POST /api/delivery/:caseId/retry`
9. `POST /api/internal/ingest`
10. `POST /api/internal/inference-callback`
11. `POST /api/internal/delivery-callback`

The route-level tests cover create, review, finalize, delivery retry, delivery callback, inference replay protection, ingest idempotency, and malformed JSON normalization.

## 6. Restart-safe local durability

Confirmed locally.

The current standalone baseline persists local case snapshots to a configured file and survives process restart for:

1. case records
2. queue-state transcript
2. delivery state
3. retry history
4. operation transcript
5. operations summary rebuild

This is local file-backed durability only. It is not evidence of PostgreSQL migration readiness.

## 7. Local PostgreSQL migration smoke

Confirmed locally.

`npm run db:migrate:smoke` succeeded on 2026-03-25 against a clean local `postgres:17-alpine` container.

The smoke did all of the following:

1. started a disposable PostgreSQL container on a local port
2. applied the current SQL migration set through `applyPendingMigrations`
3. verified `schema_migrations` contains `001_create_case_records`
4. verified the `case_records` table exists after migration
5. cleaned up the disposable container after verification

This closes the local clean-database migration proof for the current baseline.

## 8. PostgreSQL restart-survival integration tests

Confirmed locally.

`tests/postgres-integration.test.ts` exercises the Postgres repository layer through the full `MemoryCaseService` lifecycle using an in-memory pool stub that simulates a shared database:

1. **Restart survival**: a case created and advanced to `AWAITING_REVIEW` through service instance A is visible to a new service instance B on the same backing store
2. **Full lifecycle persistence**: a case advanced through `SUBMITTED → AWAITING_REVIEW → REVIEWED → DELIVERY_PENDING` survives a simulated restart with all fields intact (review, report, operation log, workflow queue)
3. **Delete propagation**: a case deleted through the repository is absent when a new service instance loads from the same backing store

All 3 tests pass as part of the `35/35` local test suite.

## 10. Durable queue model and operations read model

Confirmed locally.

The standalone baseline now records queue-backed execution state explicitly inside each durable case record rather than inferring it only from status transitions.

The queue model currently covers the bounded local stages that already exist in wave 1:

1. inference queue entry created when a case becomes `SUBMITTED`
2. inference queue completion recorded when the inference callback is accepted
3. delivery queue entry created when a reviewed case is finalized
4. delivery retry re-queues as a new durable delivery attempt
5. `GET /api/operations/summary` now returns a rebuildable queue read model with active queue depth by stage plus recent queue transcript entries

This is local durable queue state for the standalone baseline. It is not yet evidence of production-grade Redis-backed queue infrastructure or background-worker orchestration.

## 11. Durable worker artifact contract

Confirmed locally.

The standalone baseline now persists the minimum truthful worker-facing artifact surfaces that already exist in wave 1 as first-class fields on each durable case record:

1. study-context artifact derived from intake and routing state
2. QC summary artifact derived from the inference callback
3. structured findings payload derived from the generated report payload
4. bounded structural run provenance with package identity, version, and typed artifact refs
5. branch-execution evidence-card visibility on case detail reads

These fields are verified through both snapshot-backed and PostgreSQL-backed restart tests and are visible through `GET /api/cases/:caseId`.

All 3 artifact classes survive restart as part of the `35/35` local test suite.

## 12. Equivalent operator surface

Confirmed locally.

The standalone baseline now serves `GET /operator` as a minimal browser-facing operator workspace that binds directly to the existing workflow endpoints for:

1. queue dashboard
2. case detail
3. clinician review
4. finalize action
5. report preview
6. delivery retry

This is an equivalent operator surface inside the standalone app, not a separate frontend build or deployment stack.

## 9. CI postgres-smoke job

Configured in `.github/workflows/ci.yml`.

The `postgres-smoke` job uses a GitHub Actions `postgres:17-alpine` service container to:

1. run `npm run db:migrate` against a real PostgreSQL instance
2. verify `schema_migrations` contains the expected migration ID
3. verify the `case_records` table exists after migration

This job has not yet been executed on GitHub-hosted runners (GitHub work paused per standing instruction). It will be triggered when the next push to `main` occurs.

## Current Limit

This verification proves runtime baseline independence only.

It does not prove:

1. release-grade PostgreSQL operational readiness beyond the local clean-database migration smoke and the CI-configured schema verification
2. a real Python or external worker execution path for QC and structural processing
3. frontend readiness
4. demo readiness
5. successful execution of the CI `postgres-smoke` job on GitHub-hosted runners

## Audit Note

This runtime note should be read together with `docs/verification/repository-audit-2026-03-25.md`, which records the documentation-drift corrections made after validating the standalone subtree locally.

## Verdict Contribution

This note upgrades the repository from documentation-only skeleton to a workflow-capable local runtime baseline.

It does not change the repository verdict beyond `NOT_READY`.