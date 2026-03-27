# Neuro-First MVP Slice

Date: 2026-03-25

## Purpose

This document defines the narrowest credible MRI second-opinion MVP that can be implemented and verified without pretending to ship a full multi-anatomy platform.

It converts the current roadmap into one bounded delivery slice.

It is a target-operating handoff, not proof that the repository already ships the full slice.

## Product Slice

The MVP should focus on one dependable case family first.

That family is neuro structural MRI with a mandatory clinician review loop.

The MVP is therefore not:

1. a lesion or tumor platform
2. a spine platform
3. an autonomous reporting system
4. a federated-learning runtime
5. a general-purpose research repository

## Why Neuro First

Neuro structural MRI is the best first slice because it offers the strongest combination of:

1. mature open tooling
2. relatively clear sequence expectations
3. realistic public validation cohorts
4. reviewable quantitative outputs
5. a tractable first report contract

## MVP Runtime Shape

The minimum credible runtime remains a single-node or single-department deployment shape.

Required services:

1. Orthanc for DICOM ingress and DICOMWeb serving
2. web API for case state and orchestrator control
3. PostgreSQL for durable state
4. queue for async execution
5. object storage for derived artifacts
6. one Python worker for QC and structural processing
7. review UI with report preview and evidence-card visibility

## Input Boundary

The first slice should accept only neuro studies that satisfy a clearly documented protocol rule.

### Minimum acceptable protocol

1. one interpretable `T1w` structural series
2. DICOM metadata sufficient to preserve study and series identity
3. conversion path to NIfTI without unrecoverable corruption

### Optional enrichments

1. `FLAIR` for future lesion-aware branches
2. operator-entered indication
3. prior-study reference for later longitudinal seams

## Core Workflow

The MVP workflow should remain short and explainable.

1. Orthanc intake event creates case record
2. study-context builder extracts sequence inventory and metadata summary
3. QC gate decides pass, warn, or reject
4. DICOM to NIfTI conversion and basic preprocessing run
5. brain extraction and structural branch run through HD-BET plus FastSurfer or SynthSeg-class tooling
6. structured result envelope is generated
7. evidence cards are assembled
8. report preview is rendered with explicit RUO language
9. clinician review finalizes, edits, or rejects release

## Mandatory Deliverables

The first slice is complete only if it produces these artifacts for a successful case.

1. durable case record
2. workflow plan envelope
3. QC summary artifact
4. structured findings and measurements payload
5. at least one reviewable visual artifact or overlay reference
6. evidence-card set
7. report preview payload
8. audit trail of routing, package selection, and review state

## Hard Non-Goals For MVP

The following should stay out of the first closure target.

1. tumor-specific multimodal branching
2. lesion quantification claims from incomplete protocols
3. automatic VLM-generated clinical narrative as a required component
4. live federated training or update exchange
5. Kubernetes-first deployment
6. DICOM SEG, DICOM SR, or FHIR export as mandatory ship blockers

Those remain valid seams, but they should not block the first trustworthy slice.

## Acceptance Gates

The MVP should satisfy six acceptance gates.

### 1. Intake gate

The system can ingest a neuro MRI study through Orthanc and create a durable case record.

### 2. Eligibility gate

The study router can explain why the case is eligible, blocked, or downgraded.

### 3. Compute gate

The worker can execute the neuro structural branch and return a structured payload without silent failure.

### 4. Review gate

The UI can show evidence cards, review state, and report preview before release.

### 5. Provenance gate

The repository can preserve workflow version, package version, and artifact references per case.

### 6. Honesty gate

Public docs and demo materials still describe the slice as RUO-first and clinician-in-the-loop rather than clinically validated autonomy.

## Proof Package

The MVP should ship with a proof packet rather than a narrative claim.

Minimum proof artifacts:

1. one-command local bring-up instructions
2. runtime health evidence
3. synthetic intake-to-review fixture
4. sample plan envelope
5. sample evidence-card set
6. sample structured report payload
7. report preview screenshots or HTML fixture
8. documented limitations and blocked paths
9. measured runtime profile with stage-by-stage timings on named hardware

## Validation Sources

Validation should combine three evidence lanes.

1. synthetic fixtures for regression and CI-safe workflow checks
2. public research cohorts such as OASIS-3 and IXI where usage terms fit research-mode validation
3. operator-reviewed internal test cases once such a workflow exists

### OASIS and IXI usage rule

These cohorts are acceptable for early research-mode validation of routing, structural processing, and artifact generation.

They are not evidence of clinical deployment readiness by themselves.

## Work Packages

The recommended execution order is:

1. case intake and durable state
2. study-context and routing contract
3. workflow-package manifest and plan-envelope storage
4. QC plus neuro structural worker path
5. evidence-card generation
6. report preview and clinician review surface
7. proof packet assembly and honesty review

Each package should leave behind runnable evidence, not only code.

## UX Minimum

The review UI for the first slice does not need to be broad.

It does need to show:

1. study identity and workflow family
2. sequence coverage
3. QC disposition
4. selected package and version
5. main measurements and artifacts
6. warnings, downgrades, and review-required states
7. release status and reviewer action

If the UI cannot make those states visible, the orchestrator is still too opaque.

## Export Posture For MVP

The first mandatory output is the internal JSON report contract plus a human-readable preview.

PDF, DICOM SEG, DICOM SR, and FHIR `DiagnosticReport` should remain staged seams.

They should be designed now and implemented only when the structured contract is already stable.

## Release Rule

The neuro-first MVP is complete only when:

1. the slice works end to end on bounded inputs
2. the review loop is real rather than implied
3. the structured contracts exist and are populated
4. the proof packet exists in repository-visible form
5. public docs still distinguish implemented truth from target architecture

## Timing Honesty Rule

No public table should claim department-ready or clinical-style wall-clock timings until the repository has measured end-to-end execution on named hardware.

That timing evidence should include:

1. intake and conversion time
2. QC time
3. structural processing time
4. report and evidence-card assembly time
5. uncertainty overhead when enabled

Until then, runtime figures belong in planning notes, not in product-style claims.

## Next Expansion After MVP

Only after the neuro-first slice is stable should the repository expand toward:

1. lesion-aware branches with uncertainty summaries
2. tumor workflows with stricter multimodal eligibility
3. DICOM SEG or SR export activation
4. longitudinal comparison seams
5. research-mode VLM assist or federated learning hooks

Use this document together with:

1. `overview.md`
2. `orchestrator-control-plane.md`
3. `orchestrator-reference-contracts.md`
4. `reference-workflow-routing.md`
5. `reporting-and-export-contract.md`
6. `../roadmap-and-validation.md`