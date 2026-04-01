# Performance and Clinical Evaluation Plan

Date: 2026-03-27

## Purpose

This document defines the performance and clinical evaluation plan for the standalone MRI second-opinion repository in its current research-use-only posture.

It describes the bounded slice that exists today and separates it from the broader evaluation program that would be required under a regulated pathway.

## Regulatory Context

The EU MDR 2017/745 Article 61 and MDCG 2020-13 introduce the concept of a Performance and Clinical Evaluation Plan as the governing document that defines what evidence a manufacturer will collect, how that evidence will be evaluated, and what endpoints are considered sufficient.

Because this repository is not yet a CE-marked or cleared device, this document serves as a transition plan rather than as a formal regulatory deliverable.

Its purpose is to establish the evaluation discipline early so that a future regulatory submission can reference a mature evidence history rather than a retroactive reconstruction.

## Current Product Scope

The implemented product slice consists of:

1. a brain volumetry workflow for structural MRI
2. a 9-state case lifecycle overall, with 7 post-intake states from submission through clinician-reviewed delivery
3. bearer-protected internal inference callbacks plus HMAC-authenticated dispatch rails with QC gating
4. clinician-in-the-loop review with mandatory sign-off before finalization
5. DICOM SR and FHIR R4 DiagnosticReport structured export seams
6. SQLite and PostgreSQL persistence backends
7. derived-artifact management for workflow outputs

The workflow family is neuro-first, and the intended use is research use only with clinician oversight.

## Performance Evaluation Scope

### Analytical Performance

The following analytical performance dimensions apply to the current bounded slice.

1. volumetric measurement repeatability across scanner and protocol conditions
2. segmentation accuracy against reference standard annotations
3. QC disposition accuracy for artifact rejection and quality gating
4. measurement precision within and across processing runs

### Surrogate Clinical Performance

Because the product is RUO, full prospective clinical trials are not applicable today. The surrogate performance evaluation should cover:

1. concordance of automated findings with expert neuroradiologist reads
2. sensitivity and specificity for clinically relevant volume deviations
3. false-positive and false-negative rates at the QC gating boundary
4. time-to-result impact compared to manual volumetric workflows

## Evaluation Methods

### Current Methods Already Implemented Or Planned

1. internal validation test suite exercising the full case lifecycle
2. structured export envelope validation against DICOM SR and FHIR R4 reference schemas
3. workflow regression tests covering state machine transitions and error recovery
4. artifact integrity checks through the derived-artifact manifest

### Methods Required Before A Regulated Pathway

1. retrospective reader-study protocol with predefined endpoints and sample size justification
2. subgroup analysis across scanner manufacturer, field strength, age cohort, and pathology type
3. comparison study against reference test or predicate device
4. clinical utility assessment using real-world or simulated decision-support scenarios

## Equivalence Considerations

If an equivalence claim is pursued, the following dimensions must be demonstrated:

1. technical equivalence in segmentation method, input modality, and output representation
2. biological equivalence in target anatomy and patient population
3. clinical equivalence in intended purpose and clinical context of use

Currently no equivalence claim is made or supported by evidence.

## Literature Review Strategy

The literature supporting the brain volumetry claim surface should be reviewed for:

1. current normative reference ranges for hippocampal and total brain volume
2. known limitations and confounders in automated volumetric methods
3. clinical relevance thresholds for volume change versus measurement noise
4. published validation studies for comparable RUO or regulated volumetric tools

## Evidence Endpoints

The following endpoints define what constitutes sufficient evidence at each maturity stage.

### RUO Stage

1. internal tests pass without regression across all supported workflow families
2. structured exports produce valid DICOM SR and FHIR R4 representations
3. reviewer study protocol exists and describes the planned validation scope

### Pre-Submission Stage

1. reader study complete with predefined primary and secondary endpoints met
2. subgroup analysis shows no clinically meaningful performance degradation
3. risk-benefit analysis demonstrates that residual risks are acceptable given intended use
4. literature review covers all relevant normative and clinical reference points

## Limitations

This plan describes the current evaluation scope for a single workflow family on a single anatomical domain.

It should not be interpreted as evidence that a full clinical evaluation has been completed.

Expansion to additional anatomical regions, pathology classes, or clinical deployment contexts requires updating this plan and executing the corresponding evidence-collection activities.
