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
9. `GET /healthz`
10. `GET /readyz`
11. `GET /metrics`

## Internal Integration Endpoints

1. `POST /api/internal/ingest`
2. `POST /api/internal/inference-callback`
3. `POST /api/internal/delivery-callback`

## Boundary Rules

1. DICOM ingress is mediated by Orthanc, not by ad hoc file-drop endpoints in the public API
2. inference execution is delegated to the Python compute plane
3. public API is workflow-oriented, not PACS-oriented
4. draft content is exposed through `GET /api/cases/:caseId` after internal ingest and inference complete; wave 1 does not expose a separate public draft-generation endpoint
5. delivery state is exposed through case detail and operations summary; wave 1 does not expose a separate public delivery-detail endpoint
6. current durability proof is limited to restart-safe local snapshot storage; PostgreSQL and queue-backed truth remain future work
