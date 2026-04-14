---
title: "Archive Viewer Seam Audit 2026-03-27"
status: "active"
version: "2.1.0"
last_updated: "2026-04-14"
tags: [verification, archive, viewer, mri, wave-3a]
role: evidence
---

# Archive Viewer Seam Audit 2026-03-27

## Purpose

Record the closure of the archive-viewer compute seam in the standalone MRI repository.

This audit verifies that report artifacts are no longer limited to opaque string references and that the repository now provides a bounded archive metadata lookup and an explicit clinician-facing viewer path in the built-in review workbench.

It does not claim that the repository ships an embedded production imaging viewer or a production PACS implementation.

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

An additional targeted proof pack was added on 2026-04-14 for the explicit `archiveLookupMode=dicomweb` path.

That focused validation confirms the DICOMweb seam against PS3.18 2026b Studies Search and Retrieve resource shapes:

1. QIDO-RS Studies Search on `/studies{?search*}`
2. QIDO-RS Study's Series Search on `/studies/{study}/series{?search*}`
3. series-level retrieve or handoff paths derived from `/studies/{study}/series/{series}`

The repository proof remains bounded to ingest-time archive enrichment and viewer handoff metadata. It still does not claim a deployed Orthanc or OHIF runtime.

## Wave 3A: Archive Lookup And Viewer Path Closure

The following Wave 3A capabilities were implemented and verified on 2026-03-30:

### Bounded archive metadata lookup

A new `src/archive-lookup.ts` module provides a bounded read-only DICOMWeb/Orthanc metadata lookup client. When `MRI_ARCHIVE_LOOKUP_BASE_URL` is configured, case intake enriches missing `studyContext` fields from the archive before plan envelope and evidence-card generation. The enrichment is caller-first: caller-supplied fields take precedence and archive fields fill gaps only. When the archive is not configured or lookup fails, case creation falls back cleanly to the existing metadata-only path.

### Clinician-facing viewer path

The existing review workbench at `GET /workbench` now renders an explicit Viewer Path panel. When a `viewerReady` artifact has a trusted archive binding, the workbench renders navigable `viewerPath` and `archiveStudyUrl` links derived from the artifact's `viewerDescriptor` and `archiveLocator` fields. The viewer path is rendered inside the existing workbench, not in a parallel UI.

### Implementation surfaces

1. `src/archive-lookup.ts` — bounded archive lookup client with `createArchiveLookupClient()` and `parseStudyContextPayload()`
2. `src/config.ts` — `archiveLookupBaseUrl` and `archiveLookupSource` optional config fields
3. `src/app.ts` — archive lookup intake wiring via `enrichCreateCaseInput()`, `needsArchiveLookup()`, `mergeStudyContext()`
4. `src/case-presentation.ts` — `buildViewerPath()` and `buildArchiveStudyUrl()` helpers
5. `public/workbench/index.html` — Viewer Path panel section
6. `public/workbench/review-workbench.js` — viewer panel rendering and artifact viewer links
7. `tests/workflow-api.test.ts` — 3 new end-to-end tests covering archive enrichment positive path, fallback negative path, and workbench viewer path assertion

### Validation

1. 95 tests pass, 0 fail, 1 skipped
2. `npm run build` clean
3. Archive enrichment resolves real study metadata from configured DICOMWeb endpoint
4. `viewerReady` stays honest: only true when trusted archive binding exists
5. Workbench renders viewer and archive links only when binding is trustworthy
6. isolated DICOMweb ingest enrichment is now proven via `tests/archive-dicomweb.test.ts`, including explicit `includefield` queries for required study and series tags plus canonical study-resource path composition

## Audit Decision

`Add archive viewer compute seams` is complete for the standalone repository.

Wave 3A archive and viewer truth closure is complete: bounded archive lookup and clinician-facing viewer path are both code-backed and test-proven.

Remaining future work stays out of scope for this step:

1. production PACS auth and orchestration
2. embedded OHIF or equivalent viewer deployment
3. DICOM SEG or DICOM SR export generation