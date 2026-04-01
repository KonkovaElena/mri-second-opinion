---
title: "MRI Second Opinion Demo Transcript"
status: "active"
version: "1.0.0"
last_updated: "2026-03-27"
tags: [mri, demo, transcript, evidence]
---

# MRI Second Opinion Demo Transcript

## Purpose

Record the bounded synthetic demo path that the repository can currently support truthfully.

## Preconditions

1. `npm ci`
2. `npm run build`
3. `npm start`
4. synthetic input from `docs/demo/synthetic-demo-input-provenance.md`
5. optional worker identifier used only for bounded local job-claim visibility

## Start-To-Finish Bounded Flow

1. **Create case**
   - call `POST /api/cases` with a synthetic `patientAlias`, synthetic `studyUid`, and `sequenceInventory`
   - expected result: `201`, case status moves to `SUBMITTED`, and inference work is queued
2. **Show queue state**
   - call `GET /api/operations/summary`
   - expected result: queue view shows queued inference work and additive `queueHealth` / `workerHealth` diagnostics
3. **Claim inference work**
   - call `POST /api/internal/inference-jobs/claim-next` with an optional `workerId`
   - expected result: `200`, an inference job is issued, and the response returns the bounded job record for the queued case
4. **Complete inference**
   - call `POST /api/internal/inference-callback` with the synthetic findings, measurements, and artifact URIs
   - expected result: `200`, case status moves to `AWAITING_REVIEW`, and the draft report plus artifact references become visible on case detail
5. **Open case detail**
   - call `GET /api/cases/:caseId`
   - expected result: detail output exposes study context, QC summary, findings payload, artifact manifest, structural run metadata, and durable operation-log entries
6. **Clinician review**
   - call `POST /api/cases/:caseId/review` with explicit `reviewerId`
   - expected result: `200`, case status moves to `REVIEWED`, and the reviewed release version is pinned
7. **Finalize report**
   - call `POST /api/cases/:caseId/finalize` with an explicit `finalSummary`
   - expected result: `200`, case status moves to `DELIVERY_PENDING`, and the finalized release version is pinned for delivery-safe reads
8. **Show report output**
   - call `GET /api/cases/:caseId/report`
   - expected result: report payload exposes stable `versionPins` and the finalized review state
9. **Show delivery queue state**
   - call `GET /api/internal/delivery-jobs`
   - expected result: the finalized case appears as durable delivery work waiting to be claimed
10. **Claim delivery work**
    - call `POST /api/internal/delivery-jobs/claim-next` with an optional `workerId`
    - expected result: `200`, a delivery job is issued for the finalized case
11. **Complete delivery state**
    - call `POST /api/internal/delivery-callback` with `deliveryStatus: delivered`
    - expected result: `200`, case status moves to `DELIVERED`

## Concrete Evidence Anchors

1. route and worker-loop verification: `tests/workflow-api.test.ts`
2. release pinning and restart-safe queue and artifact proof: `tests/memory-case-service.test.ts`
3. PostgreSQL-backed service-path proof: `tests/postgres-case-service.test.ts`
4. clean-database PostgreSQL bootstrap proof: `tests/postgres-bootstrap.test.ts`
5. screenshot-backed operator path: `docs/demo/operator-transcript-2026-03-27.md`
6. runtime summary note: `docs/verification/runtime-baseline-verification.md`

## Open Gaps

This transcript is sufficient for an honest bounded demo packet.

It is not sufficient for a verdict upgrade because the repository still lacks:

1. hosted or release-linked workflow execution proof on the current public head
2. a production worker fleet or distributed lease-coordination runtime beyond the bounded local job paths
3. launch-ready clinical or operational maturity evidence