# First Public Announcement Draft

Date: 2026-04-01

## Purpose

This draft is the starting point for the first public announcement of MRI Second Opinion.

It is intentionally conservative.

Use it only after the repository is publicly reachable and the hosted workflows have passed.

## Suggested short announcement

MRI Second Opinion is now publicly available on GitHub.

This repository is an open-source, clinician-in-the-loop MRI workflow system: intake, QC, AI-assisted draft generation, mandatory clinician review, finalization, delivery, and interoperable reporting.

Current public baseline includes a standalone TypeScript API, a built-in review workbench, a Python worker, local durable workflow rails, and explicit evidence and claim-boundary docs.

It is still research-use-only, not clinically validated, not launch-ready for patient care, and not an autonomous diagnostic platform.

Current public baseline includes:

1. standalone install, build, and local test path
2. workflow API for case intake, review, finalization, report retrieval, artifact access, operations summary, and delivery retry
3. built-in review workbench for queue and report handling
4. Python worker with inference and delivery stages plus HMAC-protected dispatch, heartbeat, callback, and failure paths
5. local durable workflow state via SQLite plus PostgreSQL bootstrap and persistence seams
6. interoperable report exports for DICOM SR and FHIR R4 DiagnosticReport
7. explicit readiness, evidence, and claim-boundary docs

What is not included yet:

1. full Orthanc, DICOMweb, or PACS integration
2. full OHIF-backed viewer truth beyond the built-in review workbench
3. hosted or distributed worker deployment proof
4. binary DICOM Part-10 export closure
5. clinical validation and launch-ready operational evidence

If you want to evaluate or contribute, start with:

1. `README.md`
2. `docs/releases/github-publication-playbook.md`
3. `docs/releases/v1-go-no-go.md`
4. `docs/verification/launch-evidence-index.md`

## Suggested longer announcement

MRI Second Opinion is now public as a focused open-source MRI workflow repository.

The project is being published conservatively: it exposes a verified workflow API, a built-in review workbench, a Python worker, local durable workflow rails, interoperable reporting surfaces, and governed evidence docs, while keeping launch-ready, clinical-ready, and production-ready claims closed. The current repository-content verdict is `PUBLIC_GITHUB_READY`.

The intent of this public release is to make the current baseline inspectable, testable, and discussable without overstating maturity. The repository should be read as a clinician-in-the-loop workflow system around AI, not as a production-ready clinical deployment or an autonomous MRI-reading product.

Research-informed architectural direction should not be confused with implemented runtime completeness.

Contributors and reviewers should use the governed publication and evidence docs rather than infer readiness from architecture intent alone.

## Release-channel notes

### For GitHub release notes

Keep the opening paragraph short and use the short announcement.

### For Discussions or community posts

Use the longer announcement and include the "what is not included yet" list.

### For social posts

Do not claim launch readiness, clinical validation, or autonomous diagnostic capability.

Do not imply that full PACS or DICOMweb integration, a production imaging viewer stack, or hospital-ready operations already exist.

## Do not publish this draft unchanged if any of these are false

1. the repository is not yet public
2. hosted CI has not passed
3. the README no longer matches current repo truth
4. the linked docs are stale
