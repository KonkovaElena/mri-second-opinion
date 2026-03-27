# Regulatory Positioning

Date: 2026-03-25

## Purpose

This document defines the current regulatory posture for the standalone MRI second-opinion repository and the design controls required to keep the project honest.

It is a positioning and governance document.

It is not legal advice and not a substitute for formal regulatory counsel.

## Current Product Position

The standalone repository should currently be positioned as:

1. research use only
2. clinician-in-the-loop workflow software, not autonomous diagnosis
3. open-source engineering baseline, not a cleared or CE-marked medical device

That means public docs, demos, screenshots, and exports must not imply clinical authorization, safety validation, or unsupervised diagnostic use.

## Why RUO Is The Correct Current Posture

RUO-first is the defensible posture because the repository does not yet demonstrate:

1. complete workflow implementation closure
2. clinical validation on representative deployment cohorts
3. formal quality-management evidence for regulated release
4. regulatory submission documentation package readiness

The repository can still be designed so that later regulatory work is not blocked by architecture shortcuts.

That is the intended meaning of regulatory-ready by design.

## Regulatory-Ready By Design Controls

Even in RUO mode, the product should preserve these controls:

1. explicit intended-use statement and non-clinical labeling
2. traceable workflow and model provenance per case
3. versioned models, thresholds, and report templates
4. durable audit trail for routing, operator actions, and fallbacks
5. human-review gate before final report release
6. documented QC acceptance and reject logic
7. privacy and de-identification controls before off-boundary data transfer
8. validation folders and metrics that can later support formal performance claims

## US Context

The FDA continues to treat AI-enabled medical devices as regulated medical-device software when they are marketed for intended uses that require safety and effectiveness review.

Official FDA surfaces relevant to this repo include:

1. the FDA AI-enabled medical devices listing, updated as a public transparency resource
2. the January 2025 draft guidance `Artificial Intelligence-Enabled Device Software Functions: Lifecycle Management and Marketing Submission Recommendations`

The 2025 draft guidance is important because it frames AI-enabled device documentation around total product lifecycle risk management rather than around a one-time model benchmark only.

That reinforces the need for traceability, human oversight, documentation quality, and validation discipline in this repository even before any formal submission path exists.

It also means active docs should avoid anchoring regulatory posture to one frozen count of FDA-listed AI-enabled devices. Public list totals change over time and can vary with snapshot date and categorization method, so date-stamped references are safer than headline counts.

## EU Context

The EU AI Act remains a risk-based regulatory framework.

Official European Commission materials continue to describe high-risk AI systems as subject to obligations such as:

1. risk management
2. traceability and logging
3. documentation sufficient for conformity assessment
4. appropriate human oversight
5. robustness, cybersecurity, and accuracy expectations

For a medical-imaging second-opinion product, the practical implication is simple: if the product later moves from research framing to real clinical intended use, compliance obligations become a core engineering concern rather than a packaging step at the end.

## Proposal-Status Discipline

Public discussion around EU implementation timing, Digital Omnibus changes, or medical-device-specific carve-out proposals should be treated as proposal-level material until formally adopted.

For this repository, that means:

1. proposal-level regulatory analyses may inform roadmap thinking
2. proposal-level analyses must not be described as binding current law
3. active docs should distinguish clearly between effective obligations and possible future simplifications or delays

This includes proposal packages sometimes described as Digital Omnibus or sector-specific relief discussions. Until an official change is adopted, those items are roadmap context only.

## Engineering Consequence

The standalone product should therefore optimize for two truths at once:

1. today it must speak honestly as RUO software
2. tomorrow it should not require a total re-architecture to support regulated evidence generation

This is why the repository should preserve:

1. case-level provenance
2. operator review checkpoints
3. explicit issue and fallback logs
4. stable report schemas
5. versioned workflow definitions

## Pathway Planning Work Item

The repository should eventually maintain a dedicated regulatory-pathway work item before any shift away from RUO positioning.

That work item should cover at minimum:

1. intended-use definition precise enough to bound the product claim surface
2. human-oversight and review semantics
3. software-update and model-change policy
4. validation dataset and performance-evidence plan
5. pathway selection analysis for the target jurisdictions rather than assuming one universal route

For the EU and US, that means the future team should explicitly evaluate the applicable MDR classification and the relevant FDA submission route instead of treating certification as a packaging exercise at the end.

## Mandatory Non-Claims

The project must not claim, unless separately proven and documented:

1. FDA clearance or authorization
2. CE marking or MDR conformity
3. clinical effectiveness in patient-care deployment
4. autonomous diagnostic capability
5. production readiness for hospital decision support

## Mandatory RUO Disclaimer Surface

Every operator-facing export path should have a clear disclaimer surface.

The baseline wording should remain equivalent to the following intent:

1. for research use only
2. not a medical device
3. not validated for clinical decision making
4. all findings require independent review by a qualified clinician

The exact text can evolve, but the meaning must not weaken.

## Interaction With Other Docs

Use this document together with:

1. `open-source-rationale.md` for stack choice rationale
2. `evidence-and-claims-policy.md` for claim discipline
3. `../architecture/overview.md` for human-review and workflow boundaries
4. `../roadmap-and-validation.md` for the release path from engineering baseline toward stronger evidence