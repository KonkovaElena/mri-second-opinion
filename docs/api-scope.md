# API Scope

## Wave 1 Public API

1. `POST /api/cases`
2. `GET /api/cases`
3. `GET /api/cases/:caseId`
4. `POST /api/cases/:caseId/review`
5. `POST /api/cases/:caseId/finalize`
6. `GET /api/cases/:caseId/report`
7. `GET /api/cases/:caseId/evidence-bundle`
8. `GET /api/cases/:caseId/exports/dicom-sr`
9. `GET /api/cases/:caseId/exports/fhir-diagnostic-report`
10. `GET /api/cases/:caseId/artifacts/:artifactId`
11. `GET /api/operations/summary`
12. `POST /api/reader-study/concordance`
13. `POST /api/delivery/:caseId/retry`
14. `GET /workbench`
15. `GET /`
16. `GET /healthz`
17. `GET /readyz`
18. `GET /metrics`

## Internal Integration Endpoints

1. `POST /api/internal/ingest`
2. `GET /api/internal/inference-jobs`
3. `POST /api/internal/inference-jobs/claim-next`
4. `POST /api/internal/inference-jobs/requeue-expired`
5. `POST /api/internal/inference-callback`
6. `GET /api/internal/delivery-jobs`
7. `POST /api/internal/delivery-jobs/claim-next`
8. `POST /api/internal/delivery-callback`
9. `POST /api/internal/dispatch/claim`
10. `POST /api/internal/dispatch/heartbeat`
11. `POST /api/internal/dispatch/fail`

Route descriptions and public nouns should follow `docs/public-vocabulary.md`.

## Boundary Rules

1. DICOM ingress is mediated by Orthanc, not by ad hoc file-drop endpoints in the public API
2. inference execution is delegated to the Python compute plane
3. public API is workflow-oriented, not PACS-oriented
4. draft content is exposed through `GET /api/cases/:caseId` after internal ingest and inference complete; wave 1 does not expose a separate public draft-generation endpoint, and structured export endpoints remain finalized-only
5. delivery state is exposed through case detail and operations summary; wave 1 does not expose a separate public delivery-detail endpoint
6. current durability proof includes restart-safe local SQLite-backed case storage, a local persisted delivery-job queue, a local persisted inference-job queue with stale-claim recovery, and bounded artifact persistence through `local-file` and `s3-compatible` providers; broader production-grade PostgreSQL durability remains future work
7. report payloads may include archive-linked artifact descriptors; `viewerReady` is only true when the payload contains trustworthy archive-binding metadata for an external viewer handoff, and wave 1 still does not claim a built-in viewer engine or PACS archive implementation
8. public artifact retrieval is available through `GET /api/cases/:caseId/artifacts/:artifactId` and retrieval URLs emitted on case-detail and report surfaces; the stable route is now backed by `local-file` and `s3-compatible` artifact-store providers, while retention, multipart upload, and MinIO verification remain follow-on work
9. public read endpoints use stable presenter envelopes for case list, case detail, report, and operations summary instead of returning raw internal models directly
10. `GET /workbench` is a built-in operator surface for the current standalone API baseline; it is synthetic-demo-friendly, uses the live API plus existing internal callback seams, and does not claim an OHIF deployment or a production imaging workstation
11. internal inference-job, delivery-job, and dispatch claim or heartbeat rails are implementation proof for the local queue baselines, not a claim of distributed workers, external brokers, or hosted execution closure
12. if `MRI_INTERNAL_HMAC_SECRET` is configured, `/api/internal/dispatch/*` requires HMAC request-signing headers in addition to the optional namespace bearer token
13. case detail and report surfaces expose persisted package-manifest, structural-execution, typed artifact-manifest truth, and public retrieval URLs for persisted artifacts rather than reconstructing worker state only from report wording
14. active API descriptions should frame the repository as MRI-only workflow software and not as a broader cross-project medical orchestration surface

For non-HTTP repository surfaces, see `docs/scope-inventory.md`.
