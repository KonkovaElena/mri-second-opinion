---
title: "Wave 2B Bounded Compute Audit 2026-03-29"
status: "active"
version: "1.0.0"
last_updated: "2026-03-29"
tags: [verification, wave-2b, compute, mri]
role: evidence
---

# MRI Wave 2B Bounded Compute Audit 2026-03-29

## Purpose

Record the local closure evidence for the bounded Wave 2B compute plane.

This audit confirms that the repository now has a real Python worker boundary that can:

1. claim and renew a dispatch lease
2. execute either a metadata-fallback pass or a bounded voxel-backed pass
3. classify failures as transient or terminal
4. persist generated artifacts and measurements as durable case truth

It does not by itself prove DICOM-derived pipelines, named neuro package execution, distributed worker infrastructure, or production-scale orchestration.

## Evidence Basis

1. `worker/main.py`
2. `worker/README.md`
3. `tests/workflow-api.test.ts`
4. `docs/verification/worker-artifact-contract-samples.md`
5. `docs/academic/action-plan.md`

## Validation Basis

The bounded Wave 2B hardening pass on 2026-03-29 exercised targeted workflow scenarios covering:

1. metadata-fallback worker execution under the signed dispatch contract
2. bounded voxel-backed worker execution from a tiny benchmark-safe NIfTI fixture
3. structured fallback metadata when a supplied volume cannot be parsed
4. transient requeue behavior when the inference callback fails with an upstream `502`
5. terminal failure behavior when the inference callback fails with a `400`

## Exit-Gate Mapping

### 1. Synthetic or benchmark-safe case passes end-to-end through a real worker

The repository now has explicit end-to-end proof for both bounded worker modes:

1. `python worker derives metadata-backed outputs from the dispatch execution contract under dual auth`
2. `python worker performs a voxel-backed pass when a T1w volume URL is present`
3. `python worker records classified fallback metadata when a volume URL cannot be parsed`

The voxel-backed scenario downloads a bounded NIfTI fixture, parses it in the Python worker, returns a persisted SVG overlay artifact, and exposes voxel-derived measurements on the report surface.

### 2. Errors are classified as transient or terminal

The worker and queue surfaces now preserve failure class as durable truth:

1. `python worker re-queues the job when inference callback returns an upstream 502`
2. `python worker marks the job failed when inference callback returns a terminal 400`

`worker/main.py` also walks chained exceptions before assigning failure class and stable worker error codes, so wrapped callback failures are no longer misclassified.

### 3. Generated artifacts and measurements are saved as runtime truth

The voxel-backed and metadata-fallback scenarios both assert durable case and report surfaces rather than stdout-only behavior:

1. `case.artifactManifest` persists the four required artifacts
2. report execution context persists `computeMode`, fallback metadata, and source series identity
3. voxel-backed reports persist measurements such as `volume_voxel_count`
4. artifact retrieval returns persisted `qc-summary` JSON and `overlay-preview` SVG from case-scoped artifact URLs

## Boundary Note

This audit closes Wave 2B in the bounded local sense defined by `docs/academic/action-plan.md`.

The remaining compute gaps are narrower:

1. DICOM-derived input preparation and archive-native volume acquisition
2. named neuro package execution such as FastSurfer, SynthSeg, HD-BET, or MRIQC
3. distributed or externally brokered worker infrastructure
4. production-grade performance, reproducibility, and hardware qualification

## Audit Decision

Wave 2B bounded compute closure is now evidenced in the current repository state.

The next runtime wave is Wave 3A archive and viewer truth.