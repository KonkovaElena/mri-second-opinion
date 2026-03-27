# Bias Analysis Framework

Date: 2026-03-27

## Purpose

This document defines the minimum analysis framework the repository should use before making stronger performance, safety, or utility claims about MRI workflow outputs.

It is a planning and reporting contract.

It is not evidence that a completed bias study already exists.

## Why This Matters

MRI workflow performance can degrade for reasons that are hidden by one blended benchmark table.

Important sources of variation include:

1. scanner vendor
2. field strength
3. protocol completeness
4. sequence quality and motion burden
5. site-specific preprocessing or naming conventions
6. population and pathology composition

If those factors are not separated, the repository risks making cleaner claims than the evidence supports.

## Current Repository Status

The standalone repository is still RUO and workflow-first.

Therefore the current requirement is to maintain the analysis contract now, so later evaluation work has a stable frame.

Current status:

1. framework defined
2. no completed subgroup study claimed here
3. no clinical-effectiveness claim authorized by this document

## Units Of Analysis

At minimum, future evaluation bundles should stratify performance where metadata and study governance permit it.

Primary strata:

1. scanner vendor
2. field strength
3. protocol completeness and missing-sequence pattern
4. acquisition quality class such as pass, warn, or reject
5. site or cohort source when multi-site evaluation begins

Secondary strata when ethically and legally appropriate:

1. age bands
2. sex or sex-proxy metadata if relevant to the workflow family
3. pathology family or lesion burden class

## Metrics Discipline

The exact metrics will vary by workflow family, but the reporting contract should stay consistent.

Each evaluation bundle should distinguish:

1. core task metrics such as segmentation overlap, count error, or volumetric error
2. workflow metrics such as reject rate, fallback rate, or missing-sequence downgrade rate
3. subgroup deltas between strata rather than only pooled means
4. uncertainty or confidence-handling behavior where the workflow exposes it

## Reporting Rules

Any future bias or subgroup report should include:

1. dataset and cohort description
2. inclusion and exclusion rules
3. metadata completeness limits
4. stratum definitions
5. per-stratum metric tables
6. interpretation of materially worse strata
7. explicit non-claims where data is sparse or non-representative

## Trigger For Escalation

Before stronger product language is used, escalate if any of the following occur.

1. one important stratum is underrepresented or missing
2. pooled metrics hide a materially worse subgroup result
3. protocol incompleteness drives large output instability
4. cross-site or cross-scanner generalization is assumed rather than measured

## Data Governance Guardrail

This repository should not encourage public upload of protected clinical data just to satisfy subgroup analysis.

Bias evaluation should be performed on governed datasets with explicit permission and documented cohort properties.

Public repository materials may summarize the framework and later aggregate results, but not bypass privacy or cohort-governance requirements.

## Interaction With Other Docs

Use this document together with:

1. `regulatory-positioning.md` for RUO boundary discipline
2. `../roadmap-and-validation.md` for the validation pyramid and scanner/protocol matrix expectations
3. `evidence-and-claims-policy.md` for claim classification rules
4. `../regulatory/pms-plan.md` for how field signals should later feed surveillance and CAPA-style review