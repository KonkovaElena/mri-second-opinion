# MRI Second Opinion

Open-source, clinician-in-the-loop MRI second-opinion workflow.

## Repository Snapshot

1. scope: MRI-only workflow baseline
2. verified today: standalone TypeScript API plus restart-safe local persistence
3. not present yet: database durability, queueing, worker execution, frontend review workspace, and demo closure
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
5. internal ingest, inference callback, and delivery callback endpoints
6. restart-safe local snapshot persistence for case state, delivery state, retry history, and operation transcript
7. structured API error envelopes for invalid transport input
8. `GET /`, `GET /healthz`, `GET /readyz`, and `GET /metrics`
9. internal workflow logic is now split across orchestration, planning, and snapshot-repository seams without changing the HTTP contract

The standalone repository still does not provide:

1. PostgreSQL durable state or migrations
2. Redis-backed queue dispatch
3. object-store-backed artifact durability
4. OHIF or other frontend review surfaces
5. a real Python worker path for QC and MRI processing
6. demo closure or launch-ready evidence
7. ~~main-branch GitHub-hosted CI build and test evidence~~ (now recorded — see `docs/verification/launch-evidence-index.md`)

## Quick Start

Run the standalone subtree directly.

```bash
npm ci
npm run build
npm test
npm start
```

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
11. `docs/architecture/reporting-and-export-contract.md`
12. `docs/open-source-target-architecture.md`
13. `docs/academic/evidence-and-claims-policy.md`
14. `docs/academic/open-source-rationale.md`
15. `docs/academic/ecosystem-landscape-march-2026.md`
16. `docs/academic/external-evidence-register-march-2026.md`
17. `docs/academic/model-licensing-and-deployment-gates.md`
18. `docs/academic/regulatory-positioning.md`
19. `docs/roadmap-and-validation.md`

## Launch Readiness

The standalone repository should not be described as launch-ready from design intent alone.

Use these documents as the current release gate:

1. `docs/launch-readiness-checklist.md`
2. `docs/verification/launch-evidence-index.md`
3. `docs/demo/demo-script.md`
4. `docs/releases/v1-go-no-go.md`
5. `docs/verification/documentation-honesty-review.md`
6. `docs/verification/runtime-baseline-verification.md`
7. `docs/releases/public-github-and-mvp-path.md`
8. `docs/releases/github-publication-playbook.md`
9. `docs/releases/github-go-live-checklist.md`
10. `docs/releases/github-metadata-copy.md`
11. `docs/releases/github-settings-worksheet.md`
12. `docs/releases/github-live-publication-sequence.md`
13. `docs/releases/first-public-announcement-draft.md`
14. `docs/releases/github-operator-packet.md`
15. `docs/demo/social-preview-brief.md`
16. `docs/verification/hosted-evidence-capture-template.md`
17. `docs/verification/ai-auditor-handoff-2026-03-25.md`
18. `docs/verification/repository-audit-2026-03-25.md`

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
