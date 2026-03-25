# Model Licensing And Deployment Gates

Date: 2026-03-25

## Purpose

This document defines how the MRI repository should evaluate whether a model family is suitable for baseline use, research-only use, or exclusion from clinically adjacent product paths.

It exists because repository code openness, model-weight availability, intended-use language, and deployed-use rights do not always align.

## Governing Rule

When licensing or intended-use surfaces disagree, this repository follows the narrower effective deployment right.

## Why This Matters

Several relevant frontier models have open repositories but still restrict intended use to research, reproducibility, or non-clinical use.

That means architectural interest does not automatically translate into deployable baseline status.

## Evaluation Dimensions

Every model family considered by the repository should be checked across five dimensions.

| Dimension | Question |
|---|---|
| Code license | Is the repository code itself open and reusable? |
| Weight access | Are the weights downloadable under deployable terms? |
| Intended use | Does the model card limit use to research or explicitly exclude clinical deployment? |
| Dependency inheritance | Does the model inherit narrower terms from a base model or dataset? |
| Product implication | Can the model be a baseline dependency, or only an optional research seam? |

## Gate Outcomes

Use a closed status set.

1. `baseline-eligible`
2. `baseline-ineligible-research-only`
3. `baseline-ineligible-license-review-needed`
4. `reference-only`
5. `excluded-from-clinical-path`

## Current Model-Family Posture

| Model family | Code surface | Intended-use surface | Recommended repository posture |
|---|---|---|---|
| FastSurfer | active open repository | research-oriented and human-review-bounded | baseline structural reference with RUO wording |
| nnU-Net v2 specialist branches | active open repository | workflow-specific validation still required | baseline specialist path where task evidence exists |
| MedSAM2 | open repository but separate weight terms | model weights restricted to research and education in public card | reference-only or research seam unless deployment rights change |
| BiomedParse v2 | Apache-2.0 repository plus explicit research-and-development-only notice | not intended for clinical decision making | research seam only |
| LLaVA-Med v1.5 | open release with explicit out-of-scope deployed use | not intended for clinical care or clinical decision making | review-assist or offline evaluation only |
| Med42-class clinical LLMs | strong research signal but explicit human-validation and non-clinical posture | not baseline-safe for deployed clinical path | reference-only |

## Adoption Rule

No research-only frontier model should become the only way to complete a baseline workflow.

The repository must preserve a viable baseline path built from components whose deployment posture does not depend on research-only model terms.

## Architecture Consequence

This rule changes system design in four ways.

1. the first trustworthy slice must remain executable without BiomedParse-class or LLaVA-Med-class dependencies
2. foundation-model branches should be documented as optional, review-assist, or research-mode seams when their intended-use language is narrower than the product ambition
3. workflow packages should record code-license and weight-license surfaces separately
4. README and roadmap language should never collapse `open source` into `clinically deployable`

## Manifest Consequence

Every workflow-package manifest should record at minimum:

1. `codeLicense`
2. `weightTerms`
3. `intendedUseProfile`
4. `clinicalPathEligibility`

## Review Questions

Before promoting a model into the baseline path, ask:

1. can this model be used in the intended deployment context under its current public terms?
2. does the model card explicitly exclude clinical or deployed use?
3. does the workflow still function without it?
4. would an outside reader wrongly infer clinical readiness from its inclusion?

## Interaction With Other Docs

Use this document together with:

1. `external-evidence-register-march-2026.md`
2. `evidence-and-claims-policy.md`
3. `../architecture/orchestrator-reference-contracts.md`
4. `../architecture/reasoning-agent-safety-and-validation.md`
5. `../architecture/neuro-first-mvp-slice.md`