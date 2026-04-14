# Open-Source Target Architecture

## Goal

Define a production-grade, vendor-neutral, open-source-only stack for the MRI second-opinion standalone product.

## Governing Principles

1. all major infrastructure components must be open source
2. no core clinical workflow may depend on proprietary vendor SDKs or licenses
3. each subsystem must be separable in a microservice topology
4. clinician-in-the-loop remains mandatory
5. DICOM is the interoperability boundary, not an internal afterthought
6. workflow promises must be sequence-aware, not modality-generic
7. QC and privacy controls are mandatory control-plane stages, not optional post-processing

## Node Topology

The initial deployment topology should consist of seven baseline services:

1. `web-api`
2. `db`
3. `queue`
4. `object-store`
5. `pacs`
6. `inference-worker`
7. `frontend`

This should be implemented first as a modular monolith plus worker topology, not as a Kubernetes-first microservice estate.

The design should preserve separable boundaries for a later API gateway or workflow-engine evolution, but early releases should optimize for deployability and contributor comprehension.

## Control And Orchestration Layers

Even in a seven-node baseline, the product needs two explicit control concerns above raw service ownership:

1. a study-routing control function that chooses the eligible workflow family
2. a workflow-orchestration function that dispatches queue-backed stages and records retryable state

These may initially live inside `web-api` and queue workers.

They should still be modeled as distinct internal modules so that future extraction into gateway or orchestration services is possible without reworking public contracts.

## Transparent Orchestrator Pattern

The binding mechanism between routing, workflow graphs, and tool execution should be described as a transparent orchestrator control plane.

It should not be described as an autonomous diagnostic agent.

Its minimum responsibilities are:

1. maintain a registry of workflow packages and their declared inputs, outputs, and sequence requirements
2. choose the eligible workflow family and toolchain based on routing and policy rules
3. generate an execution plan with operator-visible reasons for inclusion, exclusion, fallback, or rejection
4. dispatch queue-backed stages and collect retryable state
5. assemble structured provenance, disagreement signals, and report-ready evidence cards for review

For the early repository, this should remain an internal control-plane module inside `web-api` plus worker contracts, not an eighth mandatory runtime service.

That keeps the seven-node baseline intact while still making the orchestration layer explicit enough to evolve later.

## Packaging And Platform Interoperability Seams

The orchestrator should preserve package and platform seams without forcing the standalone product to become a general-purpose imaging platform.

In practice this means:

1. native Python worker pipelines remain the default execution model
2. MONAI Deploy style application packaging is a useful future packaging seam for selected inference workflows, especially when portable DAG packaging or DICOM-first operators reduce integration cost
3. Kaapana offers useful lessons for extension packaging, workflow uploads, and access-control-aware image AI operations, but it is a platform reference rather than a v1 dependency
4. XNAT remains a realistic future attachment for research repositories and cohort management, but it should stay outside the narrow standalone v1 runtime unless a concrete repository use case appears

The design goal is compatibility with those ecosystems, not premature adoption of all of them.

## Recommended Baseline Versions

1. Node.js `>=22`
2. PostgreSQL `>=16`
3. Redis `>=7`
4. MinIO-compatible object storage for derived artifacts and temporary payload exchange
5. OHIF `>=3.12.0`
6. 3D Slicer stable release line as an operator and validation workstation, with preview builds reserved for feature evaluation rather than baseline deployment assumptions
7. MONAI `>=1.5.2`
8. nnU-Net v2 `>=2.6.4`
9. dcm2niix `>=1.0.20240202`
10. Orthanc Team Docker images pinned to a currently documented and deployment-tested tag family, while keeping Docker image tags separate from Orthanc server-version claims
11. Python `>=3.11`
12. `torch < 2.9.0` for the inference-worker until the upstream 3D convolution regression is resolved

Where orchestration references are needed for planning rather than immediate runtime commitment, the current external evidence pack supports Prefect `3.x` as the stronger event-driven reference, MONAI Deploy App SDK `3.0.0` as the current packaging reference, and Kaapana `0.6.x` as the stronger platform-pattern reference.

For cohorts that depend on FreeSurfer-compatible quantitative references, the operating rule should be stricter than simple minimum-version language: process comparable subjects with the same FreeSurfer release and platform profile, because upstream guidance still warns against mixing versions and operating systems casually within one study pipeline.

ROCm-aware deployment should be treated as an optional infrastructure seam rather than the default baseline. CUDA-centered validation remains the safer assumption for early foundation-heavy workflows unless a site has validated the exact ROCm stack it intends to operate.

OHIF and 3D Slicer should also be described as complementary review surfaces rather than interchangeable ones. OHIF is the browser-native review target for the eventual product flow, while Slicer remains the stronger workstation seam for power-user validation, rescue editing, and research-grade inspection.

## Foundation Plus Specialist Model Policy

The compute architecture should assume a two-layer AI strategy.

Level 1 is a foundation-style screening layer.

Level 2 is a workflow-specific specialist layer.

The intended behavior is:

1. use a foundation-capable model family for broad anomaly or region screening where it adds coverage value
2. use specialist toolchains for anatomy-specific or pathology-specific quantitative outputs
3. treat disagreement between the two as a review signal, not as silent model noise

This policy exists because the March 2026 ecosystem supports foundation-model screening and promptable segmentation, but still leaves many quantitative MRI tasks best served by specialist pipelines.

Specific foundation-model adoption should also be checked against model-weight terms, not only repository-code licenses.

## Node 1: web-api

### Recommended stack

1. Node.js
2. TypeScript
3. PostgreSQL client layer
4. Redis queue client

### Responsibilities

1. workflow state machine
2. role-aware API surface
3. durable case lifecycle persistence
4. integration orchestration across PACS, queue, and compute plane
5. report-finalization control plane
6. study eligibility checks for workflow-specific sequence requirements
7. routing confidence, operator override capture, and issue visibility

### Must not own

1. DICOM parsing as primary responsibility
2. GPU-heavy inference logic
3. custom viewer rendering

## Node 2: db

### Recommended stack

1. PostgreSQL

### Responsibilities

1. case records
2. workflow transitions
3. review actions
4. delivery jobs and retry state
5. audit trail

## Node 3: queue

### Recommended stack

1. Redis
2. BullMQ in TypeScript control plane

### Responsibilities

1. durable task dispatch to inference and delivery rails
2. retry and backoff control
3. decoupling of API latency from heavy compute work

The queue should support separate resource classes for:

1. CPU-only jobs
2. light GPU jobs
3. heavy GPU jobs

That split matters because the MRI worker is expected to run heterogeneous model families with different memory profiles rather than one uniform inference task type.

## Node 4: object-store

### Recommended stack

1. MinIO-compatible object storage

### Responsibilities

1. derived artifact storage for masks, overlays, report payloads, and intermediate exports
2. durable references for report generation and viewer integration
3. optional temporary payload exchange when large derived files should not transit directly through PostgreSQL

## Node 5: pacs

### Recommended stack

1. Orthanc

### Responsibilities

1. receive DICOM studies via standard DICOM network protocols
2. expose DICOMWeb-compatible retrieval surface for OHIF
3. act as DICOM facade between hospital systems and the standalone product
4. trigger ingest events through Changes API, plugin, or scripted hook
5. preserve durable linkage between original Study/Series/SOP identifiers and downstream derived artifacts

### Integration contract

Orthanc notifies `web-api` when a new MRI study enters the managed flow.

`web-api` creates a case in `INGESTING` and dispatches downstream QC and inference work.

Before dispatching a specialized pipeline, the control plane should classify the study into an explicit workflow family and mark missing-required-sequence conditions.

## Node 6: inference-worker

### Recommended stack

1. Python
2. FastAPI
3. MONAI
4. FastSurfer
5. nnU-Net v2
6. dcm2niix
7. MRIQC
8. HD-BET
9. PyRadiomics

### Responsibilities

1. DICOM-to-model-friendly conversion
2. QC gate before heavy inference
3. skull stripping and preprocessing
4. anatomical quantification
5. lesion/pathology segmentation
6. structured machine output for the workflow core
7. privacy-preserving de-identification or defacing when policy requires data to leave the trusted imaging boundary
8. package-level execution adapters for future orchestrator-managed workflow modules

### Model-family boundary

The inference worker must treat MRI AI capabilities as separate families rather than one generic model tier:

1. QC and study-suitability checks
2. foundation-style screening and promptable segmentation
3. anatomical quantification
4. lesion or pathology segmentation
5. report-assist or summarization
6. supplementary research-grade radiomics

This prevents the product from presenting one undifferentiated "AI engine" for workflows that depend on different sequence sets, validation assumptions, and failure modes.

### Practical toolchain preference

The current open-source MRI field suggests these design defaults:

1. FastSurfer or the SynthSeg family for structural brain quantification and robust anatomy-first preprocessing
2. nnU-Net v2 specialist branches for validated segmentation-heavy tasks such as tumor or anatomy-specific workflows
3. nicMSlesions or equivalent lesion-focused tools for FLAIR lesion paths
4. SCT for spinal-cord-focused segmentation and lesion-analysis workflows where validated spinal-cord tooling matters more than whole-spine labeling breadth
5. TotalSpineSeg for vertebra, disc, cord, and canal labeling workflows when full-spine identity is the dominant requirement
6. TotalSegmentator MRI task families where available anatomy coverage fits the use case, while keeping it as a task-family option rather than the universal MRI default
7. MedSAM2-class or similar foundation models for broad screening and disagreement signaling only where model-weight terms fit the intended deployment posture

The repository should treat these as interchangeable model families behind stable workflow contracts rather than as one frozen vendor stack.

### Suggested internal pipeline

1. fetch study from Orthanc
2. validate study completeness and sequence suitability for the requested workflow
3. anonymize or deface if required for out-of-bound compute path
4. convert with dcm2niix
5. optionally materialize a BIDS-compatible working layout for QC or research-oriented evaluation flows
6. run MRIQC thresholds
7. run brain extraction chain such as HD-BET with SynthStrip-style fallback when workflow requires brain-only volume
8. optionally run foundation screening branch for anomaly attention or promptable segmentation
9. run structural specialist path such as FastSurfer, FreeSurfer-compatible references, or SynthSeg-family tooling for volumetric anatomy
10. run nnU-Net or equivalent task-specific pathology branch when sequence eligibility is met
11. run SCT or TotalSpineSeg class branches when the workflow family is spine-oriented and the clinical question requires either validated cord analysis or whole-spine labeling
12. compare foundation and specialist outputs when both exist and convert disagreement into structured review signals
13. extract secondary radiomics features only as supplementary research-grade output if a lesion mask exists
14. return structured JSON to the TypeScript core, including sequence coverage, QC disposition, uncertainty signals, and derived-artifact provenance

Export-oriented workers should also keep standards tooling separate from modeling tooling. In practice that means libraries such as highdicom or conversion stacks such as dcmqi belong near the report and artifact export edge, not inside the core inference family abstraction.

PyRadiomics must be treated as a research-grade supplementary feature source in wave 1. It must not be presented as clinically validated output without separate product-level clinical validation.

Real-time reconstruction and k-space-adjacent tooling such as Gadgetron should be treated as a future upstream seam rather than a baseline dependency. They matter because the March 2026 ecosystem proves an open reconstruction framework exists, but that does not mean the second-opinion product should absorb scanner-adjacent runtime complexity in its early releases.

## Node 7: frontend

### Recommended stack

1. React or Next.js
2. Tailwind CSS
3. OHIF integration

### Responsibilities

1. queue dashboard
2. case detail and clinician review workspace
3. report preview
4. delivery state visibility
5. embedded or linked OHIF viewing workflow

### Viewer strategy

The product should not build a custom medical image viewer.

OHIF should render images through Orthanc's DICOMWeb surface, while AI results are surfaced as overlays, SEG objects, or review-side annotations.

## Five-Plane Mapping

### 1. Imaging Interoperability

1. Orthanc
2. DICOM network ingress
3. DICOMWeb egress to OHIF
4. durable identity mapping back to source imaging hierarchy

### 2. QC and Preprocessing

1. dcm2niix
2. MRIQC
3. HD-BET
4. workflow-specific sequence-suitability checks

### 3. AI Inference

1. FastAPI orchestration
2. MONAI
3. FastSurfer
4. nnU-Net v2
5. PyRadiomics

### 4. Clinician Review

1. React/Next.js case workspace
2. OHIF viewer surface
3. finalized report generation after clinician sign-off only

### 5. Delivery and Governance

1. PostgreSQL durable state
2. Redis-backed queueing
3. audit trail
4. anonymization rail
5. PDF report generation
6. plain-language reject or warning reasons for operator-visible QC outcomes

## Security and Privacy Baseline

1. PHI-bearing DICOM tags must be controlled before data exits the trusted imaging boundary
2. compute-plane anonymization must happen before any off-boundary transfer where policy requires it
3. workflow logs must avoid accidental PHI leakage
4. final reports and derived artifacts must reference durable case identifiers rather than ad hoc filenames only
5. head MRI volumes intended for public demo, benchmark, or external review paths must support defacing or equivalent facial-risk mitigation

## Failure And Degradation Baseline

1. workflow failure reasons must be structured and operator-visible
2. non-critical processing failures should degrade to warning states rather than disappear silently
3. specialized workflows should be allowed to fall back to narrower output contracts when sequence coverage is incomplete
4. critical failures must preserve enough provenance for rerun, triage, and reviewer explanation

## Reproducibility And Research Boundary

1. DICOM remains the clinical-system boundary
2. NIfTI remains the compute-friendly boundary
3. BIDS-compatible organization is recommended for research evaluation, benchmark runs, and QC-heavy developer workflows
4. the public product must not imply that BIDS is the primary clinical exchange contract

## Future Integration Seams

The v1 product should preserve, but not yet implement as core scope, these future seams:

1. HL7 or FHIR integration for broader enterprise workflow exchange
2. XNAT-like research repository integration for curated study programs
3. Kaapana-like platform packaging lessons for larger radiology AI estates
4. export paths to expert workstations such as 3D Slicer for advanced manual review
5. longitudinal comparison services for prior-study-aware second-opinion workflows

## Interoperability And Governance Upgrade Rails

The April 2026 audit sets the next post-baseline closure priorities more explicitly.

Those rails should be treated as dependency-ordered follow-on work rather than as implicit promises in the current baseline.

### Interoperability rails

1. close DICOMweb retrieve and publish seams across QIDO-RS, WADO-RS, and STOW-RS
2. treat OHIF as the primary browser review surface once archive truth is present
3. promote JSON report seams into standards-grade binary DICOM SR and DICOM SEG deliverables where workflow evidence supports them
4. keep publication of AI-derived results compatible with hospital-side interoperability patterns such as IHE AI-results style integration rather than inventing repository-local payload dialects

### Governance rails

1. make release-facing evidence bundles first-class runtime outputs rather than manual reporting artifacts
2. map validation and release claims to CLAIM, DECIDE-AI, GMLP, and NIST AI RMF style controls without overstating current compliance status
3. keep reviewer oversight, package identity, model versioning, and export provenance visible in the control plane

The practical backlog for these rails lives in `academic/2026-04-audit-execution-program.md`.

## Why This Stack Is Defensible

1. Orthanc avoids PACS vendor lock-in
2. OHIF avoids custom viewer debt
3. FastAPI plus Python imaging libraries align with the real medical-AI ecosystem
4. PostgreSQL plus Redis give durable, commodity, open infrastructure
5. the TypeScript workflow core remains focused on orchestration rather than image science

## Immediate Implementation Consequence

The next engineering wave should build around this topology, not around temporary local-file adapters that only serve the current baseline.

The first physical deliverable should therefore be:

1. standalone repo skeleton
2. PostgreSQL-backed case lifecycle
3. Redis-backed workflow queue
4. Orthanc integration seam
5. Python compute-plane contract
