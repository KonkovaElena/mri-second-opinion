# MRI Standalone Demo Script

Status: active

This script defines the minimum truthful demo for MRI Standalone v1.

Do not present steps that are not yet implemented in the standalone repository.

## Demo Goal

Show the MRI second-opinion workflow from intake to delivery state using synthetic data and explicit clinician review.

## Preconditions

1. standalone repository boots locally via `npm run build` and `npm start`
2. built-in workbench is reachable at `GET /workbench`
3. operator uses only synthetic demo controls and synthetic case payloads
4. screenshots are captured from the live workbench rather than mockups

## Target Walk-Through

1. open `GET /workbench?demoStage=submitted` and show the seeded queue case
2. open `GET /workbench?demoStage=awaiting-review` and show case detail, draft report preview, and review workspace
3. submit review in the workbench or use the pre-seeded review state for evidence capture
4. open `GET /workbench?demoStage=delivery-failed` and show finalized report preview plus failed delivery state
5. open `GET /workbench?demoStage=delivery-pending` and show the retry path after delivery requeue

## Required Evidence Capture

During the first complete demo run, capture:

1. startup command sequence
2. operator transcript with exact workbench URLs used
3. screenshots for queue, case detail plus review, report preview, and delivery state
4. any manual operator steps still required

## Authority Note

This script is now authoritative for the current synthetic internal-demo path.

The runtime proof is split across:

1. `tests/workflow-api.test.ts` for deterministic API lifecycle verification
2. `docs/verification/workbench-frontend-audit-2026-03-27.md` for UI-to-endpoint mapping
3. `docs/demo/operator-transcript-2026-03-27.md` for the real operator walk-through

It does not prove hosted deployment, PostgreSQL durability, queue-backed worker execution, or an OHIF deployment.