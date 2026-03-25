---
title: "MRI Standalone Auditor Handoff"
status: "active"
version: "1.0.0"
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

1. a runtime-capable scaffold
2. a documentation-rich target architecture package
3. a pre-MVP repository
4. not yet a workflow-complete product

The current repository-level verdict remains:

`NOT_READY`

That verdict is correct and should be challenged only if the auditor finds evidence that workflow closure, durable state, frontend closure, demo closure, and CI-backed public publication proof are materially further along than the current docs claim.

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

`runtime scaffold with target-operating architecture, pre-MVP`

### Why this stage label fits

Because all of the following are simultaneously true:

1. the subtree has its own `package.json`, `tsconfig.json`, `.env.example`, source files, and GitHub workflow
2. the TypeScript service builds and starts
3. only scaffold-grade runtime endpoints are actually implemented in code
4. the package currently exposes only `build`, `start`, and `dev` scripts and does not expose an automated test entrypoint
5. the declared public workflow API remains design-level rather than implemented runtime behavior
6. the architecture and release docs are much more mature than the current code path

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
6. runtime command is `node dist/index.js`
7. development command is `tsx watch src/index.ts`
8. no automated test script is declared in `package.json`

Important nuance:

No `tests/` directory is currently present in the subtree and no test runner entrypoint is declared in the package manifest.

That is a material maturity signal and should not be inferred away by the strength of the surrounding documentation pack.

### 2. Implemented HTTP surface is scaffold-only

Evidence:

1. `src/app.ts`
2. `docs/verification/runtime-baseline-verification.md`

Implemented endpoints visible in code:

1. `GET /`
2. `GET /healthz`
3. `GET /readyz`
4. `GET /metrics`

Important nuance:

The root endpoint explicitly says the service is a scaffold and that workflow routes are not implemented yet.

That is a strong honesty signal.

### 3. Standalone CI workflow exists

Evidence:

1. `.github/workflows/ci.yml`

Observed facts:

1. workflow installs dependencies with `npm ci`
2. workflow runs `npm run build`
3. workflow permissions are minimal: `contents: read`

Important nuance:

The repository docs say CI presence exists, but recorded passing GitHub-hosted evidence is not yet preserved as an artifact in the docs pack.

## Design-Declared But Not Runtime-Implemented Yet

The following surfaces are real design assets, but they should not be mistaken for completed product behavior.

### 1. Public workflow API

Evidence:

1. `docs/api-scope.md`

Declared wave-1 endpoints include:

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

Current code evidence does not show these routes implemented in `src/app.ts`.

Auditor conclusion:

This API surface is currently target-state documentation, not verified runtime closure.

The present mismatch is not a partially closed workflow surface. It is a design-to-runtime gap: the documented case and review API exists in docs, while the runtime currently exposes only scaffold endpoints.

### 2. Durable workflow lifecycle

Evidence:

1. `docs/status-model.md`
2. `docs/launch-readiness-checklist.md`

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

Current runtime code does not yet expose persistence or state-transition handlers for this lifecycle.

Auditor conclusion:

The state model is a canonical design contract, not yet demonstrated as runtime truth.

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

1. real `POST /api/cases` and related workflow endpoints
2. durable persistence across restart
3. queue-backed workflow execution truth
4. operations summary path
5. review and finalize loop
6. report preview path
7. screenshot-backed UI closure
8. truthful end-to-end demo transcript

Primary evidence:

1. `docs/launch-readiness-checklist.md`
2. `docs/verification/launch-evidence-index.md`
3. `docs/demo/demo-script.md`
4. `docs/architecture/mvp-work-package-map.md`

The launch evidence ledger is explicit here:

1. API workflow verification is still `missing`
2. durable state verification is still `missing`
3. frontend verification is still `missing`
4. demo verification is still `missing`

Those missing states are the clearest operational reason the MVP cannot yet be treated as closed.

## Publication Readiness Assessment

### What is already in decent shape

1. root governance files exist
2. standalone package metadata exists
3. standalone build path exists
4. CI workflow exists
5. README is bounded and not promotional
6. public docs say the runtime is still a scaffold

### What still needs auditor attention

1. whether `private: true` should remain until the publication step
2. whether the CI workflow has current green external run evidence
3. whether any public docs still imply broader readiness than the runtime provides
4. whether any parent-repo assumptions remain embedded in subtree documentation or workflow references

## Claim Classification Matrix

| Claim | Current status | Basis |
|---|---|---|
| Standalone Node service builds | verified | `package.json`, `runtime-baseline-verification.md` |
| Standalone service starts | verified | `runtime-baseline-verification.md`, `src/index.ts` |
| `/`, `/healthz`, `/readyz` are implemented | verified | `src/app.ts` |
| `/metrics` exists as scaffold placeholder | verified | `src/app.ts` |
| automated test entrypoint exists in subtree package | refuted | `package.json` exposes only build, start, and dev scripts |
| full cases workflow API exists | not verified | design doc only in `api-scope.md` |
| durable workflow state exists | not verified | checklist and state model indicate target, not proof |
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

1. treating design-complete docs as product-complete implementation
2. missing contradictions between `api-scope.md` and current runtime code
3. assuming the existence of persistence, queue, review, or frontend closure because the docs describe them well
4. upgrading the verdict based on CI presence alone without workflow closure evidence
5. inferring clinical readiness from MRI ecosystem sophistication or architecture maturity

## Recommended Auditor Conclusion Template

If the auditor agrees with the current evidence, the shortest defensible conclusion is:

"This is a standalone MRI second-opinion repository with a verified Node/TypeScript runtime scaffold, strong target-state documentation, and a credible MVP execution map, but it is still pre-MVP and correctly classified as `NOT_READY`. The main implementation gap is not architectural thinking but workflow closure: cases API, durable state, queue-backed execution, review/finalize flow, frontend closure, and demo evidence."

## Change Rule

Update this handoff when any of the following happen:

1. verdict changes
2. cases workflow API becomes real
3. persistence and queue evidence become real
4. demo closure becomes real
5. public GitHub publication proof becomes materially stronger