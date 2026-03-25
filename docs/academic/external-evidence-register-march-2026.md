# External Evidence Register

Date: 2026-03-25

## Purpose

This document records the external sources that currently justify the strongest research-informed claims in the standalone MRI repository.

It is not a literature review of all MRI AI.

It is a disciplined source pack for architecture, regulation, interoperability, and ecosystem-baseline claims that appear elsewhere in `docs/`.

## Usage Rule

Use this register when a statement depends on:

1. current regulatory framing
2. current open-source framework or release baseline
3. standards-based interoperability claims
4. current viewer or reporting capability assumptions

If a statement is sourced mainly from this register, it remains a research-informed claim until runtime or validation evidence inside this repository promotes it to a stronger claim class.

Proposal-level legal commentary should remain outside the normative source pack unless the underlying proposal text or an official Commission surface is being cited for status only.

## Source Register

| Domain | Source | Date signal | Why it matters here | Architectural consequence |
|---|---|---|---|---|
| US regulation | FDA AI-enabled medical devices list: https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-enabled-medical-devices | content current as of 2026-03-04 | Shows FDA keeps AI-enabled devices in an explicit regulated-device transparency surface and now signals future identification of foundation-model functionality, while reminding us that public counts are snapshot-sensitive and should not be frozen into active docs without a date stamp | Keep RUO-first posture, avoid stale static device-count claims, and do not imply that foundation-model usage weakens device-software scrutiny |
| US regulation | FDA draft guidance: `Artificial Intelligence-Enabled Device Software Functions: Lifecycle Management and Marketing Submission Recommendations`: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/artificial-intelligence-enabled-device-software-functions-lifecycle-management-and-marketing | January 2025 draft guidance | Frames submission and lifecycle expectations around total product lifecycle risk management, not one benchmark only | Preserve provenance, logging, versioning, human oversight, and validation folders early |
| EU regulation | European Commission AI Act overview: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai | last update 2026-01-27 | Confirms high-risk AI obligations center on risk management, dataset quality, logging, documentation, human oversight, robustness, and accuracy | Keep traceability, audit logging, review checkpoints, and documentation as first-class engineering surfaces |
| DICOM ingress platform | Orthanc Team Docker images docs: https://orthanc.uclouvain.be/book/users/docker-orthancteam.html | Orthanc docs current in 2026 | Confirms current deployment guidance uses the renamed `orthancteam/orthanc` images, documents default and `-full` image variants, and warns against treating Docker tags as equivalent to Orthanc server-version claims | Pin an explicitly tested Orthanc Team image tag per deployment and avoid implying a separate `24.x` server-version scheme unless a source proves that mapping |
| Imaging interoperability | DICOMweb overview: https://www.dicomstandard.org/using/dicomweb | current standard landing page | Confirms DICOMweb as the web-based medical-imaging standard with QIDO-RS, WADO-RS, and STOW-RS | Keep Orthanc plus DICOMWeb as the viewer and integration boundary instead of inventing a custom image API |
| Viewer baseline | OHIF Viewer v3.12 release notes: https://ohif.org/release-notes/3p12/ | February 2026 | Documents stronger contour, segmentation, and review tooling in the current open viewer stack | Treat OHIF as a serious clinician-review surface for overlays, SEG-linked review, and structured segmentation workflows |
| Workstation baseline | 3D Slicer download page: https://download.slicer.org/ | stable 5.10.0 and preview 5.11.0 visible on 2026-03-25 | Confirms an actively maintained cross-platform workstation with distinct stable and preview release tracks | Treat Slicer as a validation and power-user workstation seam, not as proof that browser review can be skipped |
| Medical-imaging framework | MONAI 1.5.2 release: https://github.com/Project-MONAI/MONAI/releases/tag/1.5.2 | 2026-01-29 release | Confirms the current release baseline exists and remains actively maintained | Keep Python compute aligned to MONAI-family tooling rather than custom inference scaffolding |
| Segmentation baseline | nnU-Net v2.6.4 release: https://github.com/MIC-DKFZ/nnUNet/releases/tag/v2.6.4 | 2026-02-04 tag | Confirms the current open specialist segmentation baseline remains active | Preserve specialist branches as first-class workflow families rather than collapsing everything into one generalist model story |
| Brain structural reference path | FreeSurfer download and install guidance: https://surfer.nmr.mgh.harvard.edu/fswiki/DownloadAndInstall | page updated 2025-08-21 | Confirms FreeSurfer still emphasizes same-version and same-platform cohort processing discipline | Keep reproducibility language strict for any FreeSurfer-compatible quantitative path |
| Brain structural runtime shift | FreeSurfer 8 notes: https://surfer.nmr.mgh.harvard.edu/fswiki/rel7downloads/rel8notes | page edited 2026-03-17 | Documents new 8.x recon-all behavior, memory implications, and updated license-file guidance | Describe FreeSurfer 8.x as a meaningful runtime change, not a trivial drop-in patch |
| Brain structural fast path | FastSurfer repo: https://github.com/Deep-MI/FastSurfer | active repo, latest release visible as `v2.4.2` on 2025-02-19 and docs updated through 2026 | Confirms an active deep-learning neuroimaging pipeline, FastSurferVINN segmentation modules, container-oriented execution, and explicit research-only intended-use language | Treat FastSurfer as a strong open quantitative path for structural MRI while preserving human QC and RUO wording |
| Foundation-model code surface | MedSAM2 GitHub repo: https://github.com/bowang-lab/MedSAM2 | current public repo | Confirms the public codebase, April 2025 paper lineage, Apache-2.0 repository license, and CUDA-centered installation path | Treat MedSAM2 as a real open source candidate, but not as proof that all deployment surfaces are equally permissive |
| Foundation-model weight surface | MedSAM2 Hugging Face model card: https://huggingface.co/wanglab/MedSAM2 | current model card | States that the public model weights can only be used for research and education purposes even though the public release surface is otherwise open and easy to download | Separate source-code openness from model-weight deployment rights when describing foundation-model options |
| Generalist biomedical segmentation | BiomedParse v2 repo: https://github.com/microsoft/BiomedParse | active v2 repo with MRI support, 3D inference examples, Apache-2.0 repository license, and explicit research-and-development-only usage notice | Confirms a generalist biomedical parsing model family with MRI-relevant 3D support while also showing that open code does not override its non-clinical intended-use restriction | Treat broad promptable parsing models as research-informed screening or fallback seams, not as clinical-source-of-truth engines |
| Clinical LLM caution | Med42 model card: https://huggingface.co/m42-health/Llama3-Med42-8B | current card accessed 2026-03-25 | Confirms strong open medical-LLM activity but also explicit not-ready-for-clinical-use and human-validation limits | Keep any narrative or reasoning layer in review-assist mode only |
| Workflow packaging and DAG apps | MONAI Deploy App SDK releases: https://github.com/Project-MONAI/monai-deploy-app-sdk/releases | latest public release `v3.0.0`, April 2025 | Confirms programmable DAG-based medical-imaging apps, DICOM operators, Triton support, and one-command packaging into MONAI Application Packages with a concrete current version reference | Preserve a workflow-package seam in the orchestrator design without making MONAI Deploy a mandatory runtime dependency |
| Clinical workflow packaging ecosystem | MONAI Deploy Working Group repo: https://github.com/Project-MONAI/monai-deploy | active working-group repo | Confirms MONAI Deploy’s explicit assets around MAP packaging, Informatics Gateway, Workflow Manager, and DICOM/FHIR interoperability goals | Use MONAI Deploy as a credible architectural reference for packaging and orchestration seams |
| Event-driven workflow engine | Prefect docs: https://docs.prefect.io/ | Prefect v3 docs current in 2026 | Confirms Python-native flows, event-driven triggers, dynamic runtime branching, state tracking, pause-for-human-intervention, and portable execution across local, container, and Kubernetes runtimes | Treat Prefect as the cleaner event-driven orchestration reference for case-driven MRI workflows |
| Batch workflow engine | Airflow docs: https://airflow.apache.org/docs/apache-airflow/stable/index.html | Airflow 3.1.8 docs current in 2026 | Confirms Airflow as a strong batch-oriented workflows-as-code platform while explicitly warning that it is not primarily intended for continuously event-driven or streaming workloads | Treat Airflow as a valid alternative for scheduled or recurring operations, not the default rationale for event-driven case orchestration |
| Imaging AI operations platform | Kaapana releases: https://github.com/kaapana/kaapana/releases | latest `0.6.1` in February 2026, with `0.6.0` introducing workflow API and multi-node support | Confirms an open platform with workflow extensions, access control, multi-node deployment, and a newer workflow API surface while also underlining that Kaapana is a substantial platform, not a lightweight orchestrator library | Use Kaapana as a platform-pattern reference for extension management and governed execution, not as a required dependency |
| Research imaging informatics | XNAT site: https://www.xnat.org/ | current site shows 1.9.x release line and current feature set | Confirms active open imaging informatics with DICOM integration, anonymization, permissions, search, reporting, and pipeline-processing support | Preserve a future XNAT seam for repository attachment or cohort operations without broadening v1 into a general imaging repository |
| Federated learning platform | NVIDIA FLARE repo: https://github.com/NVIDIA/NVFlare and docs: https://nvflare.readthedocs.io/en/main/ | active 2.7.x release line in 2026 | Confirms a mature open federated-learning SDK with deployment, privacy, auditing, and security documentation | Keep federated improvement as a later engineering seam with serious governance and operations cost, not as an easy v1 add-on |
| Standards export library | highdicom documentation: https://highdicom.readthedocs.io/en/latest/ | latest docs accessed 2026-03-25 | Confirms a concrete Python library for creating and parsing DICOM SEG and DICOM SR objects | Ground DICOM export seams in real open tooling rather than standards name-dropping |
| Standards conversion library | dcmqi overview: https://qiicr.org/tool/dcmqi/ | public page available 2026-03-25 | Confirms an open conversion stack for segmentations, parametric maps, and segmentation-based measurements into DICOM | Keep research-format to DICOM conversion as a realistic interoperability path |
| MRI reconstruction seam | Gadgetron docs: https://gadgetron.github.io/ | active docs landing page available in 2026 | Confirms an open MRI reconstruction framework and published cloud-distributed reconstruction lineage | Treat reconstruction-aware processing as a future upstream seam rather than a baseline second-opinion dependency |
| Spinal-cord analysis baseline | SCT deep segmentation docs: https://spinalcordtoolbox.com/stable/user_section/command-line/sct_deepseg.html | stable docs accessed 2026-03-25 | Shows SCT covers spinal cord, gray matter, lesion, tumor, rootlet, canal, and spine tasks with explicit model lifecycle guidance | Keep SCT as the safer reference path for spinal-cord-centered MRI analysis |
| Whole-spine labeling | TotalSpineSeg README: https://github.com/neuropoly/totalspineseg | current repo with releases through late 2025 | Confirms a dedicated whole-spine MRI tool for vertebrae, discs, cord, and canal labeling and explicitly warns against using it as a validated CSA replacement | Use TotalSpineSeg as a whole-spine labeling option that complements rather than replaces SCT |
| MRI anatomy task family | TotalSegmentator README: https://github.com/wasserth/TotalSegmentator | current repo content with MRI tasks visible in 2026 | Confirms MR-oriented tasks, including `total_mr`, vertebrae-oriented tasks, and DICOM SEG output support via `highdicom` | Treat TotalSegmentator as a meaningful MRI task family and export seam, not as a universal default for all MRI workflows |
| Enterprise report exchange | HL7 FHIR R5 `DiagnosticReport`: https://hl7.org/fhir/R5/diagnosticreport.html | current published R5 page | Confirms imaging investigations are in scope and that reports can include narrative, coded conclusions, studies, media, and presented forms such as PDF | Keep a future `DiagnosticReport` seam in the export architecture, but not as the first mandatory output |
| Research reproducibility | BIDS landing page: https://bids.neuroimaging.io/ | current public standard site | Confirms BIDS remains a standardized organization plus validation ecosystem for neuroimaging data | Preserve BIDS-compatible working layouts as a reproducibility seam without confusing them with the clinical ingress boundary |
| Public longitudinal neuro MRI cohort | OASIS site: https://sites.wustl.edu/oasisbrains/ | current access and data-use terms visible in 2026 | Confirms OASIS-3 as an open-access longitudinal multimodal neuroimaging and cognitive dataset for aging and Alzheimer’s disease, with explicit research-use access terms | Use OASIS cautiously as a research-mode validation candidate, with data-use terms and non-clinical posture stated explicitly |
| Public multi-site MRI cohort | IXI dataset site: https://brain-development.org/ixi-dataset/ | current public dataset page visible in 2026 | Confirms a multi-site healthy-subject MRI dataset with T1, T2, PD, MRA, and diffusion images across 1.5T and 3T scanners | Use IXI as a lightweight public validation candidate for structural and routing baselines where healthy-cohort limitations are acceptable |
| Medical VLM caution | LLaVA-Med model card: https://huggingface.co/microsoft/llava-med-v1.5-mistral-7b | current card accessed 2026-03-25 | Confirms a publicly released biomedical image-text model family with open distribution, but also explicit research-only intended use, out-of-scope deployed use, and not-for-clinical-decision-making language | Keep LLaVA-Med-class systems in review-assist or offline evaluation mode only |

## Claim Consequences

These sources support the following repository-level conclusions.

### 1. RUO-First Remains The Only Honest Public Posture

The regulatory sources support traceability and lifecycle discipline, not public claims of ready-for-clinic status.

They also support cautious wording around market totals and regulatory timing. If active docs mention counts of FDA-listed AI-enabled devices, those counts should be date-stamped and treated as rapidly perishable snapshot data rather than as stable product-positioning facts.

### 2. DICOM And DICOMweb Should Stay The Clinical Boundary

The standards evidence supports DICOM-native ingress and DICOMWeb-native review rather than ad hoc imaging APIs.

### 3. Foundation Plus Specialist Is More Defensible Than Either Extreme Alone

The framework and ecosystem sources support an architecture that preserves both broad screening and specialist quantitative branches.

That conclusion does not imply that every foundation-model candidate is legally or operationally interchangeable.

It also does not imply that all specialist tools solve the same problem class. Brain quantification, spinal-cord analysis, whole-spine labeling, and multi-organ MRI segmentation remain materially different workflow families.

The same logic applies to orchestration and packaging. Open platforms now provide credible patterns for workflow packages, governed execution, and research-repository integration, but this repository should still preserve a narrow MRI product scope and adopt those patterns selectively.

### 4. Reporting Must Be Modeled As A Structured Contract

FHIR and DICOMweb evidence both reinforce that report exchange is more than rendering a PDF.

highdicom and dcmqi further matter because they turn the export discussion from abstract standards alignment into concrete open implementation seams.

### 5. Reproducibility Needs Its Own Seam

BIDS remains relevant as a reproducibility and evaluation scaffold even if it is not the primary clinical transport standard.

## Maintenance Rule

This register should be refreshed when any of the following change materially:

1. regulatory obligations or guidance framing
2. major framework baselines
3. viewer capability assumptions
4. export-standard assumptions

If a source here goes stale, dependent docs should either be refreshed or their language should become more conservative.

If code-license and model-weight terms diverge, dependent docs must describe the narrower effective deployment right rather than the broader repository license.

## Interaction With Other Docs

Use this register together with:

1. `evidence-and-claims-policy.md` for claim class discipline
2. `open-source-rationale.md` for stack choice logic
3. `ecosystem-landscape-march-2026.md` for framework and model strategy
4. `regulatory-positioning.md` for RUO-first posture