# Orchestrator Reference Contracts

Date: 2026-03-25

## Purpose

This document defines the minimum contract set that the MRI orchestrator needs in order to stay transparent, auditable, and implementation-ready.

It exists to close the gap between architecture prose and machine-readable delivery surfaces.

It is a target-operating reference.

It is not proof that the current repository already implements the schemas below.

## Contract Set

The orchestrator should stabilize five contract families early.

1. workflow-package manifest
2. orchestrator plan envelope
3. evidence-card set
4. policy-gate record
5. downgrade record

The key rule is simple: narrative text may explain the system, but structured contracts remain the authority surface for routing, execution, review, and export state.

## Governing Rules

1. every contract must be versioned explicitly
2. package selection, blocking, downgrade, and review-required states must be machine-readable
3. free-form reasoning may propose a plan, but it cannot replace the plan envelope
4. evidence cards summarize structured state; they do not invent findings outside it
5. report and export layers must consume these contracts rather than bypass them

## Queue-State Invariant Sheet (PR-06)

Read surfaces and durable state must preserve a closed pairing between workflow status, report review status, and active queue stage.

| Case status | Required report state | Required active queue |
|---|---|---|
| `SUBMITTED` | no report | `inference` only |
| `AWAITING_REVIEW` | `draft` | none |
| `REVIEWED` | `reviewed` | none |
| `DELIVERY_PENDING` | `finalized` | `delivery` only |
| `DELIVERED` | `finalized` | none |
| `DELIVERY_FAILED` | `finalized` | none |

Any other pairing is a state-integrity violation rather than a tolerated partial condition.

## Delivery Retry Taxonomy (PR-12)

The current bounded runtime applies explicit retry and dead-letter semantics to delivery dispatch attempts.

The queue contract now distinguishes:

1. `transient` failures that can schedule another attempt under the active retry tier
2. `terminal` failures that must stop retries and dead-letter the case immediately

The current `standard` retry tier uses:

1. maximum 3 delivery attempts
2. backoff schedule of 30 seconds after attempt 1 and 120 seconds after attempt 2
3. dead-letter transition on a transient failure at the max-attempt ceiling or on any terminal failure

Each queue attempt must carry:

1. `attempt`
2. `attemptId`
3. `retryTier`
4. `maxAttempts`
5. `retryEligibleAt`
6. `failureClass`
7. `failureCode`
8. `deadLetteredAt`

This slice is intentionally bounded to delivery dispatch because that is the only worker-failure path the current standalone runtime models truthfully before the real external worker loop lands.

## 1. Workflow-Package Manifest

The workflow-package manifest is the unit of orchestration registration.

It defines what a package is allowed to do, what it requires, what it returns, and how mature it is.

### Required fields

| Field | Why it exists | Notes |
|---|---|---|
| `packageId` | stable identity | repository-wide unique |
| `packageVersion` | versioned behavior | semantic or dated version |
| `workflowFamily` | routing alignment | brain-structural, brain-lesion, brain-tumor, spine, MSK |
| `packageClass` | execution style | `native-worker`, `portable-workflow`, or `research-attachment` |
| `packageStatus` | maturity posture | `baseline`, `optional`, or `research-only` |
| `requiredSequences` | eligibility gate | sequences without which claims are blocked |
| `optionalSequences` | enrichment path | absence may degrade but not always block |
| `qcPrerequisites` | quality gate | minimum QC disposition and rules |
| `outputContracts` | downstream binding | findings, artifacts, exports, uncertainty |
| `computeProfile` | scheduler fit | CPU-only, light GPU, heavy GPU |
| `validationPosture` | honesty surface | design-only, benchmarked, internal-eval, external-eval |
| `licenseSurface` | deployment truth | code license, model-weight terms, dataset caveats |
| `knownFailureModes` | operator safety | visible to reviewers and support staff |
| `operatorWarnings` | UI summary | human-readable limits and cautions |

### Strongly recommended fields

1. `estimatedRuntime`
2. `minimumHardwareProfile`
3. `uncertaintySupport`
4. `exportCompatibility`
5. `lineageRefs`
6. `owner`
7. `entrypoint`
8. `dependencies`

### Reference shape

```json
{
  "packageId": "brain-structural-fastsurfer",
  "packageVersion": "0.1.0",
  "workflowFamily": "brain-structural",
  "packageClass": "native-worker",
  "packageStatus": "baseline",
  "requiredSequences": ["T1w"],
  "optionalSequences": ["FLAIR"],
  "qcPrerequisites": {
    "minimumDisposition": "warn",
    "blockedOn": ["missing-primary-series", "corrupt-conversion"]
  },
  "outputContracts": {
    "findings": ["structural-volumetry"],
    "artifacts": ["metrics-json", "overlay-preview"],
    "exportCompatibility": ["internal-json", "rendered-report"],
    "uncertaintySupport": "none"
  },
  "computeProfile": "light-gpu",
  "validationPosture": "internal-eval",
  "licenseSurface": {
    "code": "open-source",
    "weights": "research-or-compatible",
    "notes": ["human-review-required"]
  }
}
```

## 2. Orchestrator Plan Envelope

The plan envelope is the single machine-readable description of what the orchestrator decided for a case.

It must exist even when the final result is a blocked or downgraded path.

### Required sections

| Section | Why it exists | Minimum contents |
|---|---|---|
| `planSchemaVersion` | schema stability | explicit version string |
| `caseRef` | joins runtime objects | case and study identifiers |
| `studyContext` | planning input snapshot | workflow candidates, sequence inventory, QC, metadata summary |
| `routingDecision` | explainability | selected family, confidence, rule basis, override state |
| `packageResolution` | execution binding | eligible, blocked, and selected packages |
| `branches` | graph visibility | each branch with status, dependencies, outputs |
| `policyGateResults` | safety truth | allow, warn, block, require-override |
| `downgradeState` | honesty on partial execution | none or explicit downgrade record |
| `dispatchProfile` | scheduler contract | resource class, retry posture, timeout tier |
| `requiredArtifacts` | completion definition | which artifacts must exist before review or export |
| `provenance` | replayability | planner version, registry snapshot, timestamps |

### Branch status vocabulary

Use a closed status set.

1. `planned`
2. `blocked`
3. `optional`
4. `downgraded`
5. `dispatched`
6. `succeeded`
7. `failed`
8. `omitted`

### Reference shape

```json
{
  "planSchemaVersion": "0.1.0",
  "caseRef": {
    "caseId": "case-123",
    "studyUid": "1.2.3"
  },
  "routingDecision": {
    "workflowFamily": "brain-structural",
    "confidence": 0.94,
    "decisionBasis": ["sequence-rule", "metadata-rule"],
    "operatorOverride": null
  },
  "packageResolution": {
    "eligiblePackages": ["brain-structural-fastsurfer"],
    "blockedPackages": ["brain-lesion-flair"],
    "selectedPackage": "brain-structural-fastsurfer"
  },
  "branches": [
    {
      "branchId": "qc",
      "role": "quality-gate",
      "status": "planned",
      "requiredOutputs": ["qc-summary"]
    },
    {
      "branchId": "structural",
      "role": "specialist",
      "status": "planned",
      "requiredOutputs": ["metrics-json", "overlay-preview"]
    }
  ],
  "policyGateResults": [],
  "downgradeState": null,
  "dispatchProfile": {
    "resourceClass": "light-gpu",
    "retryTier": "standard"
  }
}
```

## 3. Evidence-Card Set

Evidence cards are the operator-visible summary layer built from orchestrator and worker state.

They are not a second source of truth.

They are the inspection surface that makes package choice, sequence coverage, QC state, disagreement, and uncertainty visible without forcing a user to parse raw logs or JSON.

### Core card types

1. routing card
2. sequence-coverage card
3. QC card
4. branch-execution card
5. disagreement card
6. uncertainty card
7. export-readiness card
8. review-status card

### Required fields per card

| Field | Why it exists |
|---|---|
| `cardType` | stable UI and API handling |
| `cardVersion` | schema compatibility |
| `caseId` | join back to workflow state |
| `headline` | operator scanability |
| `severity` | review priority |
| `status` | good, warn, blocked, review-required |
| `summary` | short explanation grounded in structured state |
| `supportingRefs` | links to plan branches, artifacts, or findings |
| `recommendedAction` | operator next step when human action is needed |

### Severity vocabulary

1. `info`
2. `warn`
3. `high-review-priority`
4. `blocked`

### Reference shape

```json
{
  "cardType": "sequence-coverage",
  "cardVersion": "0.1.0",
  "caseId": "case-123",
  "headline": "Structural workflow eligible",
  "severity": "info",
  "status": "good",
  "summary": "T1w present. FLAIR missing, so lesion branch remains blocked.",
  "supportingRefs": ["plan:branch/structural", "plan:blocked/brain-lesion-flair"],
  "recommendedAction": null
}
```

## 4. Policy-Gate Record

Policy gates explain why a branch or export was allowed, warned, blocked, or forced into override-required status.

### Gate classes

1. `sequence-gate`
2. `qc-gate`
3. `governance-gate`
4. `compute-gate`
5. `review-gate`
6. `export-gate`
7. `research-mode-gate`

### Outcomes

1. `allow`
2. `warn`
3. `block`
4. `require-override`

### Required fields

1. `gateId`
2. `gateClass`
3. `outcome`
4. `target`
5. `rationale`
6. `evidenceRefs`
7. `timestamp`

## 5. Downgrade Record

Downgrades must be first-class records.

If the system moved from a stronger path to a weaker one, the record should make that change explicit and reviewable.

### Recommended downgrade codes

1. `missing-required-sequence`
2. `qc-warn-degraded`
3. `specialist-blocked-screening-only`
4. `gpu-class-unavailable`
5. `research-branch-disabled`
6. `export-deferred`
7. `interactive-branch-manual-only`
8. `quantitative-claim-suppressed`

### Required fields

1. `downgradeCode`
2. `fromState`
3. `toState`
4. `rationale`
5. `visibleToOperator`
6. `outputLimitations`

## Contract Interaction With Reporting

The reporting layer should consume these contracts in a fixed order.

1. plan envelope defines what ran and what did not
2. evidence cards summarize operator-relevant state
3. structured findings and artifact refs populate the report payload
4. export surfaces such as PDF, SEG, SR, or future FHIR mappings are generated from the stable report contract, not from ad hoc viewer state

This matters because HL7 `DiagnosticReport` is an event-oriented report resource that can carry studies, results, media, and presented forms, while DICOM SEG and SR require provenance-rich, standards-aware artifact handling.

The internal contract must therefore stay richer than any one outward export.

## Implementation Consequence

The first implementation wave should not start by wiring random queue jobs.

It should define:

1. manifest storage and validation rules
2. plan-envelope creation and persistence
3. evidence-card generation from structured state
4. policy-gate and downgrade helpers
5. report generation that consumes these contracts directly

Use this document together with:

1. `orchestrator-control-plane.md`
2. `reference-workflow-routing.md`
3. `reporting-and-export-contract.md`
4. `neuro-first-mvp-slice.md`