# April 2026 Audit Execution Program

## Purpose

This document translates the April 2026 external audit into a repo-grounded execution program.

It is the practical backlog for the next engineering cycle after the current repository-local baseline closure.

It does not reopen already-closed local proof for the built-in review workbench, JSON export seams, or the current RUO publication boundary.

## What This Program Does Not Claim

This program does not claim that the repository already has:

1. production-grade OHIF plus Orthanc runtime closure
2. binary DICOM Part-10 export closure
3. DICOM SEG publication closure
4. real ML pipeline closure with FastSurfer or nnU-Net running inside the active worker path
5. executed reader-study evidence
6. production-ready GMLP or NIST AI RMF operational closure

Those remain follow-on work.

## Governing Rules

1. keep the clinician-in-the-loop boundary explicit in every new surface
2. treat DICOM and DICOMweb as the imaging interoperability boundary, not a later add-on
3. do not widen product claims faster than runtime truth and validation evidence
4. sequence work by dependency order: archive and viewer truth before stronger export and clinical-evidence claims
5. every epic must ship with validation, not only code or diagrams

## Execution Order

The audit-driven program should run in this order.

1. close DICOMweb and archive truth
2. close browser viewer truth on top of the archive truth
3. promote report exports from JSON seams to standards-grade deliverables
4. standardize worker packaging and model-family boundaries
5. raise QC from helper checks to an explicit product surface
6. formalize evidence, TEVV, and governance by design
7. add enterprise identity and object-scoped access controls where they support the clinician workflow rather than distort it

## Epic A. Imaging Interoperability Closure

### Goal

Make the archive and viewer path real enough that a case can be linked to a real DICOM study, opened in a browser viewer, and traced back to durable study identifiers.

### Deliverables

1. DICOMweb archive adapter with explicit QIDO-RS, WADO-RS, and STOW-RS seams
2. durable case linkage to StudyInstanceUID, SeriesInstanceUID, and derived artifact provenance
3. OHIF launch path from the review workspace, gated on archive truth
4. derived-object publication seam back into the archive

### Task Breakdown

1. add `ArchiveAdapter` implementations for a bounded Orthanc-first DICOMweb baseline
2. normalize case-to-study linkage so viewer launch depends on archive truth instead of synthetic locators
3. add a browser-review launch contract that passes study context into OHIF without making OHIF mandatory for every demo path
4. define publication contracts for DICOM SR, DICOM SEG, and future derived-object families

### Definition Of Done

1. a local integration test can create a case from a real DICOM study and reopen it through DICOMweb-backed viewer context
2. archive-backed cases can publish at least one derived output back to the archive boundary
3. cases without archive truth remain visibly bounded and do not present viewer claims they cannot support

## Epic B. Standards-Grade Report Outputs

### Goal

Promote current JSON export seams into standards-grade deliverables that are fit for downstream systems.

### Deliverables

1. binary DICOM SR Part-10 packaging
2. DICOM SEG publication seam for segmentation-capable workflows
3. fuller FHIR bundle surface around DiagnosticReport, Observation, ImagingStudy, and ServiceRequest relationships
4. terminology mapping policy for code systems used in exports

### Task Breakdown

1. keep the current JSON seam as the logical intermediate model
2. add a packaging layer that emits Part-10 DICOM SR from the intermediate report payload
3. define which workflows can emit DICOM SEG and which remain report-only
4. extend FHIR export to carry reviewer, study, and service-request linkage where evidence exists

### Definition Of Done

1. finalized cases can emit a binary DICOM SR artifact from the same logical report payload used by the JSON seam
2. at least one segmentation-capable workflow can emit a DICOM SEG artifact with source-study linkage
3. the FHIR export surface documents which resources are emitted now and which remain future work

## Epic C. Worker Packaging And Model Boundaries

### Goal

Move from a single demonstration worker toward explicit workflow packages with stable contracts.

### Deliverables

1. `workflow-package` manifest schema for inputs, outputs, sequence requirements, resource class, and disclaimers
2. worker package registry with versioned package identity
3. explicit model-family boundaries for QC, structural quantification, lesion segmentation, and report-assist layers
4. portability seam compatible with MONAI Deploy-style packaging without making it a forced dependency for every workflow

### Task Breakdown

1. define a package manifest contract and validation schema
2. separate package metadata from orchestration policy and runtime logs
3. treat each model family as a named capability boundary, not as one generic AI engine
4. record package version, model hash, and input constraints in case evidence

### Definition Of Done

1. at least two packages can be registered and selected through the same package contract
2. case evidence shows which package ran, with what version, and under which sequence gates
3. unsupported studies fail closed with clear package-selection reasons

## Epic D. QC As A First-Class Product Surface

### Goal

Raise QC from ad hoc worker checks to an operator-visible policy surface.

### Deliverables

1. QC policy contract with pass, warn, reject, and require-manual outcomes
2. sequence completeness rules per workflow family
3. richer QC artifact payloads that can be reviewed and audited later
4. optional MRIQC-aligned package seam for deeper QC evaluation

### Task Breakdown

1. formalize QC policy rules and map them to workflow gating decisions
2. separate QC measurements from diagnostic or model-output measurements
3. expose QC rationale in evidence cards, operations summaries, and review surfaces
4. keep fallback paths explicit rather than silently reducing trust level

### Definition Of Done

1. every routed workflow records why it passed, warned, rejected, or required manual escalation
2. at least one golden fixture exists per QC outcome family
3. operators can see when a package was blocked by QC rather than missing from the registry

## Epic E. Evidence, TEVV, And Governance By Design

### Goal

Make evidence generation and risk controls part of the runtime, not a later reporting exercise.

### Deliverables

1. case evidence bundle with input summary, QC, package identity, outputs, reviewer actions, and export references
2. traceability matrix from runtime surfaces to CLAIM, DECIDE-AI, GMLP, and NIST AI RMF expectations
3. explicit release gate criteria for stronger performance or interoperability claims
4. post-release evidence capture plan for reader-study and subgroup analysis work

### Task Breakdown

1. define a machine-readable evidence bundle contract
2. bind release docs to actual runtime proof instead of static aspiration
3. map current governance documents to concrete controls, owners, and missing proof
4. define what new evidence is required before widening claims around viewer truth, model performance, or interoperability

### Definition Of Done

1. a case can produce a reproducible evidence bundle without manual reconstruction
2. each release-facing claim can be mapped to a document, test, or runtime artifact
3. clinical-evidence work stays execution-pending until data is actually collected

## Epic F. Enterprise Access And Operational Safety

### Goal

Prepare the control plane for stronger institutional deployment without undermining the current narrow product story.

### Deliverables

1. OIDC-ready reviewer and operator identity seam
2. object-scoped authorization design for cases, artifacts, and exports
3. audit trail enrichment for actor identity and approval actions
4. change-control rules for workflow packages, model versions, and release gates

### Task Breakdown

1. separate authentication, authorization, and relationship scope in docs and code
2. keep reviewer authority tied to object scope, not only to role presence
3. extend audit surfaces so model and package changes are visible in release evidence
4. document how supply-chain and dependency changes flow into release approval

### Definition Of Done

1. reviewer and operator actions can be traced to a durable actor identity model
2. object and tenant scope remain explicit in case, artifact, and export access rules
3. workflow-package changes have an auditable release path rather than silent drift

## Suggested First Implementation Slice

The first practical slice after this audit should stay narrow and dependency-aware.

1. DICOMweb archive adapter skeleton with Orthanc-first integration proof
2. OHIF launch seam gated on archive truth
3. binary DICOM SR proof-of-life from the existing JSON report payload
4. case evidence bundle schema and one runtime-backed example

This slice is small enough to validate end to end and strong enough to unlock the rest of the program without widening clinical claims prematurely.

## Exit Criteria For This Program Document

This document stays active until the project has:

1. archive and viewer truth beyond the built-in workbench path
2. standards-grade export packaging beyond JSON seams
3. explicit package contracts for real ML workflows
4. evidence bundles tied to runtime truth
5. an execution-ready clinical validation program with real collected evidence