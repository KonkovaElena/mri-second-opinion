# Worker Artifact Contract Samples

Date: 2026-03-25

## Purpose

This note captures the current sample contract surfaces for the wave 1 neuro-first worker-facing artifact layer.

It is evidence of the implemented local contract shape.

It is not proof of a real Python or external worker runtime.

## Evidence Basis

These samples are aligned to the deterministic synthetic flows exercised by:

1. `tests/workflow-api.test.ts`
2. `tests/memory-case-service.test.ts`
3. `tests/postgres-integration.test.ts`

## 1. Sample plan envelope excerpt

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

## 2. Sample study-context artifact

This field is now persisted directly on each case as `workerArtifacts.studyContext`.

```json
{
  "studyUid": "1.2.840.0.1",
  "workflowFamily": "brain-structural",
  "sequenceInventory": ["T1w", "FLAIR"],
  "indication": "memory complaints",
  "selectedPackage": "brain-structural-fastsurfer",
  "requiredArtifacts": ["qc-summary", "metrics-json", "overlay-preview", "report-preview"],
  "createdAt": "<iso-timestamp>",
  "source": "public-api"
}
```

## 3. Sample QC artifact

This field is now persisted directly on each case as `workerArtifacts.qcSummary`.

```json
{
  "disposition": "warn",
  "summary": "Structural draft generated with mild volume-loss finding.",
  "issues": ["Motion artifact warning."],
  "artifactRefs": ["artifact://overlay-preview", "artifact://qc-summary"],
  "generatedAt": "<iso-timestamp>"
}
```

## 4. Sample findings payload

This field is now persisted directly on each case as `workerArtifacts.findingsPayload`.

```json
{
  "summary": "Structural draft generated with mild volume-loss finding.",
  "findings": ["Mild generalized cortical volume loss."],
  "measurements": [
    {
      "label": "hippocampal_z_score",
      "value": -1.4
    }
  ],
  "generatedAt": "<iso-timestamp>",
  "workflowVersion": "brain-structural-fastsurfer@0.1.0"
}
```

## 5. Sample structural run surface

This field is now persisted directly on each case as `workerArtifacts.structuralRun`.

```json
{
  "packageId": "brain-structural-fastsurfer",
  "packageVersion": "0.1.0",
  "status": "succeeded",
  "completedAt": "<iso-timestamp>",
  "artifacts": [
    {
      "artifactType": "qc-summary",
      "storageRef": "artifact://qc-summary",
      "generatedAt": "<iso-timestamp>",
      "workflowVersion": "brain-structural-fastsurfer@0.1.0"
    },
    {
      "artifactType": "overlay-preview",
      "storageRef": "artifact://overlay-preview",
      "generatedAt": "<iso-timestamp>",
      "workflowVersion": "brain-structural-fastsurfer@0.1.0"
    }
  ]
}
```

## 6. Sample branch-execution evidence card

This card is now generated as part of `evidenceCards` when a bounded structural run is present.

```json
{
  "cardType": "branch-execution",
  "cardVersion": "0.1.0",
  "caseId": "<case-id>",
  "headline": "Structural branch succeeded",
  "severity": "info",
  "status": "good",
  "summary": "brain-structural-fastsurfer@0.1.0 produced 2 artifact(s).",
  "supportingRefs": ["artifact://qc-summary", "artifact://overlay-preview"],
  "recommendedAction": null
}
```

## 7. Honesty Boundary

These samples prove the current repository has a durable local contract surface for:

1. study context
2. QC result summary
3. structured findings and measurements payload
4. bounded structural run provenance and typed derived artifacts
5. branch-execution visibility for case detail reads

These samples do not prove:

1. DICOM to NIfTI conversion
2. real HD-BET, FastSurfer, or SynthSeg execution
3. object-store durability for artifacts
4. Python worker orchestration
5. runtime profiling on named hardware