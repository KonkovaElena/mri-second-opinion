# Reporting And Export Contract

Date: 2026-03-25

## Purpose

This document defines the target report payload and export surfaces for the MRI second-opinion product.

It exists because workflow closure is not only about running models.

The product also needs a defensible contract for:

1. what the compute plane returns
2. what the clinician review surface consumes
3. what artifacts are preserved for audit and reproducibility
4. what standards-based exports remain future seams rather than hand-wavy promises

This is a target-operating document.

It is not proof that every export named below is already implemented.

## External Standards Basis

The export model should stay aligned to these standards realities:

1. DICOMweb is the web-based DICOM access layer, including QIDO-RS, WADO-RS, and STOW-RS
2. OHIF v3.12 materially improves segmentation and contour editing, which strengthens the clinician-review case for DICOMWeb-backed review plus derived overlays
3. HL7 FHIR `DiagnosticReport` is suitable for imaging investigations and can carry text conclusions, structured results, images, study references, and presented forms such as PDF
4. highdicom is a concrete Python library for creating and parsing DICOM SEG and DICOM SR rather than an abstract standards reference only
5. dcmqi remains a standards-oriented conversion stack for turning common research formats into DICOM segmentations, parametric maps, and measurement-bearing objects

These standards do not force v1 implementation of every export surface.

They do define the safest long-term contract boundaries.

## Governing Principles

1. the internal result envelope must be richer than any single outward export format
2. review artifacts must remain linked to source imaging identity and model provenance
3. PDF alone is insufficient as the primary system contract
4. exports must distinguish machine findings, human review state, and final released content
5. report schemas must be versioned explicitly

## Version Pin Contract (PR-07)

Machine draft generation and clinician release must remain semantically distinct.

The internal report payload now carries three version pins:

1. `machineDraftVersion`: increments when a new machine draft is accepted
2. `reviewedReleaseVersion`: pinned to the accepted machine draft at clinician review time
3. `finalizedReleaseVersion`: pinned from the reviewed release at finalization and treated as the delivery-safe release version

Delivery and retry paths must operate against `finalizedReleaseVersion`, not against any hypothetical later draft.

If a later machine rerun attempts to replace a finalized release, the workflow must reject it rather than silently mutate delivered semantics.

## Result Envelope Layers

The reporting contract should be modeled in four layers.

### 1. Processing Envelope

Owned by the workflow and compute planes.

Required fields should include:

1. case identifier
2. workflow family
3. routing confidence and override history
4. sequence coverage and missing-required-sequence flags
5. QC outcome
6. issue and fallback log
7. model family list with versions
8. derived artifact references

### 2. Finding Layer

Represents the machine-visible output before clinician acceptance.

This layer should separate:

1. structural findings
2. lesion or tumor findings
3. quantitative measurements
4. disagreement and uncertainty signals
5. provenance per finding family

### 3. Review Layer

Represents the clinician-facing decision surface.

It should preserve:

1. reviewer identity or role
2. accepted, rejected, or edited findings
3. free-text comments or interpretive edits
4. release-blocking unresolved issues

### 4. Export Layer

Represents outward-facing deliverables.

It should support:

1. internal JSON contract
2. human-readable PDF or HTML report
3. DICOM SEG seam for segmentations
4. DICOM SR seam for structured imaging-report content
5. future FHIR `DiagnosticReport` mapping seam

## Derived Artifact Classes

Derived artifacts should be typed, versioned, and durable.

The baseline artifact taxonomy should include:

1. masks or segmentations
2. overlays or viewport-ready annotations
3. tabular metrics payloads
4. structured report payloads
5. rendered PDF or HTML reports
6. audit attachments such as QC summaries

Each artifact should preserve:

1. source study linkage
2. source series or instance linkage where relevant
3. producing workflow and model version
4. generation timestamp
5. storage URI or object-store reference

## Artifact Reference Contract

The implementation seam should treat every durable derived artifact as a typed reference object.

The current minimum reference shape is:

1. `artifactId`
2. `uri`
3. `checksum`
4. `mediaType`
5. `sizeBytes`
6. `producer`
7. `attemptId`

This contract is already sufficient for:

1. local-file URIs during the current baseline
2. MinIO-compatible or other s3-compatible object-store URIs later
3. stable audit linkage between structural runs, report payloads, and typed artifact manifests

The important rule is that large derived outputs should travel through this reference contract rather than living only as opaque inline blobs inside case state.

Small summary-safe values may still remain inline when they are required for operator or review surfaces.

## Export Ladder

The product should ship exports in a staged order rather than promise all formats at once.

### Stage A: Internal JSON

The first mandatory export is the machine-readable JSON report contract.

It is the canonical bridge between compute, review UI, and auditability.

Within that contract, `artifacts[]` should carry typed artifact references rather than format-specific inline blobs.

### Stage B: Presented Report

PDF or HTML is the first human-readable export.

It should summarize:

1. workflow performed
2. protocol completeness
3. QC disposition
4. main findings
5. reviewer status
6. model and workflow provenance
7. RUO disclaimer surface where applicable

### Stage C: DICOM SEG

DICOM SEG is the correct standards seam for machine-derived segmentation outputs when the workflow produces reviewable masks.

This should remain tied to source-study identity and should not be represented as clinically safe until segmentation quality and review workflows are validated.

At the implementation-seam level, this is where highdicom-style object construction or dcmqi-style format conversion becomes relevant. Naming those tools is useful because it keeps the contract grounded in concrete open tooling while still avoiding premature implementation claims.

### Stage D: DICOM SR

DICOM SR is the correct seam for structured imaging-report content when a workflow graduates beyond narrative-only PDF output.

The repository should treat DICOM SR as an export-grade contract goal, not as early marketing language.

For the same reason, the design should treat SR generation as a structured export subsystem with explicit provenance inputs, not as a viewer-side afterthought.

### Stage E: FHIR DiagnosticReport

FHIR `DiagnosticReport` should be treated as the enterprise workflow seam, not as the first export format.

The relevant standard points are:

1. imaging investigations are in scope
2. `DiagnosticReport` can reference imaging studies and media
3. it can carry narrative, coded conclusions, and presented forms such as PDF

This makes it a strong downstream integration target once the internal report model stabilizes.

## Minimum Internal Report Schema

The stable internal report payload should eventually carry, at minimum:

1. `reportSchemaVersion`
2. `caseId`
3. `studyRef`
4. `workflowFamily`
5. `processingSummary`
6. `qcDisposition`
7. `sequenceCoverage`
8. `findings[]`
9. `measurements[]`
10. `uncertaintySummary`
11. `issues[]`
12. `artifacts[]`
13. `provenance`
15. `versionPins`
16. `reviewStatus`
17. `disclaimerProfile`

The exact field names may evolve, but these semantic groups should not disappear.

## Provenance Requirements

Every released report artifact should preserve:

1. workflow definition version
2. model family and exact model version per branch
3. thresholds or configuration snapshot where outcome interpretation depends on them
4. routing decision and override history
5. whether findings came from screening, specialist, or both

Without that provenance, later validation, re-review, and regulated evidence generation become materially harder.

## Interaction With OHIF And DICOMweb

OHIF should remain the review surface, not the report source of truth.

The intended operating pattern is:

1. source images flow through DICOMWeb from Orthanc
2. derived masks or overlays become review-linked artifacts, ideally in standards-oriented forms that can later map cleanly to SEG or SR exports
3. the workflow core owns the report envelope and review state
4. outward exports are generated from the stable report contract rather than from ad hoc viewer state

Today that seam is represented by typed references whose URIs can be local-file backed or s3-compatible, while release-grade object-store durability remains a later closure step.

This keeps review tooling and audit-grade reporting aligned without turning the viewer into the system of record.

## Release Rule

No standards-based export should be described as complete merely because a file can be generated.

An export seam is complete only when:

1. the internal contract is versioned
2. artifact linkage is preserved
3. structural validation exists for that export format
4. review workflow semantics are not lost in translation
5. limitations are documented in public-facing docs

## Interaction With Other Docs

Use this document together with:

1. `overview.md` for system boundaries
2. `reference-workflow-routing.md` for the result envelope inputs
3. `orchestrator-reference-contracts.md` for plan, evidence-card, and downgrade authority surfaces
4. `../open-source-target-architecture.md` for object-store and frontend roles
5. `../roadmap-and-validation.md` for the staged evidence path
6. `../academic/evidence-and-claims-policy.md` for claim discipline