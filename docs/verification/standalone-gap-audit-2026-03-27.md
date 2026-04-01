---
title: "MRI Second Opinion Gap Audit 2026-03-27"
status: "active"
version: "1.1.0"
last_updated: "2026-04-01"
tags: [verification, evidence, gap-audit, mri]
role: evidence
---

# MRI Second Opinion Gap Audit 2026-03-27

## Purpose

Capture the verified delta between the current repository-local MRI Second Opinion baseline and the next follow-on gaps after the recent durability, viewer-path, export, and artifact-store closure work.

This file is an evidence checkpoint.

It is not a roadmap substitute and it does not change product scope on its own.

## Verified Current Runtime

Verified today by direct file inspection:

1. TypeScript backend exists and boots from `src/index.ts` through `src/app.ts`
2. public workflow API plus built-in `/workbench` operator surface exist for create, list, detail, review, finalize, report, artifact access, operations, and delivery retry
3. internal job rails exist for ingest, inference-job list and claim, inference-job expiry requeue, delivery-job list and claim, inference callback, delivery callback, and HMAC-protected dispatch claim/heartbeat/fail paths
4. restart-safe local persistence now exists through the default SQLite repository path plus a locally verified PostgreSQL bootstrap/service path and an `ArtifactStore` seam with `local-file` and `s3-compatible` backends
5. regression coverage exists for workbench shell serving, archive-lookup viewer path, finalized export seams, HMAC/replay protection, and runtime hardening headers

## Gap Matrix

| Plan item | Verified current state | Gap to close next |
|-----------|------------------------|-------------------|
| Scope inventory docs | `docs/scope-lock.md`, `docs/api-scope.md`, and `docs/scope-inventory.md` now describe the active runtime and demo surfaces | Keep those authority docs aligned as the internal control plane evolves; no new inventory blocker is open today |
| Public vocabulary freeze | `docs/status-model.md` and `docs/public-vocabulary.md` are now active and aligned with the current public workflow contract | Preserve the frozen public vocabulary while inference-failure and lease-expiry details continue to live as internal execution outcomes |
| Durable storage seams | state survives restart through the default SQLite path, the PostgreSQL bootstrap/service path has local proof, and artifact persistence now routes through `ArtifactStore` with `local-file` plus `s3-compatible` providers | Remaining gap is release-linked PostgreSQL evidence plus object-store hardening: retention, multipart upload, and MinIO verification |
| Internal queue control plane | persisted inference and delivery job records, claim routes, expired-inference requeue, dispatch heartbeat/fail rails, and dual-auth regression coverage now exist | Remaining gap is hosted/distributed operational evidence and any later exhaustion policy tuning, not a missing baseline queue seam |
| Archive and viewer seam | bounded archive lookup, typed derived artifact descriptors, conservative `viewerReady` semantics, and the clinician-facing viewer path inside the built-in workbench now exist | Remaining gap is real OHIF/Orthanc/DICOMweb deployment proof rather than another local descriptor model |
| Presentation tightening | read-side envelopes for case list, case detail, report, jobs, operations summary, and the built-in workbench surface now exist | Remaining gap is future contract versioning only if external consumers beyond the current bounded API appear |
| Demo and publication proof | deterministic demo evidence, screenshot-backed workbench proof, public GitHub publication, and route-level workbench verification now exist | Remaining gap is hosted or release-linked end-to-end capture on the current pushed head rather than another local-only demo document |
| Security boundary | bearer protection for `/api/internal/*`, HMAC-protected dispatch routes, replay rejection, and CSP/document security header coverage are implemented and regression-tested | Remaining gap is hosted operational evidence such as key rotation, secret delivery, and deployment-time security closure |
| Interop exports | finalized-only DICOM SR JSON envelope and FHIR R4 DiagnosticReport exports now exist and are regression-covered | Remaining gap is binary DICOM Part-10 packaging plus a fuller enterprise-facing FHIR bundle |
| Clinical validation | reader-study, subgroup-analysis, PMS, and release-validation documents exist as repository-local governance/evidence surfaces | Remaining gap is execution: hosted evidence refresh, real reader study operations, and stronger post-market data collection |

## Execution Order Chosen

The next steps should proceed in this order:

1. close object-store follow-up on the current pushed head: retention, multipart upload, and MinIO verification
2. move bounded compute from metadata-plus-voxel proof to real ML and richer QC evidence
3. close production-grade viewer/archive runtime proof instead of adding another local viewer abstraction
4. strengthen export packaging and hosted evidence capture on the reconciled public repository state
5. execute the clinical-validation program outside the repo-local closure layer

This order keeps terminology and boundary truth stable while the next maturity work moves from repository-local closure to production-grade and externally verifiable evidence.

## Audit Decision

`Audit standalone gaps` is complete when this evidence file exists, the launch-evidence index points to it, and the file clearly separates already-closed baseline surfaces from true remaining follow-on gaps.

That condition is now satisfied for the current repository-local baseline.

The older todo items `Add scope inventory docs`, `Freeze public vocabulary`, `Add archive viewer compute seams`, `Tighten presentation surfaces`, `Add demo verification tests`, and `Run closure audits` are no longer open baseline blockers in this repository. The remaining work is follow-on hardening, not missing first-pass surfaces.