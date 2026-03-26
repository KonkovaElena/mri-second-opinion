---
title: "MRI Standalone Demo Transcript"
status: "active"
version: "1.0.0"
last_updated: "2026-03-26"
tags: [mri, demo, transcript, evidence]
---

# MRI Standalone Demo Transcript

## Purpose

Record the bounded synthetic demo path that the repository can currently support truthfully.

## Preconditions

1. `npm ci`
2. `npm run build`
3. `npm start`
4. synthetic input from `docs/demo/synthetic-demo-input-provenance.md`
5. signed-worker proof source from `tests/fixtures/worker-inference-transcript.json`

## Start-To-Finish Bounded Flow

1. **Create case**
   - call `POST /api/cases` with a synthetic `patientAlias`, synthetic `studyUid`, and `sequenceInventory`
   - expected result: `201`, case status moves to `SUBMITTED`, and inference work is queued
2. **Show queue state**
   - call `GET /api/operations/summary`
   - expected result: queue view shows queued inference work and additive `queueHealth` / `workerHealth` diagnostics
3. **Claim inference work**
   - call `POST /api/internal/dispatch/claim` with a valid HMAC-signed request from the synthetic worker transcript
   - expected result: `200`, a lease is issued, and the dispatch payload returns the bounded workflow package and study context
4. **Renew lease**
   - call `POST /api/internal/dispatch/heartbeat`
   - expected result: `200`, the same lease id stays active and expiry moves forward
5. **Complete inference**
   - call `POST /api/internal/inference-callback` with the synthetic findings, measurements, and artifact URIs
   - expected result: `200`, case status moves to `AWAITING_REVIEW`, and the draft report plus artifact references become visible on case detail
6. **Open case detail**
   - call `GET /api/cases/:caseId`
   - expected result: detail output exposes study context, QC summary, findings payload, artifact manifest, structural run metadata, and durable operation-log entries
7. **Clinician review**
   - call `POST /api/cases/:caseId/review` with explicit `reviewerId`
   - expected result: `200`, case status moves to `REVIEWED`, and the reviewed release version is pinned
8. **Finalize report**
   - call `POST /api/cases/:caseId/finalize` with explicit `clinicianId`
   - expected result: `200`, case status moves to `DELIVERY_PENDING`, and the finalized release version is pinned for delivery-safe reads
9. **Show report output**
   - call `GET /api/cases/:caseId/report`
   - expected result: report payload exposes stable `versionPins` and the finalized review state
10. **Complete delivery state**
    - call `POST /api/internal/delivery-callback` with a valid signed request and `deliveryStatus: delivered`
    - expected result: `200`, case status moves to `DELIVERED`

## Concrete Evidence Anchors

1. route and worker-loop verification: `tests/workflow-api.test.ts`
2. synthetic worker inputs: `tests/fixtures/worker-inference-transcript.json`
3. release pinning and restart-safe queue/artifact proof: `tests/memory-case-service.test.ts`
4. PostgreSQL-backed restart-safe version and artifact proof: `tests/postgres-integration.test.ts`
5. runtime summary note: `docs/verification/runtime-baseline-verification.md`

## Open Gaps

This transcript is sufficient for an honest bounded demo packet.

It is not sufficient for a verdict upgrade because the repository still lacks:

1. a screenshot bundle for queue, case detail, evidence, review, report, and delivery surfaces
2. a timed operator run proving the path is reproducible in under ten minutes
3. hosted or broader operational proof beyond the bounded local scaffold