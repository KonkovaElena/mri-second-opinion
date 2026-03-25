# Reasoning Agent Safety And Validation

Date: 2026-03-25

## Purpose

This document defines the safety envelope required if the MRI orchestrator ever uses an LLM or VLM-assisted reasoning layer to propose workflow graphs.

It exists because adaptive planning is architecturally attractive but introduces reproducibility, validation, and regulatory risk.

It is a target-operating reference.

It is not proof that the current repository already implements every safeguard described below.

## Governing Rule

The reasoning agent is a proposal surface only.

The orchestrator, policy engine, and structured contracts remain the authority surfaces.

## Why This Matters

If a planner silently omits a required branch, invents an invalid dependency, or produces different plans for materially identical inputs without an audit trail, the system becomes unsafe and hard to validate.

For this repository, that means adaptive planning must be fenced by deterministic controls before it can become more than a research seam.

## Safety Envelope

The minimum safety envelope has six layers.

### 1. Normalized input only

The planner should receive only:

1. normalized study context
2. package registry snapshot
3. operator-entered intent where available
4. policy profile

It should not infer directly from raw free-text logs, ad hoc file names, or hidden viewer state.

### 2. Structured output only

The planner must emit a plan envelope candidate as structured data.

It should not emit free-form clinical prose as the execution authority.

### 3. Deterministic validation layer

Every candidate plan should be validated before execution.

The validator must check at minimum:

1. the selected workflow family exists
2. the selected package is registered and versioned
3. required branches for that family are present
4. forbidden branches are absent when policy blocks them
5. dependencies form a valid DAG
6. required artifacts for review and report generation can still be satisfied
7. blocked sequence or QC states do not leak into allowed quantitative claims

### 4. Deterministic fallback DAGs

Each major workflow family should preserve a static fallback DAG.

The fallback DAG is used when:

1. the planner fails
2. the planner output is invalid
3. reproducibility mode forbids adaptive planning
4. the deployment posture demands the most conservative path

At minimum, the first repository wave should preserve fallback DAGs for:

1. brain structural
2. brain lesion
3. brain tumor
4. spine

### 5. Reproducibility mode

The system should define a reproducibility mode in which adaptive planning is tightly bounded.

That mode should pin:

1. planner model identifier
2. planner prompt version
3. registry snapshot version
4. low-temperature or equivalent deterministic-generation settings where supported
5. validation-rule version

The practical goal is not to promise mathematical determinism from every model.

The goal is to make any variability visible, bounded, and reviewable.

### 6. Canonical scenario tests

The planner layer should be evaluated against a fixed scenario pack.

Each scenario should include:

1. input study context
2. expected workflow family
3. expected required branches
4. expected blocked branches
5. expected downgrade behavior where applicable

The system should not be described as planner-ready until those scenarios can be replayed repeatedly with stable outcomes or clearly bounded variance.

## Validation Taxonomy

The planner path should be validated at four layers.

| Layer | Question | Minimum proof |
|---|---|---|
| Schema validation | Is the candidate plan structurally valid? | plan-envelope schema pass |
| Policy validation | Is the plan medically and operationally allowed? | gate results with no unresolved blockers |
| Scenario validation | Does the planner behave acceptably on canonical scenarios? | scenario pack with expected outcomes |
| Runtime validation | Did the executed branches match the approved plan? | plan-to-runtime provenance comparison |

## Review And Override

Weak-confidence or unusual cases should not force silent planner autonomy.

The system should support:

1. operator review-required state
2. human override with provenance
3. explicit fallback to static DAG
4. visible rationale for why the override was needed

## Adaptive Planning Boundaries

The planner may help decide:

1. which eligible package to prefer
2. whether optional screening or enhancement branches are worth running
3. how to order non-critical steps under compute pressure

The planner must not be the sole authority for:

1. declaring clinical findings
2. suppressing required safety or QC steps
3. bypassing review requirements
4. inventing unsupported export states

## Runtime Budget Rule

Adaptive planning must not create unbounded latency drift.

For the first product slice:

1. reasoning overhead should be measured separately from worker execution
2. runtime claims must come from end-to-end profiling, not architecture tables alone
3. planner fallback should remain available when adaptive orchestration would violate latency or reproducibility budgets

## Uncertainty Strategy Rule

Uncertainty should not default to the most expensive path for every case.

The safer design is an adaptive budget:

1. no uncertainty branch when the package does not support it
2. a light uncertainty pass for ordinary cases
3. a deeper uncertainty pass only when early variability or disagreement signals cross a defined threshold

This matters because blanket Monte Carlo-style repeated inference can dominate the wall-clock budget.

## Deployment Rule

The MVP should not depend on both a Prefect-centric runtime and a Kaapana or Airflow-centric runtime at the same time.

Use one active orchestration path per deployment posture.

Keep the others as architectural references until a real need justifies the extra operational surface.

## Interaction With Other Docs

Use this document together with:

1. `orchestrator-control-plane.md`
2. `orchestrator-reference-contracts.md`
3. `reference-workflow-routing.md`
4. `neuro-first-mvp-slice.md`
5. `../academic/model-licensing-and-deployment-gates.md`