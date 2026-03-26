# Orchestrator Control Plane

## Purpose

This document defines the transparent orchestrator that binds study routing, workflow-package selection, policy enforcement, queue-backed execution, and operator-visible evidence assembly.

It is a target-operating document.

It does not claim that the current repository already implements the full orchestrator.

Current runtime truth is narrower.

The standalone baseline now implements a bounded internal dispatch-claim seam for queued `inference` and `delivery` work plus an optional Redis-backed dispatch substrate.

It also persists lease heartbeat metadata (`lastHeartbeatAt`) on claimed attempts and returns abandoned work to the queue when the lease window expires.

It still does not implement a separate worker fleet or full distributed orchestration closure.

## Governing Model

The orchestrator should be modeled as an event-driven medical reasoning graph.

In practice that means:

1. a new study or series entering the managed DICOM boundary is treated as an execution event
2. that event produces a bounded planning problem rather than a fixed linear pipeline
3. the orchestrator composes a directed execution graph from registered workflow packages and tool contracts
4. the graph is validated by deterministic policy and sequence rules before execution
5. every branch, fallback, omission, and downgrade remains visible to operators

The key design decision is that the reasoning layer is policy-bounded.

It may help construct a candidate graph, but it does not become the authority for diagnosis, eligibility, or export state.

## Deterministic Safety Envelope

Adaptive planning should never be the only line of control.

The orchestrator should therefore preserve:

1. static fallback DAGs for each major workflow family
2. a formal validation layer that checks whether required branches, dependencies, package versions, and output contracts are present before execution
3. a reproducibility mode that pins planner version, prompt version, registry snapshot, and validation rules when deployments require the most conservative path
4. canonical scenario tests for common neuro, lesion, tumor, and spine routing cases before planner behavior is treated as trustworthy

The planner may propose a graph.

It should not become the final authority for clinical-path execution.

## Why The Orchestrator Exists

The standalone MRI product already assumes:

1. an explicit study router
2. multiple workflow families
3. multiple tool families with different sequence requirements and failure modes
4. human review as a mandatory release gate

Once those assumptions exist, a transparent orchestrator becomes necessary.

Without it, the product degrades into an opaque bundle of worker calls with unclear routing logic, unclear fallback behavior, and poor auditability.

## Non-Goals

The orchestrator is not:

1. an autonomous diagnostician
2. a replacement for structured workflow contracts
3. a justification for free-form model reasoning replacing explicit evidence
4. a requirement to turn the v1 product into a general imaging platform

The orchestrator is also not a claim that all future branches are equally mature. Structural brain workflows, tumor workflows, lesion workflows, spine workflows, interactive segmentation, synthesis, and federated improvement remain separate maturity tracks.

## Core Responsibilities

The orchestrator should own six decisions.

### 1. Workflow-package resolution

It chooses which workflow definition is eligible for a case.

That choice should depend on:

1. routing output
2. required-sequence coverage
3. policy gates
4. operator overrides
5. runtime resource availability

### 2. Plan generation

It converts eligibility into an explicit execution plan.

That plan should say:

1. which branches will run
2. which branches are blocked
3. which branches are optional or downgraded
4. what the worker layer must return

The plan should be serializable as a graph envelope so that reviewers and later automation can inspect it directly.

### 3. Policy enforcement

It blocks unsafe or misleading execution.

Examples:

1. specialist tumor branch requested but required sequences are absent
2. review summary requested before structured findings exist
3. research-mode harmonization branch disabled in clinical-facing baseline mode
4. narrative-assist branch asked to produce claims outside the structured result envelope
5. VLM or LLM branch requested for direct clinical conclusions rather than review-assist summarization

### 4. Queue-backed dispatch

It turns the plan into concrete queue jobs with resource classes.

The minimum resource classes remain:

1. CPU-only
2. light GPU
3. heavy GPU

The execution layer may map those classes to local workers, containers, Kubernetes jobs, or future package runtimes.

The orchestrator should also preserve retryable state and know which failures justify fallback versus halt.

### 5. Evidence assembly

It assembles the evidence cards returned to operators and reviewers.

Evidence cards should cover:

1. selected workflow family
2. routing confidence and override state
3. sequence coverage
4. QC disposition
5. executed model or tool versions
6. branch disagreements
7. fallbacks and omissions

Where uncertainty is available, the evidence layer should also include branch-specific confidence or uncertainty summaries rather than a single global score.

### 6. Provenance and audit

It records why the plan was chosen and what actually ran.

That provenance must remain more important than any later narrative summary.

## Architectural Layers

The orchestrator can be understood as eight cooperating layers.

### 1. Intake gateway

This is the first controlled boundary after DICOM ingress.

Its job is to:

1. receive studies or series through Orthanc and DICOMWeb-aligned paths
2. extract structured metadata from DICOM tags and sequence descriptions
3. materialize model-friendly working files such as NIfTI when the selected workflow requires them
4. run the first QC and suitability gate before heavier branches consume compute

The intake layer should therefore produce a normalized study context rather than immediately launching modeling code.

### 2. Study context builder

The normalized study context should contain at minimum:

1. anatomy guess and workflow family candidates
2. field strength and sequence inventory
3. QC disposition and quality metrics
4. site or institution identifiers when governance allows them
5. clinical indication or operator-entered intent where available

This context becomes the planning input for the orchestrator.

### 3. Medical reasoning planner

The planner may use an LLM or VLM-assisted component, but only to propose a candidate execution graph from the study context plus the registry of available tools and workflow packages.

The planner should answer questions such as:

1. which workflow family is most appropriate
2. which preprocessing path is required
3. which specialist branches are eligible from the available sequences
4. whether a research-mode branch is even allowed
5. which outputs must exist before report assembly can begin

This planner should not be free-form.

It should emit a structured plan proposal that is immediately checked by deterministic policy rules.

### 4. Tool and package registry

The registry is the model zoo and workflow catalog for the product.

It should expose:

1. tool metadata
2. workflow-package definitions
3. resource requirements
4. validation posture
5. output contracts

Without this registry, the planner becomes opaque and brittle.

### 5. Workflow engine

The workflow engine turns the approved plan into actual execution.

The most defensible current posture is:

1. native worker execution remains the early baseline
2. Prefect 3 is the cleaner event-driven and dynamic-runtime reference when the team wants Python-native branching, event triggers, state tracking, and pause-for-human semantics
3. Airflow remains the stronger scheduled and batch-oriented alternative when recurring pipeline operations dominate over event-driven case orchestration
4. Kubernetes jobs become the execution substrate only when deployment scale and isolation justify the extra operational cost

This repository should therefore describe Prefect and Airflow as workflow-engine options, not as mandatory runtime commitments.

For the MVP, the repository should also avoid adopting both a Prefect-centric runtime and a Kaapana or Airflow-centric runtime simultaneously. One active orchestration path is easier to validate than a dual-stack engine story.

### 6. Result aggregation and uncertainty

The orchestration layer should collect outputs from multiple branches and normalize them into one result envelope.

That aggregation layer should also join:

1. volumetry or measurements
2. segmentation masks and overlays
3. disagreement summaries
4. branch-specific confidence or uncertainty maps
5. warnings requiring human review

### 7. Report generation

Report generation belongs after structured aggregation, not before it.

The reporting layer may use a template-driven narrative engine with optional medical VLM assistance, but the structured results, provenance, and evidence cards remain the source of truth.

### 8. Learning and federation seam

Federated improvement, site adaptation, and cross-site governance are later seams.

They should connect to the orchestrator through explicit package, lineage, and validation contracts rather than through silent model replacement.

## Workflow Package Contract

Every workflow package should declare the following before it is allowed into the registry:

1. package identifier and version
2. workflow family
3. required and optional sequences
4. supported outputs
5. known failure modes
6. compute class
7. validation posture
8. whether the package is baseline, optional, or research-only

This keeps the product honest about what a package can actually do.

For practical use, each package manifest should also expose:

1. estimated runtime
2. minimum VRAM or CPU profile
3. whether uncertainty estimation is supported
4. standards-export compatibility such as SEG or SR-ready outputs
5. license and model-weight restrictions when they differ

## Package Types

The orchestrator should allow more than one package style.

### Native worker package

This is the default early-repository form.

The workflow is implemented directly in the Python worker and exposed through stable internal contracts.

### Portable workflow package

This is a future seam for package-oriented execution models such as MONAI Application Packages when portability or deployment isolation is useful.

### Research attachment package

This is a future seam for XNAT-linked research workflows or Kaapana-style extension packaging.

These should stay optional until the product has a concrete need for them.

## Intake And QC Gate

The intake boundary should not be a passive file converter.

It should act as a quality and context gate.

That means the first MRI workflow should be able to:

1. receive a series through Orthanc
2. extract metadata into a study context
3. convert DICOM to NIfTI where required
4. run MRIQC-class checks or equivalent image-suitability assessment
5. reject, warn, or continue with explicit rationale

The key benefit is operational honesty: low-quality or clearly unsuitable studies can be stopped before expensive downstream inference creates false certainty.

## Bounded Reasoning Agent Rule

The user-facing concept of a medical reasoning agent is valuable only if bounded tightly enough.

The repository should therefore document a reasoning agent with these rules:

1. it receives only normalized study context plus the current registry of allowed tools and workflow packages
2. it proposes a plan as structured data, not as prose
3. deterministic gates validate the plan before execution
4. human override remains available when routing confidence is weak or the clinical intent is unusual
5. the plan becomes part of provenance, not hidden chain-of-thought

This gives the product an adaptive planning surface without turning free-form model output into silent system behavior.

## Transparent-Agent Rule

If the repository later adds language-model or VLM assistance, the orchestrator must remain the authority surface.

That means:

1. the orchestrator owns branch selection
2. the structured result envelope owns findings and measurements
3. any narrative layer can only summarize orchestrator evidence cards and structured results
4. no free-form reasoning layer may silently create eligibility, diagnosis, or export state on its own

LLaVA-Med-class or similar medical VLMs therefore fit best as research-informed review-assist and image-grounded summarization seams. Their own model cards keep them out of deployed clinical use, so this repository should inherit that narrower posture.

## Research-Mode Branches

Some March 2026 ideas belong in the orchestrator only as research-mode branches:

1. foundation-style broad screening
2. generalist biomedical parsing
3. harmonization or synthesis
4. federated-improvement hooks
5. reconstruction-aware upstream handoffs
6. protocol repair or synthesis when key sequences are absent

These branches should be clearly labeled as:

1. disabled by default
2. non-source-of-truth for clinical-facing output
3. subject to separate validation and governance

## Uncertainty Layer

Uncertainty is not a cosmetic add-on.

The orchestrator should expect branch-level uncertainty outputs whenever a tool family supports them.

The architecture should reserve space for:

1. Monte Carlo dropout or ensemble-derived segmentation uncertainty
2. confidence zoning around lesion or tumor boundaries
3. operator-visible warnings when the highest-uncertainty regions overlap clinically meaningful structures
4. branch disagreement summaries when foundation screening and specialist branches materially diverge

The review layer should surface these as evidence artifacts, not bury them in logs.

The runtime budget for uncertainty should also be adaptive rather than fixed. A light pass is more defensible as the ordinary path, with deeper repeated inference reserved for cases where early variability or disagreement signals justify the additional latency.

No public latency target should assume that every model can run a full repeated-inference uncertainty protocol cheaply or that every model family even supports that mode meaningfully.

## Report Generator Contract

The reporting layer should combine:

1. structured findings
2. quantitative tables
3. uncertainty and disagreement summaries
4. standards-aligned exports
5. an explicit AI-use disclaimer appropriate to RUO posture

Target exports may include:

1. PDF or HTML for clinician review
2. FHIR `DiagnosticReport` as a future enterprise seam
3. DICOM SR and DICOM SEG where the export branch becomes active

Any VLM-generated narrative should cite the same structured evidence cards the operator can inspect.

## Federated Bridge

The orchestrator should preserve a future federated-learning bridge, but only as a later engineering seam.

The practical meaning is:

1. model lineage and versioning must already be explicit
2. local site training and update submission should be treated as separate operational workflows
3. privacy, auditing, and governance requirements belong to the federated layer, not to the inference path itself

NVFlare is the strongest current engineering reference for this seam, but the documentation should still treat federation as materially harder than ordinary single-site retraining.

## Deployment Postures

The orchestrator should support three deployment postures.

| Posture | Shape | Why it matters |
|---|---|---|
| MVP single-node | Orthanc + web-api + queue + db + object storage + one GPU worker | Fastest path to a verifiable neuro-domain baseline |
| Departmental runtime | Same baseline with multiple workers and stronger review surfaces | Fits one service line without full platform overhead |
| Hospital-grade platform | Containerized workers, stronger observability, optional Kubernetes execution, enterprise export seams | Supports scaling once governance and operations maturity justify it |

The documentation should keep hospital-grade deployment as a target posture, not as evidence that the current repository is already there.

## MVP Path

The narrowest credible MVP remains neuro-first.

The recommended first implementation path is:

1. intake and QC gate through Orthanc plus DICOM to NIfTI conversion
2. HD-BET or equivalent extraction path
3. FastSurfer or SynthSeg-class structural branch depending on protocol and quality constraints
4. structured result envelope plus review evidence card
5. report preview with strict RUO disclaimer

Medical VLM assistance can be evaluated in offline or research mode during this MVP, but it should not be required to ship the first trustworthy review workflow.

## Operator Experience

The orchestrator is only useful if operators can see what it decided.

The review surface should therefore show:

1. why the case was routed to the chosen workflow
2. which required sequences were present or missing
3. which packages ran
4. which optional branches were skipped
5. where disagreements or low-confidence outputs require attention

Interactive segmentation, such as text-guided exploration with BiomedParse-class tools, should appear as an explicit operator-invoked branch rather than as an automatic baseline behavior.

## Implementation Consequence

The next implementation wave should define:

1. workflow-package registry schema
2. orchestrator plan schema
3. evidence-card schema
4. baseline policy gates
5. downgrade taxonomy

Those contract surfaces are specified in `orchestrator-reference-contracts.md`.

The narrowest credible first delivery slice is specified in `neuro-first-mvp-slice.md`.

The planner safety envelope is specified in `reasoning-agent-safety-and-validation.md`.
6. intake context schema
7. branch-level uncertainty contract
8. package manifest schema

Those artifacts should exist before the repository grows new MRI workflow families beyond one or two narrow paths.