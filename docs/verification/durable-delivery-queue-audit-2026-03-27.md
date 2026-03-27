---
title: "Durable Delivery Queue Audit 2026-03-27"
status: "active"
version: "1.0.0"
last_updated: "2026-03-27"
tags: [verification, queue, durability, mri]
role: evidence
---

# MRI Standalone Durable Delivery Queue Audit 2026-03-27

## Purpose

Record the first implementation-backed audit for the standalone repository's explicit delivery-job queue.

This audit proves a local durable queue baseline.

It does not claim PostgreSQL durability, hosted workers, or external broker infrastructure.

## Implemented Surfaces

The repository now contains these queue-backed delivery surfaces:

1. persisted delivery-job records in snapshot mode and SQLite mode
2. restart-safe SQLite `delivery_jobs` table bootstrap in `src/case-sqlite-storage.ts`
3. service-level enqueue, claim, retry, and callback completion logic in `src/cases.ts`
4. internal worker-facing rails in `src/app.ts`:
   - `GET /api/internal/delivery-jobs`
   - `POST /api/internal/delivery-jobs/claim-next`
   - existing `POST /api/internal/delivery-callback`

## Verified Behaviors

The following behaviors are now covered by automated verification:

1. finalization enqueues a persisted delivery job instead of relying only on case status and operation log
2. delivery-job state survives app restart on the SQLite-backed runtime path
3. snapshot mode also persists queue state across restart
4. a worker can claim the next queued job through the internal queue rail
5. delivery callback completes the claimed job and updates the case state consistently
6. retry creates a new queued delivery job while preserving retry history

## Evidence

Primary evidence artifacts:

1. `tests/workflow-api.test.ts`
2. `tests/memory-case-service.test.ts`
3. `src/cases.ts`
4. `src/case-repository.ts`
5. `src/case-storage.ts`
6. `src/case-sqlite-storage.ts`
7. `src/app.ts`

## Validation Performed

Validation completed on 2026-03-27:

1. changed-file diagnostics passed on code and test surfaces
2. focused service and workflow tests passed with 26 passing tests and 0 failures
3. queue-specific restart and worker-claim scenarios passed in both HTTP and service-level coverage
4. standalone subtree build passed via `npm run build`

## Boundary Note

This audit closes the local queue-backed execution proof for the standalone SQLite-backed baseline.

Open infrastructure gaps still include:

1. production PostgreSQL durability proof
2. hosted or release-linked workflow verification
3. distributed or externally brokered worker execution proof
4. Python compute-plane closure

## Audit Decision

The repository now has truthful local evidence for queue-backed delivery execution and retry behavior.

The formal release verdict remains governed by `docs/releases/v1-go-no-go.md`.
