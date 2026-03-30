---
title: "Workbench Frontend Audit 2026-03-27"
status: "active"
version: "2.0.0"
last_updated: "2026-03-30"
tags: [verification, frontend, workbench, mri, wave-3a]
role: evidence
---

# Workbench Frontend Audit 2026-03-27

## Purpose

Record the closure of the built-in frontend workbench surface for the standalone MRI repository.

This audit verifies the current synthetic-demo-friendly operator UI.

It does not claim an OHIF deployment, a production imaging viewer, or a real worker plane.

## Implemented Runtime Change

The standalone runtime now serves a built-in workbench at `GET /workbench`.

The active surface is implemented in:

1. `src/app.ts`
2. `public/workbench/index.html`
3. `public/workbench/review-workbench.css`
4. `public/workbench/review-workbench.js`

## UI To Endpoint Mapping

The workbench now exposes these real surfaces:

1. queue dashboard -> `GET /api/cases`
2. case detail -> `GET /api/cases/:caseId`
3. report preview -> `GET /api/cases/:caseId/report`
4. operations summary -> `GET /api/operations/summary`
5. clinician review -> `POST /api/cases/:caseId/review`
6. finalization -> `POST /api/cases/:caseId/finalize`
7. delivery retry -> `POST /api/delivery/:caseId/retry`
8. synthetic demo draft generation -> `POST /api/internal/inference-callback`

The draft-generation control is explicitly synthetic-demo-only.

It uses the existing internal callback seam because a real worker plane is not yet part of the standalone runtime.

## Validation Performed

Validation completed on 2026-03-27:

1. changed-file diagnostics passed for the new app route, tests, and workbench assets
2. targeted workbench integration test passed in `tests/workflow-api.test.ts`
3. standalone subtree tests passed via `npm test`
4. standalone subtree build passed via `npm run build`
5. live screenshots were captured from the running workbench into `docs/screenshots/`

## Wave 3A: Viewer Path In Built-In Workbench

The following Wave 3A capability was implemented and verified on 2026-03-30:

The workbench now renders an explicit Viewer Path panel between the Report Preview and Operations Summary panels. When a case has `viewerReady` artifacts with trusted archive binding, the panel renders:

1. a navigable `viewerPath` URL routed back to the workbench with artifact context
2. an `archiveStudyUrl` link to the resolved DICOMWeb study endpoint

The clinician-facing viewer path is fully integrated into the existing review workbench. No parallel UI or external viewer app was added.

### Implementation surfaces

1. `public/workbench/index.html` — new Viewer Path panel section
2. `public/workbench/review-workbench.js` — viewer panel rendering, `selectedArtifactId` state, archive study link population
3. `src/case-presentation.ts` — `buildViewerPath()` and `buildArchiveStudyUrl()` helpers

### Validation

1. `tests/workflow-api.test.ts` — workbench shell assertion now covers Viewer Path text
2. 95 tests pass, 0 fail

## UI To Endpoint Mapping (updated)

The workbench now exposes these real surfaces:

1. queue dashboard -> `GET /api/cases`
2. case detail -> `GET /api/cases/:caseId`
3. report preview -> `GET /api/cases/:caseId/report`
4. operations summary -> `GET /api/operations/summary`
5. clinician review -> `POST /api/cases/:caseId/review`
6. finalization -> `POST /api/cases/:caseId/finalize`
7. delivery retry -> `POST /api/delivery/:caseId/retry`
8. synthetic demo draft generation -> `POST /api/internal/inference-callback`
9. viewer path (archive study link) -> computed from artifact `viewerDescriptor` and `archiveLocator`

## Audit Decision

The current standalone frontend closure is complete for the built-in review workbench surface including the Wave 3A clinician-facing viewer path.

Future frontend work remains out of scope for this audit:

1. OHIF deployment or embedded production imaging viewer
2. real-time worker progress UI
3. multi-study comparison UI