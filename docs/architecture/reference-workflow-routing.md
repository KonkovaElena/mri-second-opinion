# Reference Workflow And Routing

## Purpose

This document closes the gap between the target stack description and an actually operable MRI second-opinion workflow.

It defines how the standalone product should decide what kind of MRI study it received, which workflow family is allowed to run, and how the system should degrade when inputs, QC, or compute resources are insufficient.

It is a target-operating document, not proof that the current repository already implements every step below.

## Governing Rules

1. routing decisions must be sequence-aware, not body-part-label-only
2. workflow eligibility must be visible to operators and reviewers
3. GPU-heavy workloads must assume constrained hardware and avoid unsafe parallel overcommit
4. failure handling must preserve a usable review workflow whenever non-critical steps fail
5. longitudinal and structured-report seams should exist in the workflow model before their full implementation ships

## Reference Layering

The standalone product should evolve around five operational layers:

1. frontend review layer: OHIF-backed viewing, case dashboard, report preview
2. control layer: API, case lifecycle, routing, retry orchestration, operator overrides
3. workflow orchestration layer: queue-backed job graphs for brain, spine, MSK, and future pipelines
4. compute layer: preprocessing, QC, segmentation, quantification, report artifact generation
5. storage and interoperability layer: Orthanc, PostgreSQL, object storage, queue or cache

The v1 implementation can begin as a modular monolith in the control layer with separable worker processes.

The design should preserve a later evolution toward API gateway and workflow-engine patterns without forcing Kubernetes-first complexity at project start.

## Transparent Orchestrator Responsibilities

Routing alone is not enough.

The product also needs a transparent orchestrator layer that turns routing output into an explainable execution plan.

That orchestrator is responsible for:

1. resolving the selected workflow package or internal pipeline definition
2. checking policy, compute, and sequence gates before worker execution begins
3. deciding whether to run specialist-only, screening-plus-specialist, or review-only degraded paths
4. recording the reasons for every fallback, omission, or downgrade
5. returning an operator-visible execution summary that can be reviewed before a final report is released

The orchestrator should therefore be treated as an evidence assembler and policy executor, not as a free-form reasoning surface.

## Study Router Responsibilities

The system needs an explicit study router between DICOM ingress and workflow dispatch.

The router is responsible for:

1. reading DICOM metadata from study and series level
2. determining likely anatomy and workflow family
3. detecting available sequence set for that workflow family
4. marking required, optional, and missing sequences
5. choosing the eligible pipeline, fallback pipeline, or reject state
6. exposing a manual operator override when automated routing confidence is insufficient

## Routing Signals

Routing should combine multiple signals instead of trusting a single field:

1. `BodyPartExamined`
2. `StudyDescription`
3. `SeriesDescription`
4. `ProtocolName`
5. `SequenceName`
6. `ScanningSequence`
7. `ImageType`
8. vendor and scanner metadata

`BodyPartExamined` alone is not reliable enough for production routing.

`SeriesDescription` and protocol names are free text and therefore require vendor-aware lookup rules.

## Routing Strategy

The routing stack should use a three-tier decision model:

1. deterministic rules for the most common vendor and protocol naming patterns
2. lightweight metadata classifier fallback when rules are ambiguous
3. explicit operator override in the review or intake UI

The deterministic layer should maintain lookup and regex sets for Siemens, GE, Philips, Canon, and other common scanner families encountered in public and partner datasets.

The classifier layer should remain conservative and emit confidence values rather than silently force a workflow.

## Workflow Families

The initial workflow map should stay explicit:

1. brain structural workflow
2. brain lesion workflow
3. brain tumor workflow
4. spine workflow
5. knee or focused MSK workflow
6. generic research fallback based on broad MRI segmentation tools when no specialized workflow is eligible

Cardiac MRI and other anatomies may remain future seams until sequence requirements, validation data, and reporting logic are mature enough.

## Foundation And Specialist Layers

The workflow model should support two distinct inference layers:

1. foundation-style screening for broad anomaly attention or promptable segmentation
2. specialist pipelines for anatomy-specific and pathology-specific quantitative outputs

The routing layer should not treat these as substitutes.

The intended relationship is:

1. foundation screening increases coverage and highlights findings outside narrow specialist assumptions
2. specialist branches produce the higher-trust measurements and structured outputs
3. disagreement between the two becomes a first-class review and uncertainty signal

This makes the workflow more robust to long-tail findings than a specialist-only pipeline while avoiding the overclaim that a foundation model alone is sufficient for deployment-grade MRI reporting.

Language-model or VLM-style reasoning, if added later, should stay on the review-assist side of this contract. It may help summarize workflow evidence or explain branch disagreements, but it must not silently redefine routing eligibility or replace the structured result envelope.

## Reference Brain Workflow

The brain workflow should be modeled as a gated chain, not as one black-box inference call:

1. DICOM ingest and identity preservation
2. DICOM to NIfTI conversion with sidecar metadata
3. QC gate such as MRIQC with pass, warn, or reject outcome
4. orientation and intensity normalization
5. skull stripping or equivalent extraction
6. optional foundation screening branch for whole-brain anomaly attention
7. anatomical segmentation and volumetry specialist branch
8. optional lesion, tumor, or perfusion specialist branches when required sequences exist
9. cross-validation between screening and specialist outputs where both branches are present
10. uncertainty and provenance capture for model outputs
11. structured artifact generation for review and export

The system should keep structural volumetry, lesion analysis, tumor analysis, and radiomics as separate capability families.

That separation matters because they depend on different sequence sets, different failure modes, and different validation expectations.

## Cross-Validation Engine

When a foundation screening branch and a specialist branch both run on the same study, the workflow should compute a structured agreement summary.

That summary should distinguish:

1. findings seen by foundation screening only
2. findings seen by specialist processing only
3. findings seen by both but with materially different boundaries or volumes

The purpose is not to let one branch automatically overrule the other.

The purpose is to generate review priority and uncertainty cues for the clinician or operator.

## Adaptive Capability Mapping

The router should treat protocol completeness as a capability map rather than as a binary valid or invalid switch.

Examples:

1. `T1w` alone may allow structural volumetry and brain-age-style branches
2. `T1w + FLAIR` may unlock white-matter-lesion or MS-style workflows
3. `T1w + T1ce + T2w + FLAIR` may unlock tumor-specialist branches
4. `DWI` alone may justify an acute-ischemia screening branch with a narrower output contract

This keeps the product honest about what can and cannot be inferred from a partial MRI protocol.

## Reference Spine And MSK Workflows

Spine and MSK workflows should follow the same control pattern:

1. explicit sequence eligibility check
2. preprocessing suitable to the anatomy
3. segmentation and quantitative branch
4. pathology-specific branch where supported
5. structured review artifact generation

This makes spine, knee, and later body workflows plug-compatible with the same case lifecycle instead of requiring a separate product architecture.

## GPU Scheduling And Memory Discipline

The worker layer must assume limited GPU memory.

It should therefore prefer sequential model execution with explicit cache cleanup over optimistic parallel inference on a single device.

The design baseline is:

1. one heavy segmentation model at a time per GPU slot
2. queue-aware resource classes for CPU-only, light GPU, and heavy GPU jobs
3. model-family-specific memory budgets and timeouts
4. dynamic patch or batch sizing where the library stack supports it
5. explicit worker telemetry for free memory, model duration, and OOM failures

The control plane should treat GPU exhaustion as an operational condition with retry and rescheduling semantics, not as an unstructured worker crash.

## Graceful Degradation

Every major processing stage should have an explicit failure posture:

1. continue with warning when a non-critical enhancement stage fails
2. switch to a lower-confidence fallback method when a preferred method fails and validation checks pass
3. halt with operator-visible reason when the workflow is no longer clinically interpretable or reviewable

Examples:

1. alternate brain extraction chain if the preferred extractor fails
2. omit supplementary radiomics if lesion segmentation is absent or low confidence
3. downgrade from specialist-only output to screening-plus-review-only output when sequence coverage blocks quantitative claims
4. downgrade from specialized pipeline to generic segmentation-only workflow when sequence coverage is incomplete

All such degradations must be recorded in case history and surfaced in the report draft.

Experimental harmonization, synthesis, or scanner-normalization stages should default to opt-in research mode only. They may become useful future branches for difficult cross-site cohorts, but they should not silently alter the clinical-facing baseline path until workflow-specific validation is strong enough to justify them.

## Structured Output Contract

The routing and compute path should return a machine-readable result envelope that includes:

1. workflow family selected
2. routing confidence and override history
3. sequence coverage and missing-required-sequence flags
4. QC outcome and operator-visible rationale
5. model list with versions
6. findings, measurements, and uncertainty summary
7. derived artifact references such as masks, overlays, PDF, and future DICOM SR or SEG outputs
8. issues and fallbacks applied during execution

This keeps the clinician review UI, exports, and future audit trail aligned to one contract.

## Longitudinal Seam

Longitudinal comparison should be preserved as a first-class future seam in the case model.

The architecture should therefore anticipate:

1. linkage between prior and current studies for the same pseudonymous subject
2. timepoint-aware registration and change computation
3. new-lesion and changed-volume summaries as distinct findings
4. annualized change metrics where the workflow supports normative interpretation

Longitudinal outputs should remain optional until registration quality, prior-study matching, and change-validation criteria are ready.

## Implementation Consequence

The next implementation wave should not stop at API endpoints and worker invocation.

It should define:

1. study-router inputs and outputs
2. workflow family eligibility rules
3. operator override surface
4. resource-aware worker queue classes
5. result envelope and issue taxonomy
6. workflow-package registry shape and versioning rule
7. orchestrator evidence cards for branch selection, sequence coverage, and degradation rationale

The schema-level definitions for those surfaces live in `orchestrator-reference-contracts.md`.