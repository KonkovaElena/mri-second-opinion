# Worker Artifact Contract Samples

Date: 2026-03-29

## Purpose

This note captures the current sample contract surfaces for the wave 1 worker-facing artifact layer after the standalone merge reconciliation.

It is evidence of the implemented local contract shape.

It is evidence of a bounded Python worker runtime with stage-specific transport: inference derives outputs from case and study metadata, and delivery claims finalized jobs on the existing internal delivery rail.

It is not proof of DICOM-derived or voxel-level compute.

## Evidence Basis

These samples are aligned to the deterministic synthetic flows exercised by:

1. `tests/workflow-api.test.ts`
2. `tests/memory-case-service.test.ts`
3. `tests/postgres-case-service.test.ts`
4. `tests/execution-contract.test.ts`

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
7. a bounded Python worker with stage-specific transport: inference derives draft outputs from metadata carried in the execution contract, while delivery uses the internal delivery claim/callback rail
8. local file-backed persistence of worker-produced artifact payloads

These samples do not prove:

1. DICOM to NIfTI conversion
2. real HD-BET, FastSurfer, or SynthSeg execution
3. object-store durability for artifacts
4. production-grade Python worker orchestration at scale
5. runtime profiling on named hardware