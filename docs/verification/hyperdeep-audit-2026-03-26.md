# MRI Standalone Hyperdeep Audit

Date: 2026-03-26

## Purpose

This note records a deeper implementation and architecture audit of the MRI standalone subtree.

It is an evidence document.

It distinguishes:

1. what is implemented now
2. what is documented as target architecture
3. what external ecosystem evidence implies about the next defensible delivery waves

## Scope

This audit covers:

1. standalone runtime code under `src/`
2. standalone tests under `tests/`
3. active architecture, academic, verification, and release docs under `docs/`
4. selected official external sources for interoperability, review UI, orchestration, and platform analogs

## Evidence Base

Primary local evidence used in this audit:

1. `README.md`
2. `src/app.ts`
3. `src/cases.ts`
4. `src/case-planning.ts`
5. `src/case-repository.ts`
6. `src/postgres-case-repository.ts`
7. `src/db-migrations.ts`
8. `src/config.ts`
9. `src/index.ts`
10. `tests/workflow-api.test.ts`
11. `tests/postgres-integration.test.ts`
12. `docs/architecture/overview.md`
13. `docs/architecture/orchestrator-control-plane.md`
14. `docs/architecture/orchestrator-reference-contracts.md`
15. `docs/architecture/reference-workflow-routing.md`
16. `docs/architecture/reasoning-agent-safety-and-validation.md`
17. `docs/architecture/mvp-work-package-map.md`
18. `docs/academic/evidence-and-claims-policy.md`
19. `docs/academic/model-licensing-and-deployment-gates.md`
20. `docs/academic/regulatory-positioning.md`
21. `docs/verification/runtime-baseline-verification.md`
22. `docs/verification/launch-evidence-index.md`
23. `docs/verification/operator-surface-verification.md`
24. `docs/verification/architecture-and-publication-audit-2026-03-25.md`
25. `docs/releases/v1-go-no-go.md`

Selected external evidence used in this audit:

1. Orthanc Team Docker documentation
2. OHIF Viewer 3.12 release notes
3. Prefect 3 documentation
4. Apache Airflow 3.1 documentation
5. Kaapana release notes through `0.6.1`
6. XNAT public platform overview
7. MONAI `1.5.2` release surface
8. nnU-Net `v2.6.4` release surface

## Executive Verdict

The subtree remains correctly labeled `NOT_READY`.

That verdict is still conservative and correct.

The key reason is no longer basic repository immaturity.

The key reason is that the repository already has a truthful workflow-capable control-plane baseline, but it still lacks the execution boundary, artifact boundary, and release evidence boundary required to support stronger claims.

## What Is Implemented Now

The following claims are directly supported by code and tests.

### 1. Real workflow-capable control plane exists

The runtime exposes:

1. public case creation
2. case list and detail reads
3. clinician review
4. finalize
5. report preview
6. delivery retry
7. internal ingest callback
8. internal inference callback
9. internal delivery callback
10. operations summary

This is not documentation-only scaffolding.

### 2. Durable case truth exists in two modes

The subtree supports:

1. snapshot-backed local durability
2. PostgreSQL-backed repository persistence

The tests and verification notes already support restart survival for the current bounded data model.

### 3. Queue and operations state are first-class

Queue state is not inferred only from status names.

The current implementation persists queue entries and operation transcripts per case and rebuilds an operations summary read model from durable records.

### 4. Orchestrator contracts are partially materialized in runtime

The runtime already persists simplified forms of:

1. plan envelope
2. evidence cards
3. policy gate record
4. downgrade state
5. structural run provenance

This is important because the architecture docs are not entirely detached from runtime truth.

### 5. Equivalent operator UI exists

`GET /operator` is a real HTML review surface wired to live endpoints.

It is minimal, but it is not fake.

## Findings

Findings are ordered by severity and by how strongly they block the next maturity step.

### Critical 1. Worker execution is still simulated inside the control plane

The current runtime accepts inference callbacks and constructs `report`, `workerArtifacts`, and `structuralRun` state inside the same service process.

That means the subtree does not yet prove:

1. a separate worker boundary
2. a package registry driving execution
3. a durable job envelope crossing process boundaries
4. replayable worker-side provenance independent of API-side synthesis

Impact:

The repository proves workflow state management, not a real processing plane.

This is the main blocker for any claim stronger than a local control-plane baseline.

Evidence:

1. `src/cases.ts`
2. `src/case-planning.ts`
3. `docs/verification/runtime-baseline-verification.md`

### Critical 2. Internal callbacks are not trust-separated from the public HTTP surface

The app exposes internal ingest, inference, and delivery callback routes directly in the same Express process with no authentication or policy layer.

For a local engineering baseline this is understandable.

For a stronger internal-demo or deployable posture, it is a real gap.

Impact:

The system does not yet prove that only an approved worker or integration boundary can mutate execution state.

Evidence:

1. `src/app.ts`
2. `src/index.ts`

### High 3. Artifact provenance is typed, but not storage-backed

The current `structuralRun` and artifact references are durable strings, and artifact type is inferred from reference naming patterns.

There is still no durable object-store manifest, checksum layer, artifact availability probe, or retrieval contract.

Impact:

The subtree can describe artifacts, but it cannot yet prove artifact custody, integrity, or export-readiness beyond string references.

Evidence:

1. `src/cases.ts`
2. `src/case-planning.ts`
3. `docs/architecture/orchestrator-reference-contracts.md`

### High 4. Routing and package selection are still single-family and hardcoded

The target docs describe multiple workflow families, package manifests, fallback DAGs, and a policy-bounded planner.

The current code path is still effectively fixed to one neuro structural family with a single selected package posture.

Impact:

The plan-envelope shape exists, but the runtime does not yet prove registry-driven package resolution or multi-family eligibility logic.

Evidence:

1. `src/cases.ts`
2. `src/case-planning.ts`
3. `docs/architecture/reference-workflow-routing.md`
4. `docs/architecture/orchestrator-control-plane.md`

### Medium 5. Operator surface exists, but frontend closure is still incomplete

The subtree now has a truthful equivalent operator surface.

It still does not prove:

1. screenshot-backed review UX closure
2. a separate frontend build or deployment path
3. demo-grade polish
4. artifact-rendering UX beyond raw JSON or minimal HTML interaction

Impact:

This blocks higher readiness verdicts tied to demo credibility and frontend closure.

Evidence:

1. `src/app.ts`
2. `tests/workflow-api.test.ts`
3. `docs/verification/operator-surface-verification.md`

### Medium 6. PostgreSQL support is meaningful, but not yet operationally closed

The subtree already has:

1. SQL migrations
2. local migration smoke
3. restart-survival integration tests
4. optional Postgres runtime mode

It still lacks stronger proof around:

1. hosted execution evidence for the Postgres path
2. connection hardening and retry policy
3. backup or recovery expectations
4. migration rollback or failure-recovery posture

Impact:

This is not a design gap so much as an evidence and operations gap.

Evidence:

1. `src/db-migrations.ts`
2. `src/postgres-case-repository.ts`
3. `tests/postgres-integration.test.ts`
4. `docs/verification/runtime-baseline-verification.md`

## Architecture Truth Assessment

The architecture docs are ahead of runtime, but not dishonestly ahead.

That distinction matters.

### Honest architectural claims already supported

1. control-plane-first baseline
2. clinician-in-the-loop posture
3. plan-envelope and evidence-card direction
4. durable case lifecycle
5. queue-backed execution state as a first-class concern

### Architectural claims that remain target-state only

1. real workflow-package registry
2. event-driven planner with deterministic validator
3. separate worker plane
4. object-store-backed artifact truth
5. Orthanc-backed intake boundary
6. OHIF-backed review layer
7. multi-family routing beyond the neuro structural baseline

## External Evidence Synthesis

The external sources materially support the subtree's current target direction.

### Orthanc implication

Orthanc remains the most practical open DICOM boundary for this product class.

The current official Docker guidance confirms:

1. environment-variable-driven configuration
2. DICOMWeb and PostgreSQL plugin enablement
3. healthcheck support
4. modern image naming under `orthancteam/orthanc`

Engineering implication:

The next real interoperability wave should treat Orthanc as the intake and DICOMWeb boundary rather than keeping ingest fully abstract.

### OHIF implication

OHIF 3.12 confirms that modern open review UIs now support richer segmentation and contour editing, unified segmentation panels, and governance maturity.

Engineering implication:

The subtree should not overinvest in bespoke long-term review UI primitives inside server-rendered HTML. The current equivalent surface is enough for truthfulness, but not the likely endpoint.

### Prefect vs Airflow implication

Prefect documents an event-driven, human-intervention-aware, Pythonic orchestration model.

Airflow explicitly positions itself for batch-oriented workflows and explicitly says it is not intended for continuously running or event-driven workloads.

Engineering implication:

For case-driven MRI orchestration, Prefect remains the better external reference than Airflow if the project wants a real workflow engine. Airflow remains an operational batch reference, not the best primary control-plane analog for this product.

### Kaapana and XNAT implication

Kaapana and XNAT confirm that mature imaging platforms require explicit separation of:

1. data ingress and storage
2. workflow execution
3. artifact handling
4. role and access boundaries
5. review or analysis surfaces

Engineering implication:

The subtree should not pretend it is already an imaging platform. It should keep speaking honestly as a bounded control-plane baseline while progressively adding the missing execution and evidence boundaries.

### MONAI and nnU-Net implication

The current active release surfaces confirm that the specialist MRI ecosystem is still alive and versioned, which supports the subtree's package-oriented design direction.

Engineering implication:

The next wave should prefer explicit workflow-package manifests and versioned provenance rather than hiding model identity behind generic callback text.

## Next Waves

The next defensible waves should be implementation waves, not more architecture prose.

### Wave 2. Execution Boundary And Trust Separation

Goal:

Turn the current callback-shaped worker simulation into a real execution boundary.

Priority outputs:

1. workflow-package manifest registry in code
2. durable job envelope for inference and delivery stages
3. worker adapter boundary with explicit callback authentication or signed token discipline
4. separation between API-side orchestration and worker-side result production
5. persisted package/version provenance sourced from execution, not inferred from report text

Proof required:

1. one worker execution transcript
2. one authenticated callback proof
3. one package manifest resolved into a real job envelope

### Wave 3. Artifact And Evidence Closure

Goal:

Make derived artifacts durable, inspectable, and export-safe.

Priority outputs:

1. artifact manifest schema with checksum and availability state
2. object-store-compatible storage reference model
3. evidence-card validation against stored artifacts and plan branches
4. explicit export-readiness card or gate
5. report preview that consumes artifact truth instead of inferred strings alone

Proof required:

1. artifact manifest sample
2. retrieval transcript for stored artifact refs
3. report preview linked to real manifest entries

### Wave 4. Operational Durability And Readiness Evidence

Goal:

Strengthen the durability and release evidence layer without pretending to be clinically ready.

Priority outputs:

1. hosted Postgres smoke proof in the standalone repo evidence set
2. connection and retry policy for database-backed mode
3. synthetic demo transcript using the current bounded workflow slice
4. screenshot-backed operator walkthrough
5. updated launch evidence ledger tied to these artifacts

Proof required:

1. hosted CI evidence
2. demo transcript
3. screenshot bundle
4. updated evidence ledger and unchanged or upgraded verdict, depending on proof

## Recommended Immediate Task Order

The fastest honest path is:

1. Wave 2 execution boundary
2. Wave 3 artifact and evidence closure
3. Wave 4 operational durability and demo evidence

This order is recommended because the current repository already has enough control-plane truth. The main missing proof is no longer CRUD or state transitions. The main missing proof is that execution, artifacts, and release evidence cross real boundaries safely and traceably.

## Final Judgment

The subtree is stronger than a skeleton and weaker than a real MRI platform.

The right description is:

1. truthful workflow-capable standalone control-plane baseline
2. durable local and optional Postgres-backed case state
3. target architecture with good direction and mostly honest docs
4. still missing real worker, artifact, and release evidence closure

The correct next move is not a broader rewrite.

The correct next move is to harden the existing contract surfaces into a real execution boundary.