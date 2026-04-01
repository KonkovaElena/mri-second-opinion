---
title: "Public Vocabulary"
status: "active"
version: "1.1.0"
last_updated: "2026-04-01"
tags: [reference, vocabulary, api, mri]
---

# Public Vocabulary

## Purpose

This file freezes the current public terminology for the standalone MRI repository.

Use these terms in active docs, API descriptions, demos, and release notes unless a runtime change explicitly revises them.

## Core Product Terms

### Preferred repository identity

Use these names first when describing the standalone product:

1. `MRI Second Opinion`: preferred product name
2. `MRI second-opinion workflow system`: preferred short description
3. `clinician-in-the-loop MRI review workflow`: preferred safety framing

Do not recast the standalone repository as a broader non-MRI or cross-project platform in active docs.

1. `case`: the persisted workflow record for one MRI study review path
2. `draft report`: machine-generated report payload before clinician approval
3. `review`: clinician action that confirms or amends a draft
4. `final report`: finalized report payload after review completes
5. `delivery`: outbound release state after finalization
6. `operations summary`: aggregated queue and retry visibility for operators
7. `evidence card`: operator-facing summary card derived from workflow state, sequence coverage, or delivery state

## Persisted Workflow States

These are the only canonical workflow states in the current runtime:

1. `INGESTING`
2. `QC_REJECTED`
3. `SUBMITTED`
4. `AWAITING_REVIEW`
5. `REVIEWED`
6. `FINALIZED`
7. `DELIVERY_PENDING`
8. `DELIVERED`
9. `DELIVERY_FAILED`

Do not introduce additional persisted status names in docs or UI copy without a runtime contract change.

## Report Payload Status Terms

These terms apply to `report.reviewStatus`, not to the top-level case workflow state:

1. `draft`
2. `reviewed`
3. `finalized`

## QC Terms

The current runtime uses these QC dispositions:

1. `pass`
2. `warn`
3. `reject`

The public blocked workflow state remains `QC_REJECTED`.

Do not describe `warn` as a separate persisted workflow state.

## Delivery Terms

### Finalization input

`deliveryOutcome` may be:

1. `pending`
2. `failed`
3. `delivered`

### Internal delivery callback

`deliveryStatus` may be:

1. `failed`
2. `delivered`

### Persisted workflow states after delivery

1. `DELIVERY_PENDING`
2. `DELIVERED`
3. `DELIVERY_FAILED`

## Public Error Codes

These codes are currently emitted by the API/runtime contract:

1. `INVALID_INPUT`
2. `MISSING_REQUIRED_SEQUENCE`
3. `CASE_NOT_FOUND`
4. `REPORT_NOT_READY`
5. `DUPLICATE_STUDY_UID`
6. `INVALID_TRANSITION`
7. `INFERENCE_CONFLICT`

## Terms To Avoid As Implemented Truth

The following may appear as target architecture, overstated implementation shorthand, or broader research direction, but they are not the precise current-runtime terms to use in active docs:

1. PostgreSQL-only workflow truth
2. distributed broker-backed dispatch
3. Orthanc-integrated runtime
4. OHIF review UI
5. built-in viewer
6. autonomous diagnosis
7. non-MRI research workflow
8. cross-project clinical pipeline
9. medical AI control plane
10. cross-project medical orchestration platform

## Usage Rule For MRI-Only Surfaces

When a public sentence can be written either as MRI-specific product language or as broader ecosystem language, choose the MRI-specific form.

Examples:

1. prefer `MRI second-opinion workflow system` over `medical AI control plane`
2. prefer `clinician-in-the-loop MRI review` over `cross-project diagnostic orchestration`
3. prefer `standalone MRI repository` over `shared platform node`

## Usage Rule

1. use `docs/status-model.md` for state transitions
2. use `docs/api-scope.md` for route boundaries
3. use `docs/public-vocabulary.md` when choosing nouns, status names, or error terms in active docs