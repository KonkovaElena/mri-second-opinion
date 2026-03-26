# MRI Second Opinion

Open-source, clinician-in-the-loop MRI second-opinion workflow.

## Repository Snapshot

1. scope: MRI-only workflow baseline
2. verified today: standalone TypeScript API plus snapshot-backed restart safety, a durable local queue/read-model layer for inference and delivery, a bounded internal dispatch-claim seam for worker handoff, an optional Redis-backed dispatch substrate for `inference` and `delivery` claims, first-class persisted study-context/QC/findings artifacts, a persisted workflow-package manifest plus structural execution envelope and typed artifact manifest, typed artifact references with a local-file or s3-compatible object-store seam, a bounded structural run surface with typed derived artifacts, a minimal equivalent operator surface for queue/review/report work, an optional PostgreSQL persistence mode with stale-writer rejection on whole-record updates, optional bearer-token protection for internal mutation routes, local clean-database migration smoke on PostgreSQL, Postgres restart-survival integration tests, and a CI postgres-smoke job
3. not present yet: release-grade durable-state evidence beyond local smoke, production worker execution, frontend review workspace, and demo closure
4. current repository verdict: `NOT_READY`

## Scope

This repository is intended to become a standalone MRI-only product.

It is not:

1. a general PACS
2. a universal medical imaging platform
3. an autonomous diagnostic system
4. a custom imaging viewer engine

## Intended v1 stack

1. TypeScript workflow core
2. PostgreSQL durable state
3. Redis-backed workflow queue
4. MinIO-compatible object storage for derived artifacts and export payloads
5. Orthanc for DICOM ingress and DICOMWeb serving
6. Python inference worker for QC and AI processing
7. OHIF-backed clinician review UI

## Current status

Wave 1 workflow API baseline exists.

Currently verified baseline:

1. standalone dependency installation
2. standalone TypeScript build
3. baseline service startup
4. public workflow routes for case create, list, detail, review, finalize, report retrieval, delivery retry, and operations summary
5. internal ingest, dispatch heartbeat, inference callback, and delivery callback endpoints
6. optional bearer-token protection for internal ingest, dispatch claim, inference callback, and delivery callback endpoints via `MRI_INTERNAL_API_TOKEN`; HMAC-SHA256 signed-request authentication available via `MRI_INTERNAL_HMAC_SECRET` (preferred for production)
7. clinician-action review and finalize routes require explicit human identity from the request body and reject internal machine credentials on those public routes
8. restart-safe local snapshot persistence for case state, queue state, delivery state, retry history, and operation transcript
9. first-class persisted study-context, workflow-package manifest, structural execution envelope, typed artifact manifest, QC summary, findings payload, and bounded structural run surfaces on case detail reads
10. typed artifact references with URI, checksum, media type, producer, attempt identity, and a local-file or s3-compatible storage seam
10. structured API error envelopes for invalid transport input
11. `GET /`, `GET /healthz`, `GET /readyz`, and `GET /metrics`
12. internal workflow logic is now split across orchestration, planning, and snapshot-repository seams without changing the HTTP contract
13. `POST /api/internal/dispatch/claim` exposes a bounded internal worker-handoff seam for queued `inference` and `delivery` work with durable lease metadata and expiry-based requeue
14. PostgreSQL-backed whole-record updates now reject stale writers instead of blindly overwriting a newer durable case revision
15. `GET /operator` serves a minimal equivalent operator surface for queue, case detail, review, finalize, report preview, and delivery retry

The standalone repository still does not provide:

1. release-grade PostgreSQL durability evidence beyond the local integration tests and CI-configured migration verification
2. background-worker execution, multi-worker lease coordination, or dead-letter governance beyond the current bounded internal dispatch-claim seam and optional Redis queue substrate
3. release-grade object-store-backed artifact durability beyond the current typed artifact-reference seam
4. OHIF or other frontend review surfaces
5. a production-grade Python or external worker runtime beyond the current bounded signed worker scaffold and local structural run contract
6. demo closure or launch-ready evidence
7. ~~main-branch GitHub-hosted CI build and test evidence~~ (now recorded — see `docs/verification/launch-evidence-index.md`)

The runtime can now select snapshot mode or PostgreSQL-backed persistence via `DATABASE_URL`. `npm run db:migrate` prepares the current schema, and `npm run db:migrate:smoke` now proves the migration path against a clean local PostgreSQL container. That is useful local evidence, but it still does not by itself establish launch-ready durable-state closure.

## Quick Start

Run the standalone subtree directly.

```bash
npm ci
npm run build
npm test
npm start
```

Optional database setup rail for the future durable-state path:

```bash
DATABASE_URL=postgresql://... npm run db:migrate
npm run db:migrate:smoke
```

Optional local infrastructure bring-up for the current Postgres and Redis seams:

```bash
docker compose up -d postgres redis
```

When `DATABASE_URL` is present, the API now advertises `persistenceMode: "postgres"` from `GET /` and `GET /readyz` and routes case storage through the PostgreSQL repository.

When `MRI_INTERNAL_API_TOKEN` is present, internal mutation routes require `Authorization: Bearer <token>`.

When `MRI_INTERNAL_HMAC_SECRET` is present (≥ 32 bytes), internal mutation routes require HMAC-SHA256 signed requests instead of Bearer tokens. Each request must include three headers:

| Header | Content |
|--------|---------|
| `X-MRI-Timestamp` | ISO 8601 UTC timestamp at send time |
| `X-MRI-Nonce` | Unique random value per request |
| `X-MRI-Signature` | `HMAC-SHA256(secret, METHOD + "\n" + PATH + "\n" + Timestamp + "\n" + Nonce + "\n" + SHA256(body))` as hex |

Requests outside the clock-skew window (default ±60 s, configurable via `MRI_CLOCK_SKEW_TOLERANCE_MS`) are rejected.

**Replay protection:** When HMAC signing is active, the server tracks consumed nonces in memory. A repeated nonce within the TTL window (default 120 s, configurable via `MRI_REPLAY_STORE_TTL_MS`) returns `409 REPLAY_DETECTED`. The in-memory store holds up to `MRI_REPLAY_STORE_MAX_ENTRIES` entries (default 10 000) before evicting the oldest. A PostgreSQL-backed replay store is available via migration `002-replay-nonces.sql` (not yet wired — memory mode covers the current baseline).

When both `MRI_INTERNAL_HMAC_SECRET` and `MRI_INTERNAL_API_TOKEN` are set, HMAC takes precedence and Bearer is ignored.

Derived artifacts now flow through a typed reference contract instead of staying only as opaque inline blobs. Configure that seam with:

| Variable | Purpose |
|--------|---------|
| `MRI_ARTIFACT_STORE_PROVIDER` | `local-file` or `s3-compatible` |
| `MRI_ARTIFACT_STORE_BASE_PATH` | local artifact root or object-key base path |
| `MRI_ARTIFACT_STORE_ENDPOINT` | optional explicit endpoint for s3-compatible deployments |
| `MRI_ARTIFACT_STORE_BUCKET` | optional bucket name for s3-compatible deployments |

The current implementation still defaults to a local-file artifact root under `.mri-data/artifacts`, but the persisted reference model is now object-store ready without another case-state rewrite.

Dispatch claims can also move from the default local queue substrate to Redis-backed transport:

| Variable | Purpose |
|--------|---------|
| `MRI_QUEUE_PROVIDER` | `local` or `redis` |
| `MRI_REDIS_URL` | Redis connection string used when the provider is `redis` |
| `MRI_QUEUE_KEY_PREFIX` | stage-specific queue key prefix |

The Redis path now covers queue transport for `POST /api/internal/dispatch/claim`, but the durable source of truth for attempts, lease metadata, and operator-visible queue state remains the persisted case record.

That boundary currently covers `POST /api/internal/ingest`, `POST /api/internal/dispatch/claim`, `POST /api/internal/dispatch/heartbeat`, `POST /api/internal/inference-callback`, and `POST /api/internal/delivery-callback`.

One minimal external worker loop now exists under `worker/`.

It signs claim, heartbeat, and callback requests against the current HMAC contract so the repository no longer depends only on local callback simulation to prove worker-loop closure.

It is a bounded scaffold, not a production inference runtime.

Public clinician-action routes stay separate from that machine boundary. `POST /api/cases/:caseId/review` requires `reviewerId` in the request body, `POST /api/cases/:caseId/finalize` requires `clinicianId`, and both routes reject internal bearer or HMAC credentials with `403 MACHINE_CREDENTIAL_REJECTED`.

Use this quick start to verify the current baseline only.

It does not prove a launch-ready product, a hosted deployment path, or a full MRI review stack.

The repository includes standalone `.github/workflows/ci.yml` and `.github/workflows/docs-governance.yml` workflows. Both now have recorded hosted success on GitHub-hosted runners. See `docs/verification/launch-evidence-index.md` for run URLs.

## Community Health

Public publication is live and intentionally conservative.

Use these repository-health files when contributing or evaluating readiness:

1. `CONTRIBUTING.md`
2. `SECURITY.md`
3. `CODE_OF_CONDUCT.md`
4. `SUPPORT.md`
5. `GOVERNANCE.md`
6. `.github/ISSUE_TEMPLATE/bug-report.yml`
7. `.github/ISSUE_TEMPLATE/feature-request.yml`
8. `.github/ISSUE_TEMPLATE/docs-scope.yml`
9. `.github/ISSUE_TEMPLATE/config.yml`
10. `.github/PULL_REQUEST_TEMPLATE.md`
11. `.github/dependabot.yml`

Canonical design artifacts currently live in `docs/`.

Core standalone documents:

1. `docs/scope-lock.md`
2. `docs/status-model.md`
3. `docs/api-scope.md`
4. `docs/architecture/overview.md`
5. `docs/architecture/orchestrator-control-plane.md`
6. `docs/architecture/orchestrator-reference-contracts.md`
7. `docs/architecture/neuro-first-mvp-slice.md`
8. `docs/architecture/reasoning-agent-safety-and-validation.md`
9. `docs/architecture/mvp-work-package-map.md`
10. `docs/architecture/reference-workflow-routing.md`
9. `docs/architecture/reporting-and-export-contract.md`
10. `docs/architecture/queue-substrate-adr.md`
11. `docs/open-source-target-architecture.md`
12. `docs/academic/ecosystem-landscape-march-2026.md`
13. `docs/academic/external-evidence-register-march-2026.md`
14. `docs/academic/model-licensing-and-deployment-gates.md`
15. `docs/academic/regulatory-positioning.md`
16. `docs/roadmap-and-validation.md`
18. `docs/academic/regulatory-positioning.md`
19. `docs/roadmap-and-validation.md`

## Launch Readiness

The standalone repository should not be described as launch-ready from design intent alone.

Use these documents as the current release gate:

1. `docs/launch-readiness-checklist.md`
2. `docs/verification/launch-evidence-index.md`
3. `docs/demo/demo-script.md`
4. `docs/demo/synthetic-demo-input-provenance.md`
5. `docs/demo/demo-transcript.md`
6. `docs/releases/v1-go-no-go.md`
7. `docs/verification/documentation-honesty-review.md`
8. `docs/verification/runtime-baseline-verification.md`
9. `docs/releases/public-github-and-mvp-path.md`
10. `docs/releases/github-publication-playbook.md`
11. `docs/releases/github-go-live-checklist.md`
12. `docs/releases/github-metadata-copy.md`
13. `docs/releases/github-settings-worksheet.md`
14. `docs/releases/github-live-publication-sequence.md`
15. `docs/releases/first-public-announcement-draft.md`
16. `docs/releases/github-operator-packet.md`
17. `docs/demo/social-preview-brief.md`
18. `docs/verification/hosted-evidence-capture-template.md`
19. `docs/verification/ai-auditor-handoff-2026-03-25.md`
20. `docs/verification/repository-audit-2026-03-25.md`

## Academic Position

The repository is intentionally grounded in explicit claim discipline and open-source MRI ecosystem rationale.

Use these documents when evaluating whether a statement is implemented truth, design intent, or research-informed guidance:

1. `docs/academic/evidence-and-claims-policy.md`
2. `docs/academic/open-source-rationale.md`
3. `docs/academic/external-evidence-register-march-2026.md`
4. `docs/releases/public-github-and-mvp-path.md`
5. `docs/releases/github-publication-playbook.md`
6. `docs/releases/github-metadata-copy.md`
7. `docs/releases/github-settings-worksheet.md`

Current expected verdict:

1. `NOT_READY` until repository independence, workflow closure, durable state, frontend closure, and demo evidence are all present

## Reference Design Map

Use the standalone docs as a layered design set rather than as one narrative document:

1. `docs/architecture/overview.md` for operating boundaries and node responsibilities
2. `docs/architecture/orchestrator-control-plane.md` for the transparent control-plane model that binds routing, workflow packages, policy gates, and human review
3. `docs/architecture/orchestrator-reference-contracts.md` for the schema-level contract set behind package manifests, plan envelopes, evidence cards, policy gates, and downgrade records
4. `docs/architecture/neuro-first-mvp-slice.md` for the narrowest credible first delivery slice and proof package
5. `docs/architecture/reasoning-agent-safety-and-validation.md` for deterministic fallback, DAG validation, reproducibility mode, and uncertainty-budget rules around adaptive planning
6. `docs/architecture/mvp-work-package-map.md` for the implementation-sized package order that turns the neuro-first target into execution work
7. `docs/open-source-target-architecture.md` for the target open-source deployment topology
8. `docs/architecture/reference-workflow-routing.md` for study classification, pipeline routing, fallback behavior, and GPU-aware execution constraints
9. `docs/architecture/reporting-and-export-contract.md` for result envelopes, derived artifacts, and DICOM SR or SEG plus FHIR export seams
10. `docs/academic/ecosystem-landscape-march-2026.md` for the March 2026 model and framework baseline
11. `docs/academic/external-evidence-register-march-2026.md` for the current official and authoritative source pack behind architectural claims
12. `docs/academic/model-licensing-and-deployment-gates.md` for the boundary between open code, model-weight terms, and deployable baseline status
13. `docs/academic/regulatory-positioning.md` for RUO-first positioning and regulatory-ready-by-design constraints
14. `docs/roadmap-and-validation.md` for phased delivery and validation expectations
