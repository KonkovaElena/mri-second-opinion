---
title: "Archive Viewer Seam Audit 2026-03-27"
status: "active"
version: "1.0.0"
last_updated: "2026-03-27"
tags: [verification, archive, viewer, mri]
role: evidence
---

# Archive Viewer Seam Audit 2026-03-27

## Purpose

Record the closure of the archive-viewer compute seam in the standalone MRI repository.

This audit verifies that report artifacts are no longer limited to opaque string references.

It does not claim that the repository now ships an embedded viewer or a PACS implementation.

## Implemented Runtime Change

The standalone runtime now derives typed artifact descriptors from inference callback artifact references.

The active seam is implemented in:

1. `src/case-artifacts.ts`
2. `src/case-planning.ts`
3. `src/cases.ts`

The report payload now preserves two parallel artifact surfaces:

1. `artifacts[]` as legacy string references
2. `derivedArtifacts[]` as typed descriptors carrying archive linkage and viewer-ready hints

## Verified Descriptor Contract

Each derived artifact descriptor now preserves:

1. stable artifact identifier
2. artifact type classification such as `overlay-preview` or `qc-summary`
3. storage URI
4. MIME type
5. source archive locator with study and series linkage
6. optional viewer descriptor for viewer-ready artifact classes

Viewer-ready here means the payload contains enough trustworthy archive-binding metadata for an external viewer surface to attach later.

Synthetic fallback series identifiers or artifact naming alone are not sufficient.

It does not mean the repository contains a built-in viewer.

## Validation Performed

Validation completed on 2026-03-27:

1. changed-file diagnostics passed for `src/case-artifacts.ts`, `src/case-planning.ts`, `src/cases.ts`, and `tests/workflow-api.test.ts`
2. standalone subtree tests passed via `npm test`
3. standalone subtree build passed via `npm run build`
4. workspace immediate preflight passed via `workflow:catch-and-fix-now`

## Audit Decision

`Add archive viewer compute seams` is complete for the standalone repository.

Remaining future work stays out of scope for this step:

1. embedded viewer UI
2. real PACS archive implementation
3. DICOM SEG or DICOM SR export generation