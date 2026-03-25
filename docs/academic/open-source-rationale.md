# Open-Source Stack Rationale

Date: 2026-03-24

## Purpose

This document explains why the MRI Standalone target stack is anchored in a specific open-source ecosystem rather than in custom infrastructure or proprietary-first assumptions.

It is a rationale document, not a runtime proof document.

## Governing Thesis

The strongest v1 path for an MRI second-opinion product is a narrow workflow orchestrator built around established interoperability standards and established open-source imaging tooling.

This is preferable to:

1. building a custom viewer engine
2. building a custom PACS
3. collapsing workflow and compute planes into one codebase
4. leading the product story with model claims rather than workflow controls

This thesis also assumes that MRI workflows are sequence-sensitive and failure-sensitive.

The product should therefore not present "MRI" as one uniform input type.

Protocol completeness, sequence suitability, QC outcome, and privacy posture are part of the product architecture, not only of the model stack.

## Boundary Choices

## DICOM At The Interoperability Boundary

Why:

1. DICOM remains the clinical exchange standard
2. imaging identity, hierarchy, and acquisition metadata live there
3. hospital-facing integration should not depend on ad hoc internal formats

Consequence:

The standalone product should ingest and reference DICOM-native studies even if internal compute uses a different format.

## NIfTI At The Compute Boundary

Why:

1. neuroimaging and MRI toolchains operate naturally on NIfTI volumes
2. preprocessing, registration, segmentation, and quantification ecosystems are built around it
3. research reproducibility is better when compute artifacts are geometry-aware and volume-oriented

Consequence:

The standalone product should convert DICOM to compute-friendly volumes inside the processing plane, while preserving durable mapping back to source imaging identity.

## BIDS As A Reproducibility Scaffold

Why:

1. QC and research workflows in MRI often assume BIDS-like organization
2. benchmark and validation work are easier to reproduce when study layout is normalized
3. it creates a clean research boundary without redefining the clinical ingress contract

Consequence:

BIDS-compatible working layouts are a useful internal or evaluation-oriented pattern, but they should not be described as the primary clinical interoperability model.

## Component Rationale

## Orthanc

Chosen because:

1. it is the cleanest open-source DICOM boundary for a small standalone product
2. it supports DICOMWeb and practical integration workflows
3. it avoids custom archive engineering in v1

Rejected alternative for v1:

Enterprise-grade PACS complexity as the product core.

## OHIF

Chosen because:

1. it provides a web-native medical imaging review surface
2. it aligns with DICOMWeb workflows
3. it prevents unnecessary reinvention of a viewer engine

Rejected alternative for v1:

building a custom imaging viewer stack before workflow closure exists.

## Python Compute Plane

Chosen because:

1. the MRI ecosystem is strongest in Python
2. MONAI, nnU-Net, MRIQC, HD-BET, FastSurfer, and related tools are already there
3. the compute plane should follow the ecosystem where domain tooling is real, not where orchestration convenience is highest

Rejected alternative for v1:

forcing MRI preprocessing and model execution into the TypeScript control plane.

## Sequence-Aware And Model-Family-Aware Design

Chosen because:

1. different MRI workflows depend on different sequence sets and failure modes
2. the ecosystem contains multiple model families, not one universal MRI model class
3. product safety improves when QC, quantification, segmentation, and report-assist capabilities remain explicit and separable

Consequence:

The standalone product should keep capability boundaries explicit rather than marketing one undifferentiated AI engine.

## TypeScript Workflow Core

Chosen because:

1. workflow orchestration, API boundaries, and operational state modeling benefit from a typed control plane
2. queue, review, finalization, and delivery logic are product workflow concerns, not image-science concerns
3. separating orchestration from compute makes replacement and evaluation easier later

## PostgreSQL And Redis

Chosen because:

1. they are commodity open infrastructure
2. they fit durable workflow state plus queue execution needs
3. they keep operational dependencies understandable for a public project

## Privacy And De-Identification Boundary

Chosen because:

1. MRI studies can contain PHI-bearing DICOM metadata
2. head MRI volumes can permit facial reconstruction risk in some contexts
3. privacy controls must exist before data crosses trust boundaries, not after publication or export

Consequence:

The standalone product should preserve explicit anonymization and, where appropriate, defacing seams in the compute and demo paths.

## Reference Platforms, Not v1 Targets

`XNAT`, `Kaapana`, and broader enterprise imaging platforms are useful reference patterns for future growth.

They matter because they show what full imaging-program infrastructure can look like.

They do not change the v1 conclusion.

The correct v1 move remains a narrow MRI-only workflow product, not a general imaging platform.

## Academic And Product Logic Behind The Stack

This stack is defensible because it matches three realities at once:

1. MRI interoperability reality: DICOM remains mandatory
2. MRI research reality: NIfTI and Python imaging tools dominate compute workflows
3. product reality: clinician-facing workflow value comes from queue, review, finalization, and delivery, not from raw model exposure alone

## What This Rationale Does Not Prove

This document does not prove:

1. that the standalone repository already implements the stack
2. that the product is clinically validated
3. that the product is production-ready
4. that any particular model reaches deployment-grade performance
5. that future platform seams such as FHIR, XNAT, or Kaapana integration are already implemented

It only explains why this stack remains the most defensible open-source v1 direction.