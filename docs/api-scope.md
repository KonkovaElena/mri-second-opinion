# API Scope

## Wave 1 Public API

1. `POST /api/cases`
2. `GET /api/cases`
3. `GET /api/cases/:caseId`
4. `POST /api/cases/:caseId/review`
5. `POST /api/cases/:caseId/finalize`
6. `GET /api/cases/:caseId/report`
7. `GET /api/operations/summary`
8. `POST /api/delivery/:caseId/retry`
9. `GET /workbench`
10. `GET /healthz`
11. `GET /readyz`
12. `GET /metrics`

## Internal Integration Endpoints

1. `POST /api/internal/ingest`
2. `GET /api/internal/inference-jobs`
3. `POST /api/internal/inference-jobs/claim-next`
4. `POST /api/internal/inference-jobs/requeue-expired`
5. `POST /api/internal/inference-callback`
6. `GET /api/internal/delivery-jobs`
7. `POST /api/internal/delivery-jobs/claim-next`
8. `POST /api/internal/delivery-callback`

Route descriptions and public nouns should follow `docs/public-vocabulary.md`.

## Boundary Rules

1. DICOM ingress is mediated by Orthanc, not by ad hoc file-drop endpoints in the public API
2. inference execution is delegated to the Python compute plane
3. public API is workflow-oriented, not PACS-oriented
4. draft content is exposed through `GET /api/cases/:caseId` after internal ingest and inference complete; wave 1 does not expose a separate public draft-generation endpoint
5. delivery state is exposed through case detail and operations summary; wave 1 does not expose a separate public delivery-detail endpoint
6. current durability proof includes restart-safe local SQLite-backed case storage, a local persisted delivery-job queue, and a local persisted inference-job queue with stale-claim recovery; broader production-grade PostgreSQL durability remains future work
7. report payloads may include archive-linked artifact descriptors; `viewerReady` is only true when the payload contains trustworthy archive-binding metadata for an external viewer handoff, and wave 1 still does not claim a built-in viewer engine or PACS archive implementation
8. public read endpoints use stable presenter envelopes for case list, case detail, report, and operations summary instead of returning raw internal models directly
9. `GET /workbench` is a built-in operator surface for the current standalone API baseline; it is synthetic-demo-friendly, uses the live API plus existing internal callback seams, and does not claim an OHIF deployment or a production imaging workstation
10. internal inference-job and delivery-job claim, requeue, and callback rails are implementation proof for the local queue baselines, not a claim of distributed workers, external brokers, or hosted execution closure

For non-HTTP repository surfaces, see `docs/scope-inventory.md`.
