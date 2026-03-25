---
title: "MRI Standalone Auditor Handoff"
status: "active"
version: "1.1.0"
last_updated: "2026-03-25"
tags: [mri, audit, verification, handoff, github, mvp]
---

# MRI Standalone Auditor Handoff

Date: 2026-03-25

## Purpose

This report is a verification handoff for an independent AI auditor.

Its job is to answer two questions precisely:

1. what this project actually is
2. what stage it is currently in

This document is intentionally evidence-oriented.

It distinguishes:

1. verified implementation
2. documented target architecture
3. planned MVP closure work
4. unsupported or still-missing surfaces

## Executive Summary

`external/mri-second-opinion` is a standalone MRI-only, clinician-in-the-loop second-opinion repository.

As of 2026-03-25, it is best classified as:

1. a local-runtime-capable workflow baseline (15 routes, 20 tests, file-based persistence)
2. a documentation-rich target architecture package
3. a pre-MVP repository
4. not yet a production-infrastructure-backed product

The current repository-level verdict remains:

`NOT_READY`

That verdict is correct and should be challenged only if the auditor finds evidence that production infrastructure closure (database, queue, worker), frontend closure, and demo closure are materially further along than the current docs claim.

## Project Identity

### What the project is

The project is intended to become:

1. an MRI-only second-opinion workflow
2. clinician-reviewed rather than autonomous
3. Orthanc plus DICOMWeb aligned at the imaging boundary
4. TypeScript control plane plus Python compute plane at the execution boundary

### What the project is not

The public docs explicitly reject these interpretations:

1. general PACS replacement
2. universal imaging platform
3. autonomous diagnostic system
4. custom viewer-engine project

Primary evidence:

1. `README.md`
2. `docs/scope-lock.md`
3. `docs/architecture/overview.md`

## Current Stage Classification

### Recommended auditor verdict

The most defensible stage label today is:

`workflow-implemented local runtime baseline with target-operating architecture, pre-MVP`

### Why this stage label fits

Because all of the following are simultaneously true:

1. the subtree has its own `package.json`, `tsconfig.json`, `.env.example`, source files, and GitHub workflow
2. the TypeScript service builds and starts
3. all 15 workflow and operations HTTP routes are implemented in code and tested
4. the package exposes `build`, `test`, `start`, and `dev` scripts
5. file-based snapshot persistence survives service restart
6. the higher readiness surfaces remain open: PostgreSQL-backed state, Redis queue execution, real inference worker, frontend closure, and demo evidence
7. the architecture and release docs are still broader than the currently implemented runtime envelope

## Verified Runtime Facts

The following are directly supported by repository code and verification docs.

### 1. Standalone Node service exists

Evidence:

1. `package.json`
2. `src/index.ts`
3. `src/app.ts`

Observed facts:

1. package name is `mri-second-opinion`
2. version is `0.1.0`
3. Node engine floor is `>=22`
4. repository is still marked `private: true`
5. build command is `tsc -p tsconfig.json`
6. test command is `node --import tsx --test tests/**/*.test.ts`
7. runtime command is `node dist/index.js`
8. development command is `tsx watch src/index.ts`

Important nuance:

The subtree includes a `tests/` directory and an automated test entrypoint, which materially strengthens the local runtime baseline compared with a pure scaffold.

It does not, by itself, prove higher readiness or GitHub-hosted main-branch CI evidence.

### 2. Implemented HTTP surface is workflow-baseline, not product-complete

Evidence:

1. `src/app.ts`
2. `docs/verification/runtime-baseline-verification.md`

Implemented endpoints visible in code:

1. `GET /`
2. `GET /healthz`
3. `GET /readyz`
4. `GET /metrics`
5. `POST /api/cases`
6. `GET /api/cases`
7. `GET /api/cases/:caseId`
8. `POST /api/cases/:caseId/review`
9. `POST /api/cases/:caseId/finalize`
10. `GET /api/cases/:caseId/report`
11. `GET /api/operations/summary`
12. `POST /api/delivery/:caseId/retry`
13. `POST /api/internal/ingest`
14. `POST /api/internal/inference-callback`
15. `POST /api/internal/delivery-callback`

Important nuance:

The root endpoint still identifies the service as a `wave1-api` baseline.

That is a strong honesty signal, but it no longer means that workflow routes are absent.

### 3. Standalone CI workflow exists

Evidence:

1. `.github/workflows/ci.yml`

Observed facts:

1. workflow installs dependencies with `npm ci`
2. workflow runs `npm run build`
3. workflow permissions are minimal: `contents: read`

Important nuance:

The repository now has recorded passing GitHub-hosted evidence for both workflows:

- `ci` green on `177094a`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374310`
- `docs-governance` green on `177094a`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374341`

## Design-Declared Surfaces: Local Runtime vs Production Infrastructure

The following surfaces have design documentation that goes beyond the current runtime implementation. Items 1 and 2 are now partially implemented at the local level; item 3 remains target architecture only.

### 1. Public workflow API — local runtime vs production infrastructure

Evidence:

1. `docs/api-scope.md`
2. `src/app.ts` (15 routes implemented)
3. `tests/workflow-api.test.ts` (14 tests covering the full lifecycle)

Declared wave-1 endpoints:

1. `POST /api/cases`
2. `GET /api/cases`
3. `GET /api/cases/:caseId`
4. `POST /api/cases/:caseId/review`
5. `POST /api/cases/:caseId/finalize`
6. `GET /api/cases/:caseId/report`
7. `GET /api/operations/summary`
8. `POST /api/delivery/:caseId/retry`
9. `POST /api/internal/ingest`
10. `POST /api/internal/inference-callback`

All of these routes are now implemented in `src/app.ts` and exercised by `tests/workflow-api.test.ts`.

They operate against an in-memory case service (`MemoryCaseService`) with optional file-based snapshot persistence. Inference and delivery callbacks are handled via internal HTTP endpoints rather than a real Python worker or queue.

Auditor conclusion:

The API surface is runtime-implemented at the local level. The remaining gap is between this local-runtime implementation and a production-grade stack backed by PostgreSQL, Redis queues, and a real inference worker.

### 2. Durable workflow lifecycle — file-based vs database-backed

Evidence:

1. `docs/status-model.md`
2. `docs/launch-readiness-checklist.md`
3. `src/case-storage.ts` (file-based snapshot persistence)
4. `tests/workflow-api.test.ts` ("case records survive app restart" test at line 226)
5. `tests/memory-case-service.test.ts` (6 tests including stale-writer rejection and restart survival)

Declared state vocabulary includes:

1. `INGESTING`
2. `QC_REJECTED`
3. `SUBMITTED`
4. `AWAITING_REVIEW`
5. `REVIEWED`
6. `FINALIZED`
7. `DELIVERY_PENDING`
8. `DELIVERED`
9. `DELIVERY_FAILED`

The state vocabulary is used in runtime code. State transitions are enforced by `MemoryCaseService`. File-based snapshot persistence is implemented and tested: cases survive service restart when a snapshot file is configured.

Auditor conclusion:

The state model is demonstrated as local-runtime truth with file-based persistence. The gap is between file-based snapshots and PostgreSQL-backed durable state with queue-driven execution.

### 3. Seven-node deployment baseline

Evidence:

1. `README.md`
2. `docs/architecture/overview.md`
3. `docs/open-source-target-architecture.md`

Declared intended stack includes:

1. TypeScript workflow core
2. PostgreSQL
3. Redis queue
4. MinIO-compatible object storage
5. Orthanc
6. Python inference worker
7. OHIF-backed review UI

Current subtree code contains only the TypeScript runtime scaffold.

Auditor conclusion:

The seven-node shape is target-operating architecture, not current implementation completeness.

## Documentation Maturity Assessment

The documentation package is more mature than the runtime.

That is not inherently bad, but it changes how the auditor should read the repository.

### Documentation strengths

1. scope is bounded and explicit
2. non-goals are explicit
3. clinician review remains explicit
4. claim discipline is visible
5. launch evidence and verdict logic are already modeled
6. orchestrator, contract, safety, licensing, and MVP docs are now separated rather than collapsed into one narrative

### Documentation risk

The main risk is not hype inside current docs.

The main risk is that an inattentive reader could mistake the completeness of the docs package for completeness of the product.

The repository mitigates that risk reasonably well through:

1. `NOT_READY` verdict language
2. runtime-baseline-verification note
3. documentation-honesty review
4. launch-readiness checklist
5. explicit MVP work-package map

## Current Release Posture

### Product verdict

Current product verdict:

`NOT_READY`

Primary evidence:

1. `docs/releases/v1-go-no-go.md`
2. `docs/launch-readiness-checklist.md`
3. `docs/verification/launch-evidence-index.md`

### Public GitHub vs MVP nuance

The docs now separate:

1. safe public GitHub publication work
2. internal MVP workflow closure

That distinction is useful, but the auditor should read it carefully.

A repository can be safe to publish publicly while still being far from workflow-complete.

The formal repository verdict `PUBLIC_GITHUB_READY` remains stricter and is still governed by `v1-go-no-go.md` plus the full launch checklist.

Primary evidence:

1. `docs/releases/public-github-and-mvp-path.md`
2. `docs/architecture/mvp-work-package-map.md`

## MVP Stage Assessment

### Current MVP status

The repository is not yet at MVP closure.

The strongest accurate status is:

`MVP architecture and execution map exist, MVP runtime slice not yet closed`

### Why MVP is not closed yet

The following evidence remains missing or only partial:

1. queue-backed workflow execution (Redis/real worker)
2. database-backed persistence (PostgreSQL instead of file snapshots)
3. screenshot-backed UI closure
4. truthful end-to-end demo transcript

The following items are now implemented at the local-runtime level:

1. `POST /api/cases` and all 14 other workflow endpoints (in-memory + file snapshot)
2. durable persistence across restart (file-based snapshot, tested)
3. operations summary path (`GET /api/operations/summary`)
4. review and finalize loop (`POST .../review`, `POST .../finalize`)
5. report preview path (`GET .../report`)

Primary evidence:

1. `docs/launch-readiness-checklist.md`
2. `docs/verification/launch-evidence-index.md`
3. `docs/demo/demo-script.md`
4. `docs/architecture/mvp-work-package-map.md`

The launch evidence ledger is explicit here:

1. API workflow verification is `partial` (routes and tests exist; production infrastructure not yet wired)
2. durable state verification is `partial` (file-based snapshot tested; database migration not yet run)
3. frontend verification is still `missing`
4. demo verification is still `missing`

Those partial and missing states are the clearest operational reason the MVP cannot yet be treated as closed.

## Publication Readiness Assessment

### What is already in decent shape

1. root governance files exist
2. standalone package metadata exists
3. standalone build path exists
4. CI workflow exists with hosted green evidence on main branch
5. automated tests exist and run under CI
6. README is bounded and not promotional
7. public docs correctly distinguish local runtime from production readiness

### What still needs auditor attention

1. whether `private: true` should remain (it prevents accidental npm publish but the repo is already public on GitHub)
2. whether any public docs still imply broader readiness than the local runtime provides
3. whether any parent-repo assumptions remain embedded in subtree documentation or workflow references

## Claim Classification Matrix

| Claim | Current status | Basis |
|---|---|---|
| Standalone Node service builds | verified | `package.json`, `runtime-baseline-verification.md` |
| Standalone service starts | verified | `runtime-baseline-verification.md`, `src/index.ts` |
| `/`, `/healthz`, `/readyz` are implemented | verified | `src/app.ts` |
| `/metrics` exists as scaffold placeholder | verified | `src/app.ts` |
| automated test entrypoint exists in subtree package | verified | `package.json` exposes `test` script: `node --import tsx --test tests/**/*.test.ts` |
| full cases workflow API exists | verified as local runtime | all 15 routes implemented in `src/app.ts`, exercised by `tests/workflow-api.test.ts` |
| durable workflow state exists | verified as file-based | `MemoryCaseService` + `case-storage.ts` with file snapshot persistence tested in `workflow-api.test.ts` |
| seven-node product runtime exists | not verified | architecture target only |
| orchestrator contract set is well-defined | verified as documentation | contract docs exist, runtime implementation not proven |
| neuro-first MVP path is defined | verified as documentation | MVP docs exist |
| product is ready for public launch claims | refuted | `v1-go-no-go.md` says `NOT_READY` |
| repository may be safely published on GitHub before full MVP closure work ends | supported as governance path | `public-github-and-mvp-path.md` |

## Auditor Re-Check Protocol

The auditor should verify in this order.

### Pass 1. Identity and honesty

Read:

1. `README.md`
2. `docs/scope-lock.md`
3. `docs/releases/v1-go-no-go.md`
4. `docs/verification/documentation-honesty-review.md`

Questions:

1. does the README overstate runtime completeness?
2. do non-goals remain explicit?
3. does any active doc contradict the `NOT_READY` verdict?

### Pass 2. Actual code state

Read:

1. `package.json`
2. `src/app.ts`
3. `src/index.ts`
4. `.github/workflows/ci.yml`

Questions:

1. what endpoints actually exist now?
2. is the subtree independently buildable?
3. does CI validate only what is really implemented?

### Pass 3. Workflow gap audit

Read:

1. `docs/api-scope.md`
2. `docs/status-model.md`
3. `docs/launch-readiness-checklist.md`
4. `docs/verification/launch-evidence-index.md`

Questions:

1. which declared API surfaces are still design-only?
2. which workflow states are not yet backed by runtime evidence?
3. does the evidence index correctly mark missing areas as missing?

### Pass 4. Architecture maturity audit

Read:

1. `docs/architecture/overview.md`
2. `docs/architecture/orchestrator-control-plane.md`
3. `docs/architecture/orchestrator-reference-contracts.md`
4. `docs/architecture/reasoning-agent-safety-and-validation.md`
5. `docs/architecture/neuro-first-mvp-slice.md`
6. `docs/architecture/mvp-work-package-map.md`

Questions:

1. is target architecture clearly separated from implementation truth?
2. are orchestrator and planner claims properly bounded?
3. does the MVP work-package map align with the launch checklist?

### Pass 5. Publication and MVP sequencing audit

Read:

1. `docs/releases/public-github-and-mvp-path.md`
2. `docs/verification/public-repository-hygiene-review.md`
3. `docs/demo/demo-script.md`

Questions:

1. is GitHub publication path separated cleanly from MVP completion?
2. is the demo still correctly described as draft rather than completed truth?
3. are evidence requirements still stronger than design claims?

## Auditor Watchouts

The most important failure modes to catch are:

1. treating design-complete docs as production-complete implementation
2. mistaking local in-memory runtime for production-infrastructure readiness
3. assuming PostgreSQL, Redis queue, real inference worker, or frontend exist because the docs describe them well
4. upgrading the verdict based on CI presence alone without production infrastructure evidence
5. inferring clinical readiness from MRI ecosystem sophistication or architecture maturity

## Recommended Auditor Conclusion Template

If the auditor agrees with the current evidence, the shortest defensible conclusion is:

"This is a standalone MRI second-opinion repository with a verified Node/TypeScript local runtime, strong target-state documentation, and a credible MVP execution map. It is still pre-MVP and correctly classified as `NOT_READY`. The workflow API surface and file-based persistence are implemented and tested at the local level. The main implementation gap is the transition from local runtime to production infrastructure: PostgreSQL-backed persistence, Redis queue execution, real inference worker, frontend closure, and demo evidence."

## Change Rule

Update this handoff when any of the following happen:

1. verdict changes
2. production infrastructure replaces local runtime (PostgreSQL, Redis, real worker)
3. demo closure becomes real
4. frontend closure becomes real
5. public GitHub publication proof becomes materially stronger