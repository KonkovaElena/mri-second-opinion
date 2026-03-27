---
title: "Workbench Frontend Audit 2026-03-27"
status: "active"
version: "1.0.0"
last_updated: "2026-03-27"
tags: [verification, frontend, workbench, mri]
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

## Audit Decision

The current standalone frontend closure is complete for the built-in synthetic-demo workbench surface.

Future frontend work remains out of scope for this audit:

1. OHIF deployment
2. production imaging viewer UX
3. worker-driven real-time progress UI