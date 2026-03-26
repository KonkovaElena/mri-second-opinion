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
2. `POST /api/internal/dispatch/claim`
3. `POST /api/internal/dispatch/heartbeat`
4. `POST /api/internal/inference-callback`
5. `POST /api/internal/delivery-callback`

## Boundary Rules

1. DICOM ingress is mediated by Orthanc, not by ad hoc file-drop endpoints in the public API
2. inference execution is delegated to the Python compute plane
3. public API is workflow-oriented, not PACS-oriented
4. `dispatch/claim` is scoped to queued `inference` and `delivery` work only; it is not an arbitrary task-dispatch endpoint
5. draft content is exposed through `GET /api/cases/:caseId` after internal ingest and inference complete; wave 1 does not expose a separate public draft-generation endpoint
6. delivery state is exposed through case detail and operations summary; wave 1 does not expose a separate public delivery-detail endpoint
7. current durability proof covers restart-safe local snapshot storage, a projection-backed queue/read-model layer, an optional PostgreSQL-backed persistence path with local integration proof, an optional Redis-backed dispatch substrate for internal dispatch routes, and a bounded signed Python worker scaffold; a separate external worker fleet remains future work
8. `dispatch/heartbeat` is scoped to renewing an already-issued lease for queued `inference` and `delivery` work; it is not a general worker-control endpoint
9. `POST /api/cases/:caseId/review` and `POST /api/cases/:caseId/finalize` are clinician-action routes; they require human identity in the request body and reject internal bearer or HMAC credentials with `403 MACHINE_CREDENTIAL_REJECTED`

## Read Scope Rules

1. `GET /api/cases` is a projection-backed summary list; it intentionally omits heavy detail branches such as `history`, `transitionJournal`, `workerArtifacts`, `evidenceCards`, and `planEnvelope`
2. `GET /api/cases/:caseId` remains the full-fidelity detail route for clinician and operator reads
3. `GET /api/cases/:caseId?view=summary` returns the same summary-grade projection shape used by `GET /api/cases`
4. `view` currently accepts only `detail` or `summary`; unsupported values fail with `400 INVALID_INPUT`
5. `GET /api/operations/summary` is projection-backed and must not depend on full case-record reconstruction
6. `GET /api/operations/summary` exposes additive queue and worker diagnostics, including queued, in-flight, abandoned, dead-letter, retry, and active-worker counts for the bounded workflow runtime
