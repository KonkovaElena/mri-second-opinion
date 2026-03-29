# MRI Second Opinion

Clinician-in-the-loop MRI second-opinion workflow baseline with a standalone TypeScript API and restart-safe local persistence.

Current repository verdict: `PUBLIC_GITHUB_READY`

This repository is ready for conservative public GitHub publication and external review, but it is not a launch-ready clinical product.

It must not be used for clinical decision-making or patient-care deployment.

## Quick Status Links

Use these entrypoints before reading deeper evidence packs.

1. verdict authority: `docs/releases/v1-go-no-go.md`
2. launch gates: `docs/launch-readiness-checklist.md`
3. evidence ledger: `docs/verification/launch-evidence-index.md`
4. publication vs MVP routing: `docs/releases/public-github-and-mvp-path.md`
5. current wave sequencing: `docs/roadmap-and-validation.md`
6. retrospective lessons: `docs/verification/publication-retrospective-audit-2026-03-27.md`

## Phase 1 Governance Pack

These documents harden the RUO baseline without pretending the repository is already clinically or regulatorily complete.

1. software supply-chain baseline: `docs/security/sbom-policy.md`
2. current threat model: `docs/security/threat-model.md`
3. bias-analysis contract: `docs/academic/bias-analysis-framework.md`
4. future post-market surveillance transition plan: `docs/regulatory/pms-plan.md`

## Why This Project Exists

Many MRI AI projects sit in one of three uncomfortable extremes:

1. a research pipeline with weak workflow and audit boundaries
2. a large imaging platform that is too heavy for a narrow second-opinion product
3. a model demo that hides uncertainty, review gates, and operational state behind one opaque "AI" surface

MRI Second Opinion takes a different path.

It focuses on the workflow layer around MRI review:

1. intake and eligibility checks
2. draft generation and machine-output capture
3. mandatory clinician review
4. explicit finalization
5. delivery and retry visibility

The core idea is simple: keep the control plane transparent, keep clinical review mandatory, and keep claims narrower than the evidence.

## Governing Thesis

The governing thesis of this repository is that an MRI second-opinion product should be built as a transparent workflow system before it is described as an AI product.

In practical terms, that means:

1. workflow truth, review gates, and provenance matter as much as model output
2. MRI should be treated as a family of sequence-dependent workflows, not as one generic input class
3. specialist quantitative pipelines and broader screening models should remain explicit capability families rather than one undifferentiated engine
4. the repository must distinguish implemented behavior from target architecture and from research-informed rationale at all times

## At A Glance

| Dimension | Current repository truth |
|---|---|
| Scope | MRI-only workflow baseline |
| Runtime | Standalone Node.js and TypeScript API |
| Persistence | Restart-safe local persistence with SQLite as the default path and a locally verified PostgreSQL service path |
| Human review | Explicit and mandatory in the workflow model |
| Public verdict | `PUBLIC_GITHUB_READY` |
| Intended posture | Open-source, research-use-oriented, clinician-in-the-loop |

## Claim Boundary

| Claim type | Meaning in this repository | Example |
|---|---|---|
| Implemented | Backed by current runtime or verification evidence | standalone API, route surface, restart-safe local persistence |
| Target architecture | Intended next runtime shape, not yet implemented truth | managed PostgreSQL operations, distributed queue and object storage, Orthanc, Python worker, OHIF UI |
| Research-informed | Supported by external evidence, but not promoted to runtime truth here | DICOMweb boundary, BIDS reproducibility seam, MRI-native Python tooling |
| Excluded | Claims the repository must not make | autonomous diagnosis, clinical validation, launch-ready deployment |

## What This Repository Is

1. a focused MRI-only second-opinion workflow project
2. a transparent orchestration baseline rather than a model showcase
3. a standalone API that already exposes a real case lifecycle
4. a conservative public repository with explicit evidence and readiness rails

## What This Repository Is Not

1. a general PACS
2. a universal medical-imaging platform
3. an autonomous diagnostic system
4. a custom viewer engine
5. a production-ready clinical deployment
6. a proof that any specific MRI model family is clinically validated

## Design Principles

1. clinician review stays mandatory
2. MRI remains sequence-aware and workflow-aware, not one undifferentiated input type
3. the orchestration layer is separate from the heavy imaging compute layer
4. DICOM stays the imaging interoperability boundary
5. public claims must follow implemented evidence, not architectural ambition

## Current Runtime vs Target Runtime

| Layer | Implemented now | Target direction |
|---|---|---|
| Control plane | standalone TypeScript API | typed workflow core with stronger orchestration seams |
| Workflow durability | SQLite-backed default store plus a locally verified PostgreSQL path | release-linked PostgreSQL operations and broader durable workflow truth |
| Async execution | local durable inference and delivery queues, bounded dispatch leases, and persisted execution-contract truth on case detail and report surfaces | broader queue-backed execution and retry dispatch |
| Imaging boundary | documented only | Orthanc plus DICOMWeb |
| Compute plane | callback contract only | Python MRI QC and inference workers |
| Review surface | built-in synthetic-demo workbench on top of the current API | OHIF-backed clinician review workspace |
| Artifact layer | typed derived descriptors with archive-link metadata plus package-provenance artifact manifests | object-store-backed derived artifacts and export payloads |

## What Works Today

The current verified baseline is a first verified local workflow API baseline.

Implemented and verified in this repository today:

1. standalone `npm ci`, `npm run build`, and `npm test`
2. service startup from built output
3. public workflow endpoints for case create, case list, case detail, review, finalize, report retrieval, artifact retrieval, delivery retry, and operations summary
4. internal ingest, inference queue, delivery queue, inference callback, and delivery callback endpoints
5. locked workflow-state vocabulary for the current MRI review path
6. restart-safe local persistence for case state, explicit inference and delivery jobs, delivery state, retry history, and operation transcript on the default SQLite path, plus a locally verified PostgreSQL service path
7. structured JSON error envelopes for malformed or invalid input
8. baseline operational routes: `GET /`, `GET /healthz`, `GET /readyz`, and a real Prometheus-compatible `GET /metrics`
9. report payloads that preserve legacy artifact refs alongside typed derived artifact descriptors with conservative viewer-ready semantics
10. built-in `GET /workbench` review surface for queue visibility, case detail, review, finalize, report preview, operations summary, and delivery retry over the live API
11. explicit worker-facing delivery queue claim path backed by durable records and restart survival proof
12. explicit worker-facing inference queue list, claim, expired-claim requeue, dispatch claim, and dispatch heartbeat paths backed by durable records and restart survival proof
13. HMAC-signed protection for `/api/internal/dispatch/*` when `MRI_INTERNAL_HMAC_SECRET` is configured, layered on top of namespace bearer-token protection
14. persisted workflow package manifest, structural execution envelope, package-provenance artifact manifest surfaces, and public artifact retrieval URLs backed by local file persistence on case detail and report responses
15. internal separation between orchestration, planning, and snapshot-repository seams while preserving the HTTP contract
16. Wave 1 public-edge hardening with request-size limits, public API rate limiting, Node HTTP timeout guards, and graceful shutdown hooks
17. root container packaging plus a compose app-service bring-up path for the current standalone runtime baseline

## What Does Not Exist Yet

The repository still does not provide these as implemented runtime truth:

1. release-linked or hosted PostgreSQL operational evidence beyond the current local bootstrap and service proofs
2. distributed or production-grade queue-backed execution infrastructure beyond the local SQLite-backed delivery and inference queue baselines
3. object-store-backed artifact durability
4. a real Python worker path for MRI QC and inference
5. an OHIF-backed review workspace or production-grade imaging viewer frontend
6. hosted or release-linked demo closure for the full intended product path
7. evidence for launch-ready clinical or operational maturity

## Current Workflow Model

The canonical workflow states are:

1. `INGESTING`
2. `QC_REJECTED`
3. `SUBMITTED`
4. `AWAITING_REVIEW`
5. `REVIEWED`
6. `FINALIZED`
7. `DELIVERY_PENDING`
8. `DELIVERED`
9. `DELIVERY_FAILED`

Two constraints matter for understanding the project:

1. human review is mandatory before finalization
2. no workflow state implies autonomous diagnosis

See `docs/status-model.md` for the locked state machine.

See `docs/scope-inventory.md` for the exact active repository surface.

See `docs/public-vocabulary.md` for the frozen public terms used in runtime and docs.

See `docs/academic/formal-system-analysis.md` for the EFSM, protocol, and property-level reading of the current standalone runtime and its remaining seams.

## API Surface Implemented Today

### Public API

1. `POST /api/cases`
2. `GET /api/cases`
3. `GET /api/cases/:caseId`
4. `POST /api/cases/:caseId/review`
5. `POST /api/cases/:caseId/finalize`
6. `GET /api/cases/:caseId/report`
7. `GET /api/operations/summary`
8. `POST /api/delivery/:caseId/retry`

### Built-in operator surface

1. `GET /workbench`

### Internal integration endpoints

1. `POST /api/internal/ingest`
3. `GET /api/internal/inference-jobs`
4. `POST /api/internal/inference-jobs/claim-next`
5. `POST /api/internal/inference-jobs/requeue-expired`
6. `POST /api/internal/inference-callback`
7. `GET /api/internal/delivery-jobs`
8. `POST /api/internal/delivery-jobs/claim-next`
9. `POST /api/internal/delivery-callback`

### Internal route auth

If `MRI_INTERNAL_API_TOKEN` is set, every `api/internal/*` route requires `Authorization: Bearer <token>`.

This is the current namespace-level protection seam for worker-facing HTTP routes.

If `MRI_INTERNAL_HMAC_SECRET` is set, `/api/internal/dispatch/*` additionally requires `X-MRI-Timestamp`, `X-MRI-Nonce`, and `X-MRI-Signature` headers.

That HMAC layer is currently scoped to the bounded dispatch claim and heartbeat seam rather than to the entire internal namespace.

The root route also exposes the live route inventory and points readers to scope, launch-readiness, and verdict docs.

See `docs/api-scope.md` for the canonical boundary rules.

## Quick Start

Run the standalone subtree directly:

Prerequisite: `Node >=22`

```bash
npm ci
npm run build
npm test
npm start
```

Container bring-up for the same standalone runtime baseline:

```bash
docker compose up --build app
```

This path keeps the verified standalone API shape intact and persists the default case store in the named volume mounted at `/data` inside the container.

It intentionally defaults to the current local-development runtime posture rather than pretending this repository already proves a hardened production deployment path.

`docker compose up --build` also starts the adjacent `postgres` and `redis` services that remain available for future persistence and queue seams, but the current app-service baseline does not require them.

Minimum runtime expectation after startup:

1. `GET /` returns the repository identity, route map, and doc pointers
2. `GET /healthz` returns `ok`
3. `GET /readyz` returns `ready`
4. `GET /metrics` returns Prometheus exposition data for runtime and request metrics
5. `GET /workbench` returns the built-in MRI Review Workbench shell

This quick start proves the local workflow API baseline only.

The compose app-service path is part of the same baseline and adds portable packaging proof, not a new product claim.

It does not prove:

1. a hosted deployment path
2. a production-grade frontend review product
3. a release-linked or managed PostgreSQL deployment path
4. a full production observability stack with dashboards, alert routing, and hosted scrape topology
5. clinical readiness

Any public demo or screenshot path should be treated as synthetic-only until the repository proves otherwise.

## Research-Informed Direction

The target architecture is deliberately broader than the current runtime, but it is still narrow by product scope.

Target runtime direction:

1. TypeScript workflow core
2. managed PostgreSQL durable state as the primary deployment path
3. Redis-backed workflow queue
4. object storage for derived artifacts and report payloads
5. Orthanc for DICOM ingress and DICOMWeb serving
6. Python worker for QC and MRI-native compute pipelines
7. OHIF-backed clinician review UI

This target stack is not presented as already implemented.

It is presented as the most defensible open-source direction given the March 2026 ecosystem and the repository's stated boundaries.

## Methodological Stance

This repository follows an evidence-first engineering posture.

That means:

1. readiness claims are subordinated to runtime and verification evidence
2. architecture documents explain intended direction, but do not upgrade verdicts on their own
3. external literature and ecosystem practice can justify design choices, but not product-maturity claims
4. regulatory and licensing constraints are treated as design inputs, not as post-hoc documentation work
5. the default external posture remains research-use-oriented and clinician-in-the-loop until stronger evidence exists

## Why The Architecture Is Defensible

The current academic and ecosystem position behind this repository is:

1. DICOM and DICOMweb remain the correct imaging interoperability boundary
2. MRI compute ecosystems are strongest in Python-native tooling rather than in TypeScript-only inference stacks
3. clinician review should remain explicit even when AI draft generation exists
4. MRI workflows are sequence-sensitive and failure-sensitive, so routing and QC cannot be collapsed into one generic model claim
5. BIDS-like organization remains useful as a reproducibility scaffold even when the clinical ingress boundary stays DICOM-native

Concrete external reference points currently used in the repository's evidence pack include:

1. FDA AI-enabled medical-device transparency surfaces and lifecycle framing
2. the DICOMweb standard pages for QIDO-RS, WADO-RS, and STOW-RS
3. OHIF v3.12 release notes for clinician-review and segmentation workflow capability
4. Orthanc Team deployment guidance for the DICOM boundary
5. Prefect v3 documentation as an event-driven orchestration reference
6. FastSurfer as an MRI-native quantitative pipeline reference with explicit research-use boundaries
7. BIDS as a standardized reproducibility and validation scaffold

The canonical source pack is `docs/academic/external-evidence-register-march-2026.md`.

## Repository Map

If you are new to the project, start here:

1. `docs/scope-lock.md` for scope and non-goals
2. `docs/status-model.md` for workflow states
3. `docs/api-scope.md` for public and internal API boundaries
4. `docs/architecture/overview.md` for the target operating model
5. `docs/verification/runtime-baseline-verification.md` for what is actually verified today
6. `docs/launch-readiness-checklist.md` for the release gate
7. `docs/releases/v1-go-no-go.md` for the formal verdict

For deeper architecture and evidence work:

1. `docs/open-source-target-architecture.md`
2. `docs/roadmap-and-validation.md`
3. `docs/academic/evidence-and-claims-policy.md`
4. `docs/academic/open-source-rationale.md`
5. `docs/academic/ecosystem-landscape-march-2026.md`
6. `docs/academic/model-licensing-and-deployment-gates.md`
7. `docs/academic/regulatory-positioning.md`

## Evidence And Readiness

This repository uses explicit claim discipline.

Every strong statement should be understood as one of four things:

1. implemented claim
2. design claim
3. research-informed claim
4. excluded claim

That distinction exists to prevent three common failures:

1. presenting architecture as if it were runtime proof
2. presenting academic familiarity as if it were product validation
3. presenting demo capability as if it were deployment readiness

Use these files as the current source of truth for readiness:

1. `docs/launch-readiness-checklist.md`
2. `docs/releases/v1-go-no-go.md`
3. `docs/verification/runtime-baseline-verification.md`
4. `docs/verification/launch-evidence-index.md`
5. `docs/academic/evidence-and-claims-policy.md`

If you are preparing or auditing a public GitHub release, use this packet:

1. `docs/releases/github-publication-playbook.md`
2. `docs/releases/github-go-live-checklist.md`
3. `docs/releases/github-metadata-copy.md`
4. `docs/releases/github-settings-worksheet.md`
5. `docs/releases/github-live-publication-sequence.md`
6. `docs/releases/first-public-announcement-draft.md`
7. `docs/releases/github-operator-packet.md`
8. `docs/demo/demo-script.md`
9. `docs/demo/social-preview-brief.md`
10. `docs/verification/hosted-evidence-capture-template.md`

## Community And Safety Surfaces

When contributing or evaluating repository hygiene, use:

1. `CONTRIBUTING.md`
2. `SECURITY.md`
3. `CODE_OF_CONDUCT.md`
4. `SUPPORT.md`
5. `GOVERNANCE.md`
6. `.github/ISSUE_TEMPLATE/bug-report.yml`
7. `.github/ISSUE_TEMPLATE/feature-request.yml`
8. `.github/ISSUE_TEMPLATE/docs-scope.yml`
9. `.github/PULL_REQUEST_TEMPLATE.md`
10. `.github/dependabot.yml`

## Bottom Line

MRI Second Opinion is best understood today as a truthful, technically real, MRI-only workflow baseline.

It already has a runnable API and durable local workflow state.

It does not yet have the database, queue, worker, viewer, or evidence package required for a higher readiness verdict.

That gap is intentional, visible, and documented.
