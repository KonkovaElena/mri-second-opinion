---
title: "Inference Queue Lease Audit 2026-03-27"
status: "active"
version: "1.0.0"
last_updated: "2026-03-27"
tags: [verification, queue, durability, inference, mri]
role: evidence
---

# MRI Standalone Inference Queue Lease Audit 2026-03-27

## Purpose

Record the first implementation-backed audit for the standalone repository's internal inference-job queue lease behavior.

This audit proves a local durable inference queue baseline with explicit stale-claim recovery.

It does not claim hosted workers, external brokers, or release-linked workflow execution.

## Implemented Surfaces

The repository now contains these queue-backed inference control-plane surfaces:

1. persisted `inference_jobs` records in snapshot, SQLite, and PostgreSQL modes
2. restart-safe `inference_jobs` bootstrap in `src/case-sqlite-storage.ts` and `src/postgres-bootstrap.ts`
3. service-level enqueue, claim, callback completion, and expired-claim requeue logic in `src/cases.ts`
4. internal worker-facing rails in `src/app.ts`:
   - `GET /api/internal/inference-jobs`
   - `POST /api/internal/inference-jobs/claim-next`
   - `POST /api/internal/inference-jobs/requeue-expired`
   - existing `POST /api/internal/inference-callback`

## Verified Behaviors

The following behaviors are now covered by automated verification:

1. case creation and accepted ingest enqueue a persisted inference job when the case enters `SUBMITTED`
2. inference-job state survives restart on the snapshot, SQLite-backed HTTP, and PostgreSQL-backed service paths
3. a worker can claim the next queued inference job through the internal queue rail
4. inference callback completes the active inference job and advances the case to `AWAITING_REVIEW`
5. expired claimed inference jobs can be requeued without widening the public case-status vocabulary
6. a requeued inference job can be claimed again, preserving cumulative `attemptCount`

## Evidence

Primary evidence artifacts:

1. `tests/memory-case-service.test.ts`
2. `tests/postgres-case-service.test.ts`
3. `tests/workflow-api.test.ts`
4. `tests/postgres-bootstrap.test.ts`
5. `src/cases.ts`
6. `src/case-repository.ts`
7. `src/case-storage.ts`
8. `src/case-sqlite-storage.ts`
9. `src/case-postgres-repository.ts`
10. `src/postgres-bootstrap.ts`
11. `src/app.ts`

## Validation Performed

Validation completed on 2026-03-27:

1. changed-file diagnostics passed on code and test surfaces
2. focused queue and workflow tests passed with 42 passing tests and 0 failures
3. inference-queue restart, worker-claim, callback-completion, and expired-claim requeue scenarios passed across snapshot, HTTP, and PostgreSQL paths
4. standalone subtree build passed via `npm run build`

## Boundary Note

This audit closes the local stale-claim recovery proof for the standalone inference queue.

Open infrastructure gaps still include:

1. hosted or release-linked workflow verification on real worker infrastructure
2. broader real-PostgreSQL runtime durability proof beyond bootstrap and local pg-mem-backed queue coverage
3. distributed or externally brokered worker execution proof
4. Python compute-plane closure and real model execution

## Audit Decision

The repository now has truthful local evidence for queue-backed inference execution, restart safety, and stale-claim recovery.

The formal release verdict remains governed by `docs/releases/v1-go-no-go.md`.