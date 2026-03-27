---
title: "Standalone Gap Audit 2026-03-27"
status: "active"
version: "1.0.0"
last_updated: "2026-03-27"
tags: [verification, evidence, gap-audit, mri]
role: evidence
---

# MRI Standalone Gap Audit 2026-03-27

## Purpose

Capture the verified delta between the current standalone repository state and the next implementation steps required by the active execution plan.

This file is an evidence checkpoint.

It is not a roadmap substitute and it does not change product scope on its own.

## Verified Current Runtime

Verified today by direct file inspection:

1. TypeScript backend exists and boots from `src/index.ts` through `src/app.ts`
2. public workflow API exists for create, list, detail, review, finalize, report, operations, and delivery retry
3. internal job rails exist for ingest, inference-job list and claim, inference-job expiry requeue, delivery-job list and claim, inference callback, and delivery callback
4. restart-safe local persistence now exists through the default SQLite repository path plus a locally verified PostgreSQL bootstrap and service path
5. the full standalone test suite already proves the baseline case lifecycle, restart behavior, queue persistence, and the bounded PostgreSQL path

## Gap Matrix

| Plan item | Verified current state | Gap to close next |
|-----------|------------------------|-------------------|
| Scope inventory docs | `docs/scope-lock.md`, `docs/api-scope.md`, and `docs/scope-inventory.md` now describe the active runtime and demo surfaces | Keep those authority docs aligned as the internal control plane evolves; no new inventory blocker is open today |
| Public vocabulary freeze | `docs/status-model.md` and `docs/public-vocabulary.md` are now active and aligned with the current public workflow contract | Preserve the frozen public vocabulary while inference-failure and lease-expiry details continue to live as internal execution outcomes |
| Durable storage seams | state survives restart through the default SQLite path, and the PostgreSQL bootstrap plus service path now have local proof | Remaining gap is release-linked PostgreSQL operational evidence and stronger deployment-grade persistence proof beyond the local environment |
| Internal queue control plane | persisted inference and delivery job records, claim routes, and expired-inference requeue now exist | Add bounded lease-expiry, retry, and exhaustion policy without widening the public case-status vocabulary casually |
| Archive and viewer seam | typed derived artifact descriptors and conservative `viewerReady` semantics now exist | Remaining gap is real archive binding and external viewer integration rather than a second local descriptor model |
| Presentation tightening | read-side envelopes for case list, case detail, report, jobs, and operations summary now exist | Remaining gap is future contract versioning only if external consumers beyond the current bounded API appear |
| Demo and publication proof | deterministic demo evidence, screenshot-backed workbench proof, and public GitHub publication now exist | Remaining gap is hosted or release-linked end-to-end capture on the current pushed head rather than another local-only demo document |
| Security boundary | configuration carries forward internal token, HMAC, and replay settings from earlier publication work | Remaining gap is a deliberate auth wave that actually enforces those boundaries in the merged app runtime before durable nonce work is claimed |

## Execution Order Chosen

The next steps should proceed in this order:

1. close release-linked PostgreSQL evidence on the current pushed head
2. extend the internal inference-job control plane with bounded lease-expiry and recovery rules
3. tighten artifact integrity and reproducibility evidence on the existing derived-artifact surface
4. introduce transport-auth and durable nonce storage only in the same wave that route enforcement actually ships
5. capture hosted or release-linked workflow evidence on the reconciled public repository state

This order keeps terminology and boundary truth stable while the next maturity work moves from local proof to release-linked evidence.

## Audit Decision

`Audit standalone gaps` is complete when this evidence file exists and the launch-evidence index points to it.

That condition is now satisfied.