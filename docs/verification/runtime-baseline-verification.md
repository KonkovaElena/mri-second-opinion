# Runtime Baseline Verification

Date: 2026-03-26

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
10. `POST /api/internal/dispatch/claim`
11. `POST /api/internal/dispatch/heartbeat`
12. `POST /api/internal/inference-callback`
13. `POST /api/internal/delivery-callback`

The route-level tests cover create, review, finalize, delivery retry, delivery callback, inference replay protection, ingest idempotency, and malformed JSON normalization.

Internal mutation routes can now also be protected with an optional shared bearer token via `MRI_INTERNAL_API_TOKEN`.

When configured, the standalone runtime returns `401` for unauthenticated or incorrectly authenticated requests to:

1. `POST /api/internal/ingest`
2. `POST /api/internal/dispatch/claim`
3. `POST /api/internal/dispatch/heartbeat`
4. `POST /api/internal/inference-callback`
5. `POST /api/internal/delivery-callback`

This is a minimal trust-separation boundary for the current single-process baseline.

It is still not proof of a production worker fleet or stronger service identity beyond the current bounded signed worker scaffold.

The dispatch claim path is intentionally narrow.

It exposes durable queued `inference` and `delivery` work to an authenticated internal caller, records lease metadata on queue entries, renews active leases through `POST /api/internal/dispatch/heartbeat`, and returns expired claims to the queue when their lease window elapses.

It now has one bounded external worker proof path through the signed Python worker scaffold, but it is not yet evidence of a standalone worker fleet or distributed lease coordination beyond the current optional Redis-backed dispatch substrate.

## 6. Restart-safe local durability

Confirmed locally.

The current standalone baseline persists local case snapshots to a configured file and survives process restart for:

1. case records
2. queue-state transcript
3. delivery state
4. retry history
5. operation transcript
6. operations summary rebuild

This is local file-backed durability only. It is not evidence of PostgreSQL migration readiness.

## 7. Local PostgreSQL migration smoke

Confirmed locally.

`npm run db:migrate:smoke` was re-validated on 2026-03-27 against a clean local `postgres:17-alpine` container.

The smoke did all of the following:

1. started a disposable PostgreSQL container on a local port
2. applied the current SQL migration set through `applyPendingMigrations`
3. verified `schema_migrations` contains `001_create_case_records`, `002_idempotency_and_replay`, `003_transition_journal`, and `004_projection_split`
4. verified the `case_records` table exists after migration
5. cleaned up the disposable container after verification

This closes the local clean-database migration proof for the current baseline.

## 8. PostgreSQL restart-survival integration tests

Confirmed locally.

`tests/postgres-integration.test.ts` exercises the Postgres repository layer through the full `MemoryCaseService` lifecycle using an in-memory pool stub that simulates a shared database:

1. **Restart survival**: a case created and advanced to `AWAITING_REVIEW` through service instance A is visible to a new service instance B on the same backing store
2. **Full lifecycle persistence**: a case advanced through `SUBMITTED → AWAITING_REVIEW → REVIEWED → DELIVERY_PENDING` survives a simulated restart with all fields intact (review, report, operation log, workflow queue)
3. **Delete propagation**: a case deleted through the repository is absent when a new service instance loads from the same backing store
4. **Stale-writer rejection**: PostgreSQL whole-record updates reject an older competing writer instead of overwriting a newer durable queue claim

All 4 tests pass in the local standalone test suite.

## 9. Cross-platform path and artifact URI semantics

Confirmed across Windows authoring and Linux-hosted verification.

The current standalone baseline derives default local state, migration, and artifact roots through runtime path resolution and emits persisted local artifact references as canonical file URLs rather than host-specific string literals.

This behavior is exercised through:

1. `src/config.ts` for default state-path resolution
2. `src/artifact-store.ts` for canonical local artifact URI generation
3. `tests/memory-case-service.test.ts` for restart-safe artifact reference assertions that no longer depend on one host path format

GitHub-hosted `ci` was re-closed on 2026-03-27 after a Linux runner reproduced and then cleared a host-specific artifact-URI expectation in the restart test suite.

This is contributor and control-plane cross-platform evidence for the current baseline.

It is not yet proof of identical deployment packaging across every operating system; the intended server and GPU-worker topology remains Linux-first.

## 10. Durable queue model and operations read model

Confirmed locally.

The standalone baseline now records queue-backed execution state explicitly inside each durable case record rather than inferring it only from status transitions.

The queue model currently covers the bounded local stages that already exist in wave 1:

1. inference queue entry created when a case becomes `SUBMITTED`
2. inference queue completion recorded when the inference callback is accepted
3. delivery queue entry created when a reviewed case is finalized
4. delivery retry re-queues as a new durable delivery attempt
5. `GET /api/operations/summary` now returns a rebuildable queue read model with active queue depth by stage plus recent queue transcript entries
6. `GET /api/operations/summary` now also exposes additive `queueHealth` and `workerHealth` diagnostics for queued, in-flight, abandoned, dead-letter, retry, and active-worker visibility

This is durable queue state for the standalone baseline. The repository now also supports an optional Redis-backed dispatch substrate for queue transport, but this is not yet evidence of production-grade background-worker orchestration.

## 11. Internal dispatch-claim seam

Confirmed locally.

The standalone baseline now exposes a bounded internal worker-handoff route at `POST /api/internal/dispatch/claim`.

The current route contract supports:

1. queue-stage claims for `inference` and `delivery`
2. durable lease metadata persisted on the claimed queue entry
3. stage-aware dispatch payloads that return the already-persisted workflow package, study context, report payload, and structural artifact context required by the current bounded workflow
4. expiry-based requeue so an abandoned claim returns to `queued`

The route is verified by the HTTP test suite and the service-level restart tests.

This is still a single-process control-plane seam.

It now supports an optional Redis-backed queue substrate for dispatch transport, but it is not yet evidence of multi-worker lease coordination or external worker runtime closure.

## 12. Durable worker artifact contract

Confirmed locally.

The standalone baseline now persists the minimum truthful worker-facing artifact surfaces that already exist in wave 1 as first-class fields on each durable case record:

1. study-context artifact derived from intake and routing state
2. workflow-package manifest for the selected structural package
3. structural execution envelope with package identity, resource class, execution status, and produced artifact ids
4. typed artifact manifest for worker-produced outputs
5. QC summary artifact derived from the inference callback
6. structured findings payload derived from the generated report payload
7. bounded structural run provenance derived from the persisted execution contracts
8. branch-execution evidence-card visibility on case detail reads

These fields are verified through both snapshot-backed and PostgreSQL-backed restart tests and are visible through `GET /api/cases/:caseId`.

These execution-contract fields survive restart in the local standalone test suite.

The durable-state path now also applies optimistic concurrency to existing-record writes in both snapshot and PostgreSQL modes.

For PostgreSQL-backed persistence, the repository rejects stale whole-record updates rather than blindly overwriting a newer durable revision.

## 13. Equivalent operator surface

Confirmed locally.

The standalone baseline now serves `GET /operator` as a minimal browser-facing operator workspace that binds directly to the existing workflow endpoints for:

1. queue dashboard
2. case detail
3. clinician review
4. finalize action
5. report preview
6. delivery retry

This is an equivalent operator surface inside the standalone app, not a separate frontend build or deployment stack.

## 14. Correlation and structured workflow logs

Confirmed locally.

The standalone baseline now accepts `X-Correlation-Id` on workflow mutation routes, generates one when the header is missing, echoes it back on the HTTP response, and persists that value on durable `operationLog` entries.

The bounded signed Python worker scaffold reuses one correlation id across:

1. `POST /api/internal/dispatch/claim`
2. `POST /api/internal/dispatch/heartbeat`
3. `POST /api/internal/inference-callback` or `POST /api/internal/delivery-callback`

Mutation routes and server lifecycle events now also emit one-line JSON stdout logs so the bounded workflow transcript can be joined across HTTP responses, durable case state, and local runtime logs.

Representative stdout sample:

```json
{"ts":"2026-03-26T18:14:22.110Z","service":"mri-second-opinion","type":"workflow-mutation","event":"inference-callback","correlationId":"corr-worker-transcript-001","method":"POST","path":"/api/internal/inference-callback","caseId":"case-123","outcome":"completed","statusCode":200,"errorCode":null}
```

This is a bounded local observability seam only.

It is not yet evidence of a production log pipeline, trace backend, or distributed correlation strategy beyond the current standalone runtime.

## 15. PR-17 claim anchors

The current readiness claims are backed by these concrete repository artifacts:

1. **Signed internal routes**: `tests/workflow-api.test.ts` proves signed ingest, signed dispatch claim, and the bounded worker transcript path; `src/app.ts` enforces the route-level HMAC contract
2. **Replay and idempotency closure**: `tests/workflow-api.test.ts` proves `409 REPLAY_DETECTED` on nonce reuse; `README.md` documents the active replay window and its current in-memory boundary
3. **Queue substrate and worker transcript**: `tests/fixtures/worker-inference-transcript.json`, `worker/main.py`, and `tests/workflow-api.test.ts` together prove the bounded claim -> heartbeat -> callback path plus persisted correlation and operations-summary diagnostics
4. **Artifact indirection and version pinning**: `sql/migrations/004_projection_split.sql`, `tests/memory-case-service.test.ts`, `tests/postgres-integration.test.ts`, and `docs/architecture/reporting-and-export-contract.md` prove typed artifact-reference projections plus pinned reviewed and finalized release versions

These anchors are sufficient for evidence-ledger work.

They are not yet sufficient for a verdict upgrade because hosted demo evidence, screenshot capture, and broader operational proof remain incomplete.

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
2. a production-grade Python or external worker execution runtime beyond the current bounded scaffold and transcript proof
3. frontend readiness
4. demo readiness
5. successful execution of the CI `postgres-smoke` job on GitHub-hosted runners

## Audit Note

This runtime note should be read together with `docs/verification/repository-audit-2026-03-25.md`, which records the documentation-drift corrections made after validating the standalone subtree locally.

## Verdict Contribution

This note upgrades the repository from documentation-only skeleton to a workflow-capable local runtime baseline.

It does not change the repository verdict beyond `NOT_READY`.