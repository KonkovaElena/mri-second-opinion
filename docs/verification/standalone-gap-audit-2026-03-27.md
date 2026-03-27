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
3. internal integration rails exist for ingest, inference callback, and delivery callback
4. restart-safe local persistence now exists through the SQLite-backed repository path in `src/case-repository.ts` and `src/case-sqlite-storage.ts`
5. API and service tests already prove the baseline case lifecycle and restart behavior

## Gap Matrix

| Plan item | Verified current state | Gap to close next |
|-----------|------------------------|-------------------|
| Scope inventory docs | `docs/scope-lock.md` and `docs/api-scope.md` exist, but they are narrative-only | Add a concrete runtime inventory that names active endpoints, data surfaces, docs, and demo assets |
| Public vocabulary freeze | `docs/status-model.md` defines states, but public nouns and error vocabulary are still spread across docs and code | Add one canonical vocabulary reference and align docs to it |
| Durable storage seams | state survives restart via a local SQLite-backed store with conflict and restart proof | Remaining gap is production-grade PostgreSQL, queue-backed execution, and richer durable projections |
| DICOM QC seams | sequence gating exists and `qcDisposition` is accepted on inference callback | Add explicit study-ingest, QC, and DICOM metadata contract surfaces instead of folding everything into generic callback payloads |
| Archive viewer compute seams | report artifacts are string references only | Add explicit archive and viewer-ready artifact descriptors without claiming a built-in viewer |
| Presentation tightening | API surface exists, but list/detail/summary payloads still expose internal shapes directly | Add stable response envelopes for public reads and operator-facing summaries |
| Demo verification | baseline API tests exist | Add a deterministic demo-flow verification path covering the named demo lifecycle |

## Execution Order Chosen

The next steps should proceed in this order:

1. scope inventory documentation
2. vocabulary freeze
3. durable storage replacement
4. DICOM and QC seam addition
5. archive and viewer seam addition
6. presentation tightening
7. demo verification tests

This order keeps terminology and boundary truth stable before durable-state and API-shape changes begin.

## Audit Decision

`Audit standalone gaps` is complete when this evidence file exists and the launch-evidence index points to it.

That condition is now satisfied.