# Open-Source MRI Ecosystem Snapshot

Date: 2026-03-25

## Purpose

This document captures the March 2026 open-source MRI AI landscape that informs the standalone product architecture.

It is a strategy and model-selection input.

It is not proof that the repository already ships every framework, model, or workflow named below.

## Governing Conclusion

The March 2026 ecosystem strongly supports a two-layer MRI second-opinion strategy:

1. foundation-model screening for broad anomaly or region awareness
2. specialist pipelines for sequence-aware quantitative outputs

This is more defensible than relying on either foundation models alone or narrow specialist tools alone.

That layered conclusion should be interpreted as an architecture rule, not as a claim that one interchangeable open-source stack already covers every MRI workflow equally well.

## Current Framework Baseline

The strongest open-source baseline visible in March 2026 is:

1. MONAI `1.5.2` for medical-imaging workflow primitives and deployment-oriented components
2. nnU-Net v2 `2.6.4` for specialist segmentation baselines and benchmark-defensible task pipelines
3. MedSAM2 and related foundation-style segmentation models for broad screening and promptable segmentation

Supporting workstation and export tooling also matters to the ecosystem baseline:

1. OHIF v3.12 is now strong enough to anchor modern browser-based review of contours, labelmaps, and segmentation editing
2. 3D Slicer remains the most broadly useful open workstation and extension ecosystem for power-user validation, manual cleanup, and research-grade conversion workflows

Those points should not be collapsed into a false either-or choice. OHIF is the stronger browser review surface for the product path, while Slicer remains the safer workstation fallback for expert inspection and recovery tasks that are awkward to compress into a browser-only flow.

Two practical implications matter for this repository:

1. MONAI `1.5.2` itself is a narrow patch release rather than a wholesale workflow reset, so architecture decisions should not be justified by version-number hype alone
2. CNN-first specialist pipelines remain highly competitive, which argues against over-rotating into foundation-model-only architecture

ROCm-oriented deployment paths are worth tracking, but should be treated as an emerging and site-validated seam rather than as a drop-in replacement for mature CUDA-centered deployments.

For this repository, that means ROCm-aware planning is reasonable, but ROCm should not be described as the default production baseline for foundation-heavy MRI workflows unless the exact hardware, operators, and model stack have been validated together.

## Foundation Model Shift

The ecosystem is no longer dominated by purely task-specific models.

Foundation-style medical-imaging models now matter because they improve:

1. anomaly screening outside narrow training distributions
2. prompt-based or interactive refinement flows
3. reuse across multiple anatomies or tasks without per-task architecture changes

For this repository, the key architectural consequence is that a foundation layer should be used as a broad screening and disagreement signal, not marketed as a self-sufficient diagnostic engine.

## MedSAM2 Adoption Constraint

MedSAM2 deserves separate treatment because its source-code and model-distribution surfaces are not identical.

The current public code repository is Apache-2.0 licensed.

The current Hugging Face model card, however, combines an open publication surface with an explicit statement that the public model weights can only be used for research and education purposes.

That means this repository should not present MedSAM2 as a frictionless commercial or clinically deployable default merely because the GitHub repository is open source.

The safer design posture is:

1. treat MedSAM2 as a strong research-informed screening candidate
2. validate intended-use and model-distribution terms separately from code-license assumptions
3. keep a specialist-only operating path viable when model-weight terms do not fit the intended deployment

## Orchestration And Packaging Lesson

The March 2026 ecosystem also supports a more explicit control-plane story than earlier MRI stacks did.

Three platform families matter here:

1. MONAI Deploy provides a concrete packaging and workflow-management vocabulary around medical-imaging AI applications, including DAG-style application design, MONAI Application Packages, DICOM-first operators, and workflow-manager seams, with App SDK `3.0.0` as the latest public release baseline in April 2025
2. Kaapana demonstrates that extension packaging, access-controlled workflow execution, and image-AI operations can be organized as a platform discipline rather than one-off scripts, with `0.6.x` introducing a workflow API and multi-node support while remaining a larger platform commitment than this repository's MVP needs
3. XNAT remains a strong research-repository and pipeline-processing reference for DICOM integration, anonymization, permissions, search, and cohort-oriented imaging informatics

For this repository, the consequence is not "adopt every platform".

The consequence is that the standalone MRI product should define a transparent orchestrator contract early, so that native worker pipelines, packaged workflow modules, and future research-repository attachments can all plug into one visible control plane.

Prefect 3 also matters here because it now documents event-driven triggers, dynamic runtime branching, pause-for-human-intervention semantics, and portable execution from local Python to containers and Kubernetes. Airflow remains the stronger batch and scheduled-workflow reference, but its own documentation is explicit that it is not primarily intended for continuously event-driven or streaming execution. That split matters for this repository because the intake event for an MRI case is closer to event-driven case orchestration than to pure recurring batch ETL.

That said, the architecture should not casually accumulate both ecosystems into one MVP runtime. Prefect is the cleaner event-driven reference for the current repository, while Kaapana and its Airflow-centered platform remain stronger comparison points for larger governed imaging estates.

## Generalist Parsing And Review-Assist Lesson

Broad biomedical models now also matter at the orchestration edge.

BiomedParse v2 shows that a single open model family can cover 3D segmentation across MRI and other modalities with a large promptable anatomy and pathology surface.

That is strategically useful for screening, exploratory fallback, and research-mode coverage expansion.

It is not a reason to erase workflow-specific specialist branches.

The BiomedParse repository itself states research-and-development-only and not-for-clinical-decision-making limits, which is exactly why this repository should frame such models as review-assist or research seams rather than deployment-grade reporting engines.

## Practical Model Strategy

The current open-source field suggests the following default preferences.

| Task | First choice | Fallback | Emerging seam |
|---|---|---|---|
| Brain structural segmentation | FastSurfer plus SynthSeg family | FreeSurfer reference path with version-locked cohort processing | foundation-style screening where license and compute constraints fit |
| Brain tumor workflow | nnU-Net v2 BraTS-style weights | BraTS toolkit style specialist branch | optional foundation-assisted review seam |
| MS or FLAIR lesion workflow | nicMSlesions or LST-style branch | BIANCA-style fallback | future promptable or multimodal assistive seam |
| Brain extraction | HD-BET or SynthStrip | FSL BET-compatible fallback | SAM-Med3D-class seam |
| Multi-organ MRI | custom MRI-specific branch or TotalSegmentator MRI task family where anatomy scope fits | custom nnU-Net branch | STU-Net-class seam |
| Spine | SCT for validated spinal-cord and lesion-oriented analysis plus TotalSpineSeg-style whole-spine labeling where vertebra and disc identity matter | custom nnU-Net branch | future foundation-assisted review seam |
| Knee or focused MSK | DOSMA plus task-specific segmenter | MRNet-style narrow fallback | UniverSeg-like seam |

This table is a design baseline only.

Any actual implementation claim still requires versioned evidence in runtime and validation docs.

It also should not be read as saying that every tool above is equally production-ready for the same intended use. FreeSurfer, FastSurfer, SCT, TotalSpineSeg, and TotalSegmentator solve materially different MRI subproblems and come with different validation and reproducibility expectations.

## Why Specialist CNN Pipelines Still Matter

The current benchmark story still favors strong specialist segmentation pipelines for many medical-imaging tasks.

That means the repository should not center its product story around the assumption that newer generalist architectures have already replaced validated specialist toolchains.

The safer posture is:

1. foundation models for screening, prompts, and anomaly attention
2. specialist models for quantitative measurements, lesion burden, and structured outputs

This is especially visible in spine and neuro workflows, where SCT remains the safer reference for spinal-cord-specific analysis and where whole-spine labeling tools such as TotalSpineSeg complement rather than replace that validated cord-analysis path.

FastSurfer deserves the same treatment on the structural-neuro side. The current project remains one of the strongest open quantitative paths for fast, FreeSurfer-compatible brain analysis, but its own documentation keeps intended use in research rather than individual clinical decision support. That is the right posture for this repository too.

## Federated Learning Opportunity

The appearance of plug-compatible federated nnU-Net-style workflows matters strategically.

For the standalone MRI product, it creates a future path toward:

1. multi-site improvement without sharing raw studies
2. institution-specific adaptation while preserving a common baseline
3. regulatory-ready provenance around model lineage and update policy

Federated improvement remains a later-phase seam, not a v1 dependency.

It should also be treated as more than a simple wrapper around standard nnU-Net training, because dataset-specific preprocessing, site-level workflow customization, and cross-site governance make federated convergence and reproducibility materially harder than ordinary single-site fine-tuning.

NVFlare strengthens the engineering case for a future federated seam because it already documents deployment, security, auditing, privacy controls, and Kubernetes or Docker deployment patterns for federated training. Even so, its existence should not be turned into a near-term promise that multi-site MRI model governance is easy.

## Reconstruction And Upstream Imaging Lesson

The open ecosystem also keeps a reconstruction tier alive.

Gadgetron remains an active open MRI reconstruction framework, which matters architecturally because it proves that scanner-adjacent reconstruction and cloud-distributed reconstruction are open research domains rather than proprietary-only territory.

For this repository, that should be interpreted as an upstream seam only. The second-opinion workflow should stay focused on post-acquisition review and derived analysis until there is a concrete need to incorporate reconstruction-aware processing.

## Explainability And Narrative Assist Caution

March 2026 medical LLM and VLM activity is strong enough to justify design awareness, but still not strong enough to justify replacing structured workflow outputs with free-form narrative reasoning.

The safer rule is:

1. structured findings, measurements, QC states, and provenance remain the source of truth
2. any language-model summary layer is review-assist only
3. experimental narrative assistance must cite the evidence cards produced by the orchestrator rather than inventing a separate reasoning path
4. if model cards or repositories explicitly state research-only or not-for-clinical-use limits, this repository should inherit the narrower posture

LLaVA-Med-class systems fit this caution exactly. They are useful architectural references for image-grounded QA and report-assist research, but their published model cards still mark them as research-only and not suitable for clinical deployment.

The same caution applies to generalist reasoning claims more broadly: strong benchmark improvements on selected medical VQA sets do not by themselves make a model suitable as the baseline decision-maker for workflow routing or clinical-path DAG construction.

## Engineering Consequence For This Repo

The March 2026 ecosystem snapshot leads to five design consequences:

1. keep the Python worker ecosystem aligned with MONAI, nnU-Net, MRIQC, FastSurfer, and related MRI-native tools
2. preserve a foundation screening layer in the workflow model even if early releases initially implement only specialist paths
3. model outputs should support disagreement analysis between screening and specialist branches
4. CPU and ROCm-aware fallbacks should remain explicit because not every installation will have one large NVIDIA GPU, but foundation-model assumptions must stay more conservative than specialist-pipeline assumptions
5. model families should stay versioned and swappable rather than being buried inside one generic AI service abstraction
6. workstation-grade review and rescue paths should remain explicit, because OHIF and 3D Slicer solve different parts of the human-in-the-loop review problem rather than competing for exactly one role
7. the control plane should formalize workflow-package registration, policy gating, and evidence assembly early, because the surrounding ecosystem now offers credible patterns for packaging and orchestration even if the repository starts with native workers only

## Interaction With Other Docs

Use this document together with:

1. `open-source-rationale.md` for the stack-level explanation
2. `../open-source-target-architecture.md` for deployment and runtime boundaries
3. `../architecture/reference-workflow-routing.md` for workflow-family routing and cross-validation behavior
4. `../roadmap-and-validation.md` for how these model choices phase into delivery and evidence generation