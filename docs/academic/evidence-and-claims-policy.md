# Evidence And Claims Policy

Date: 2026-03-24

## Purpose

This document defines how MRI Second Opinion should translate academic evidence, engineering work, and runtime verification into public-facing claims.

Its purpose is to prevent three failure modes:

1. treating design intent as implementation proof
2. treating research familiarity as product validation
3. treating demo capability as clinical readiness

## Claim Classes

All external statements about the repository should fit one of these classes.

## 1. Implemented Claim

Definition:

A statement about behavior that is backed by runnable repository state or automated verification.

Examples:

1. a route exists and is covered by verification
2. a workflow state is emitted by runtime payloads
3. a governance file exists in the repository root

Minimum evidence:

1. file state plus direct verification
2. or runtime proof
3. or CI proof

## 2. Design Claim

Definition:

A statement about intended architecture or planned product behavior that is not yet proven in runnable standalone form.

Examples:

1. intended seven-node topology
2. planned review workflow surfaces
3. target PostgreSQL plus Redis control plane

Required labeling:

Design claims must be written as target state, not as present-tense implementation truth.

## 3. Research-Informed Claim

Definition:

A statement justified by March 2026 external evidence, domain standards, or widely used open-source ecosystem practice, but not yet product-verified in this repository.

Examples:

1. clinician review should remain mandatory
2. DICOM should remain the interoperability boundary
3. sequence-aware workflow design is safer than sequence-agnostic claims

Required labeling:

Research-informed claims must not be represented as standalone runtime evidence.

## 4. Excluded Claim

Definition:

A statement the repository must explicitly avoid making.

Examples:

1. regulatory clearance
2. autonomous diagnosis
3. clinically validated model performance
4. production-grade operational hardening

## Evidence Hierarchy

When claims conflict, trust this hierarchy from strongest to weakest:

1. runtime proof
2. automated verification in CI or local validated runs
3. direct file state
4. coherent design documentation
5. external academic or industry evidence
6. reasoning alone

The repository should never elevate a weaker evidence tier over a stronger conflicting tier.

## Source Register Discipline

Research-informed claims should not float without a visible source pack.

When a public statement depends on current regulatory, standards, or ecosystem facts, the supporting sources should be anchored in:

1. `external-evidence-register-march-2026.md`
2. the most specific canonical doc that consumes that evidence

This keeps architectural language tied to named sources instead of to vague "industry best practice" phrasing.

## Public Writing Rules

1. if behavior is not runtime-backed, describe it as target state or planned scope
2. if evidence is architectural only, do not imply workflow completion
3. if evidence is academic only, do not imply product validation
4. if evidence is demo-only, do not imply clinical deployment readiness
5. all release-status language must agree with `docs/releases/v1-go-no-go.md`

## License-Surface Discipline

Public docs must not collapse source-code licensing and model-weight licensing into one assumption.

For model-based systems, verify separately:

1. repository code license
2. model-card or weight-distribution terms
3. dataset-use constraints where they materially affect deployment claims

If those surfaces diverge, public wording must follow the narrower effective right.

## Product-Specific Guardrails

For MRI Second Opinion, the following are mandatory:

1. clinician-in-the-loop language remains explicit
2. MRI-only scope remains explicit in v1 docs
3. synthetic-only public demo assumption remains explicit until proven otherwise
4. workflow-state vocabulary must follow `../status-model.md`
5. public API vocabulary must follow `../api-scope.md`

## Review Questions

Before adding a new public statement, ask:

1. is this implemented, designed, research-informed, or excluded?
2. what is the strongest evidence tier supporting it?
3. does the wording overstate the actual repository state?
4. would an external reader confuse this for clinical validation or production readiness?

## Current Repository Position

As of this document version, MRI Second Opinion is best described as:

1. an academically grounded MRI-only workflow system
2. a public-facing standalone repository with runnable local workflow surfaces
3. internal-demo-capable on the bounded synthetic path
4. `PUBLIC_GITHUB_READY` for conservative repository publication
5. not launch-ready, clinical-ready, or production-ready