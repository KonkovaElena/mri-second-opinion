# Worker Artifact Contract Samples

Date: 2026-03-29

## Purpose

This note captures the current sample contract surfaces for the bounded Wave 2B worker-facing artifact layer after the standalone merge reconciliation.

It is evidence of the implemented local contract shape.

It is evidence of a bounded Python worker runtime with stage-specific transport: inference can derive outputs from case and study metadata or complete one bounded voxel-backed NIfTI pass when the execution contract carries a real `volumeDownloadUrl`, and delivery claims finalized jobs on the existing internal delivery rail.

It is proof of a bounded voxel-backed compute seam, but it is not proof of DICOM-derived or named neuro package execution.

## Evidence Basis

These samples are aligned to the deterministic synthetic flows exercised by:

1. `tests/workflow-api.test.ts`
2. `tests/memory-case-service.test.ts`
3. `tests/postgres-case-service.test.ts`
4. `tests/execution-contract.test.ts`
5. `worker/README.md`

## 1. Sample inference execution contract excerpt

This excerpt shows the worker-facing execution contract returned by the inference claim surfaces (`/api/internal/inference-jobs/claim-next` and `/api/internal/dispatch/claim`).

```json
{
  "claim": {
    "jobId": "<job-id>",
    "caseId": "<case-id>",
    "workerId": "python-worker-demo",
    "claimedAt": "<iso-timestamp>",
    "attemptCount": 1,
    "status": "claimed"
  },
  "workflowFamily": "brain-structural",
  "selectedPackage": "brain-structural-fastsurfer",
  "caseContext": {
    "studyUid": "1.2.840.0.1",
    "indication": "memory complaints",
    "sequenceInventory": ["T1w", "FLAIR"]
  },
  "studyContext": {
    "studyInstanceUid": "1.2.840.0.1",
    "sourceArchive": "orthanc-local",
    "dicomWebBaseUrl": "http://localhost:8042/dicom-web",
    "metadataSummary": ["synthetic-demo"],
    "series": [
      {
        "seriesInstanceUid": "1.2.840.0.1.1",
        "seriesDescription": "3D T1w",
        "modality": "MR",
        "sequenceLabel": "T1w",
        "instanceCount": 160
      }
    ]
  },
  "dispatchProfile": {
    "resourceClass": "light-gpu",
    "retryTier": "standard"
  },
  "packageManifest": {
    "packageId": "brain-structural-fastsurfer",
    "packageVersion": "0.1.0",
    "workflowFamily": "brain-structural"
  },
  "requiredArtifacts": ["qc-summary", "metrics-json", "overlay-preview", "report-preview"],
  "persistenceTargets": [
    {
      "artifactType": "qc-summary",
      "plannedStorageUri": "object-store://case-artifacts/<case-id>/qc-summary.json"
    }
  ]
}
```

## 1a. Sample delivery job claim excerpt

The delivery stage does not receive an execution contract. It claims a queued job from `/api/internal/delivery-jobs/claim-next` and then posts `/api/internal/delivery-callback` against the same case id.

```json
{
  "job": {
    "jobId": "<job-id>",
    "caseId": "<case-id>",
    "status": "claimed",
    "attemptCount": 1,
    "workerId": "python-worker-delivery-001",
    "claimedAt": "<iso-timestamp>",
    "completedAt": null,
    "lastError": null
  }
}
```

## 1b. Sample execution-context excerpts

The inference callback now persists explicit execution context describing whether the worker completed a bounded voxel-backed pass or fell back to metadata-only mode.

```json
{
  "computeMode": "voxel-backed",
  "fallbackCode": null,
  "fallbackDetail": null,
  "sourceSeriesInstanceUid": "<series-instance-uid>"
}
```

```json
{
  "computeMode": "metadata-fallback",
  "fallbackCode": "volume-parse-failed",
  "fallbackDetail": "Downloaded NIfTI payload is too small to contain a valid header.",
  "sourceSeriesInstanceUid": "<series-instance-uid>"
}
```

## 2. Sample plan envelope excerpt

This excerpt shows the currently persisted routing and study-context contract for an eligible neuro structural case.

```json
{
  "planSchemaVersion": "0.1.0",
  "caseRef": {
    "caseId": "<case-id>",
    "studyUid": "1.2.840.0.1"
  },
  "studyContext": {
    "workflowCandidates": ["brain-structural"],
    "sequenceInventory": ["T1w", "FLAIR"],
    "indication": "memory complaints"
  },
  "routingDecision": {
    "workflowFamily": "brain-structural",
    "confidence": 0.94,
    "decisionBasis": ["sequence-rule", "neuro-first-mvp-slice"],
    "operatorOverride": null
  },
  "packageResolution": {
    "eligiblePackages": ["brain-structural-fastsurfer"],
    "blockedPackages": [],
    "selectedPackage": "brain-structural-fastsurfer"
  },
  "requiredArtifacts": ["qc-summary", "metrics-json", "overlay-preview", "report-preview"]
}
```

## 3. Sample study-context surface

This shape is persisted directly on each case as `studyContext` and is exposed on case-detail reads.

```json
{
  "studyInstanceUid": "1.2.840.0.1",
  "dicomStudyInstanceUid": "1.2.840.0.1",
  "accessionNumber": null,
  "studyDate": null,
  "sourceArchive": "orthanc-local",
  "dicomWebBaseUrl": "http://localhost:8042/dicom-web",
  "metadataSummary": ["synthetic-demo"],
  "series": [
    {
      "seriesInstanceUid": "1.2.840.0.1.1",
      "seriesDescription": "3D T1w",
      "modality": "MR",
      "sequenceLabel": "T1w",
      "instanceCount": 160
    }
  ]
}
```

## 4. Sample QC summary surface

This shape is persisted directly on each case as `qcSummary` and is exposed on case-detail reads.

```json
{
  "disposition": "warn",
  "summary": "Structural draft generated with mild volume-loss finding.",
  "checks": [
    {
      "checkId": "motion",
      "status": "warn",
      "detail": "Motion artifact warning."
    }
  ],
  "metrics": [
    {
      "name": "snr",
      "value": 18.4,
      "unit": "db"
    }
  ]
}
```

## 5. Sample report payload excerpt

This shape is persisted on the report surface and exposed through `GET /api/cases/:caseId/report`.

```json
{
  "reportSchemaVersion": "0.1.0",
  "caseId": "<case-id>",
  "workflowFamily": "brain-structural",
  "processingSummary": "Structural draft generated with mild volume-loss finding.",
  "qcDisposition": "warn",
  "findings": ["Mild generalized cortical volume loss."],
  "measurements": [
    {
      "label": "hippocampal_z_score",
      "value": -1.4
    }
  ],
  "artifactRefs": ["artifact://overlay-preview", "artifact://qc-summary"],
  "reviewStatus": "draft",
  "disclaimerProfile": "RUO_CLINICIAN_REVIEW_REQUIRED"
}
```

## 6. Sample derived artifact descriptor

This shape is exposed under `report.derivedArtifacts`.

```json
{
  "artifactId": "<case-id>-artifact-1",
  "artifactType": "overlay-preview",
  "label": "Viewer overlay preview",
  "storageUri": "artifact://overlay-preview",
  "mimeType": "image/png",
  "archiveLocator": {
    "sourceArchive": "orthanc-local",
    "studyInstanceUid": "1.2.840.0.1",
    "accessionNumber": null,
    "seriesInstanceUids": ["1.2.840.0.1.1"],
    "dicomWebBaseUrl": "http://localhost:8042/dicom-web"
  },
  "viewerReady": true,
  "viewerDescriptor": {
    "viewerMode": "dicom-overlay",
    "studyInstanceUid": "1.2.840.0.1",
    "primarySeriesInstanceUid": "1.2.840.0.1.1",
    "dicomWebBaseUrl": "http://localhost:8042/dicom-web"
  },
  "generatedAt": "<iso-timestamp>"
}
```

## 7. Sample evidence card excerpt

This card shape is exposed on case-detail reads as part of `evidenceCards`.

```json
{
  "cardType": "branch-execution",
  "cardVersion": "0.1.0",
  "caseId": "<case-id>",
  "headline": "Structural branch succeeded",
  "severity": "info",
  "status": "good",
  "summary": "brain-structural-fastsurfer produced bounded local artifacts.",
  "supportingRefs": ["artifact://qc-summary", "artifact://overlay-preview"],
  "recommendedAction": null
}
```

## Honesty Boundary

These samples prove the current repository has a durable local contract surface for:

1. study context
2. QC result summary
3. shared worker-facing execution contract fields across both inference claim surfaces
4. report payload and structured findings
5. typed derived artifacts with conservative viewer semantics
6. evidence-card visibility on case-detail reads
7. a bounded Python worker with stage-specific transport: inference can either derive draft outputs from metadata carried in the execution contract or complete one bounded voxel-backed NIfTI pass, while delivery uses the internal delivery claim/callback rail
8. local file-backed persistence of worker-produced artifact payloads

These samples do not prove:

1. DICOM to NIfTI conversion or archive-native volume preparation
2. real HD-BET, FastSurfer, SynthSeg, MRIQC, or other named package execution
3. object-store durability for artifacts
4. production-grade Python worker orchestration at scale
5. runtime profiling on named hardware
*** Add File: c:\plans\external\mri-second-opinion\docs\verification\wave-2b-bounded-compute-audit-2026-03-29.md
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