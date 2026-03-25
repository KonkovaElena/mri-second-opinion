# MRI Standalone Architecture Overview

## Product Role

MRI Standalone is a workflow orchestrator for clinician-reviewed MRI second-opinion processing.

It is not a PACS replacement, not a custom imaging viewer, and not an autonomous diagnostic product.

## Operating Boundary

The system keeps three boundaries explicit:

1. DICOM and DICOMWeb for imaging interoperability
2. TypeScript control plane for workflow state and operator-facing API
3. Python compute plane for MRI preprocessing, QC, and inference

Within those boundaries, workflow eligibility must remain sequence-aware.

The system should not imply equal readiness for every MRI task when required sequences, QC disposition, or study completeness differ.

The architecture therefore requires an explicit study-router function between ingest and worker dispatch.

That router should classify workflow family, detect required sequence coverage, and preserve a manual override seam for operator correction.

The architecture also requires a transparent orchestrator control plane above individual tool calls.

That control plane should decide which workflow package is eligible, explain why it was selected, expose any policy or sequence gates that prevented execution, and assemble an operator-visible evidence trail rather than presenting one opaque "AI engine".

Where a reasoning agent is introduced, it should remain policy-bounded and emit structured plans that are validated by deterministic rules rather than free-form clinical conclusions.

## Runtime Topology

The intended baseline deployment is seven nodes:

1. `web-api`
2. `db`
3. `queue`
4. `object-store`
5. `pacs`
6. `inference-worker`
7. `frontend`

## Responsibilities By Node

## `web-api`

Owns:

1. MRI case lifecycle
2. review and finalization workflow
3. delivery retry orchestration
4. operations-facing API
5. sequence-suitability and case-eligibility decisions exposed to operators
6. routing confidence and fallback visibility

Does not own:

1. heavy image processing
2. primary DICOM storage implementation
3. custom image rendering

## `db`

Owns:

1. durable case records
2. workflow state transitions
3. review actions
4. delivery jobs and retry history

## `queue`

Owns:

1. asynchronous work dispatch
2. retry and backoff behavior
3. decoupling API latency from compute latency

## `object-store`

Owns:

1. durable derived artifacts such as masks, overlays, and report payloads
2. export-ready report attachments
3. large intermediate files that should not live directly in PostgreSQL

## `pacs`

Owns:

1. DICOM ingress
2. DICOMWeb serving to viewer workflows
3. imaging-system boundary with Orthanc
4. durable source identity for downstream derived outputs

## `inference-worker`

Owns:

1. DICOM-to-analysis conversion
2. QC checks
3. preprocessing
4. segmentation and quantitative analysis
5. structured machine output back to workflow core

The compute plane may use different tool families for different purposes, for example QC, anatomy quantification, pathology segmentation, and supplementary radiomics.

The architecture should preserve those as explicit capability boundaries.

The compute plane should also assume finite GPU memory and prefer queue-aware sequential execution for heavy model families unless multi-GPU scheduling is explicitly available.

## `frontend`

Owns:

1. queue dashboard
2. case detail and review workspace
3. report preview
4. delivery and operations visibility
5. OHIF-based viewing workflow
6. report review and export-release controls

## Clinical Safety Position

1. clinician review is mandatory
2. no workflow state implies autonomous diagnosis
3. synthetic data is acceptable for open-source demo material, but not a substitute for clinical validation
4. QC reject or warning outcomes must remain visible to operators and reviewers
5. privacy controls such as anonymization and, where needed, defacing must exist before data leaves the trusted imaging boundary
6. partial-failure and fallback paths must be recorded as first-class workflow issues rather than implicit worker logs only

## Public Workflow Summary

The intended public workflow is:

1. intake MRI case
2. create durable workflow record
3. dispatch QC and inference work
4. return draft into clinician review state
5. require explicit review and finalization
6. deliver report with retry-aware operational state

Future workflow expansion should include structured-report exports and longitudinal comparison without changing the core case lifecycle model.

The explicit reporting contract is defined in `reporting-and-export-contract.md`.

Canonical workflow states are defined in `../status-model.md`.

Canonical public API surface is defined in `../api-scope.md`.

## Why This Architecture Exists

This split keeps the product honest and maintainable:

1. Orthanc prevents PACS lock-in and custom viewer drift
2. OHIF prevents unnecessary image-viewer engineering
3. Python imaging tools stay in the compute plane where the MRI ecosystem already exists
4. TypeScript remains focused on orchestration, auditability, and operator workflow
5. PostgreSQL and Redis provide commodity durable infrastructure

The dedicated orchestrator model is described in `orchestrator-control-plane.md`.

The schema-level contract layer for manifests, plan envelopes, evidence cards, and downgrade records is defined in `orchestrator-reference-contracts.md`.

The narrowest delivery handoff for the first trustworthy slice is defined in `neuro-first-mvp-slice.md`.

## Future Seams

The architecture should remain compatible with future seams without expanding v1 scope prematurely:

1. HL7 or FHIR workflow integration
2. XNAT-style research repository attachment
3. Kaapana-style platform packaging lessons
4. expert workstation export for advanced manual review
5. MONAI Deploy style packaging or workflow-manager seams where they improve reuse without taking over the product narrative

## Current Readiness Note

This document describes the target operating architecture.

It does not imply that every node or workflow path is already implemented in the standalone repository.

For current release status, use `../launch-readiness-checklist.md` and `../releases/v1-go-no-go.md`.