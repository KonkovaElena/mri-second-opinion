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
2. delivery state
3. retry history
4. operation transcript
5. operations summary rebuild

This is local file-backed durability only. It is not evidence of PostgreSQL migration readiness.

## Current Limit

This verification proves runtime baseline independence only.

It does not prove:

1. PostgreSQL migration readiness
2. Redis-backed queue execution
3. frontend readiness
4. demo readiness
5. successful GitHub Actions execution history

## Audit Note

This runtime note should be read together with `docs/verification/repository-audit-2026-03-25.md`, which records the documentation-drift corrections made after validating the standalone subtree locally.

## Verdict Contribution

This note upgrades the repository from documentation-only skeleton to a workflow-capable local runtime baseline.

It does not change the repository verdict beyond `NOT_READY`.