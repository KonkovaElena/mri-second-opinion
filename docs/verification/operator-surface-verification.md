# Operator Surface Verification

Date: 2026-03-27

## Purpose

This note records the currently implemented equivalent operator surface for the standalone MRI subtree.

It is evidence of a real UI-bound review surface.

It is not evidence of a production frontend stack, screenshots, or demo closure.

## Implemented Surface

The standalone app now serves `GET /workbench` as the built-in browser-facing operator workspace.

The page binds directly to live workflow endpoints for:

1. queue dashboard via `/api/operations/summary`
2. case detail via `/api/cases/:caseId`
3. clinician review action via `/api/cases/:caseId/review`
4. finalize action via `/api/cases/:caseId/finalize`
5. report preview via `/api/cases/:caseId/report`
6. delivery retry via `/api/delivery/:caseId/retry`

## Verification Basis

The current operator surface is verified by:

1. `tests/workflow-api.test.ts` — the HTML route exists and binds queue, case detail, review, finalize, report preview, and retry endpoints
2. `src/app.ts` — the page is served directly by the standalone app at `GET /workbench`
3. `public/workbench/index.html`, `public/workbench/review-workbench.css`, and `public/workbench/review-workbench.js` — the current workbench assets are real repository surfaces rather than placeholder-only markup

## Honesty Boundary

This surface proves:

1. a real equivalent operator UI path exists
2. every visible action is wired to a live backend endpoint
3. queue, case detail, review, finalize, report preview, and retry can be reached from one page

This surface does not prove:

1. a separate frontend build pipeline
2. an OHIF deployment or production imaging workstation
3. polished clinical review UX
4. launch-ready frontend or clinical deployment maturity

Screenshot-backed and demo-path evidence are now tracked separately in `docs/demo/operator-transcript-2026-03-27.md` and `docs/verification/workbench-frontend-audit-2026-03-27.md`.