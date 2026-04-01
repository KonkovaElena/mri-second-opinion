# Contributing To MRI Second Opinion

## Contribution Scope

This repository is intended to become a focused MRI-only second-opinion workflow project.

Contributions should preserve that scope.

## Before You Change Anything

Read these files first:

1. `README.md`
2. `docs/scope-lock.md`
3. `docs/status-model.md`
4. `docs/api-scope.md`
5. `docs/architecture/overview.md`
6. `docs/launch-readiness-checklist.md`
7. `docs/releases/github-publication-playbook.md`
8. `SUPPORT.md`
9. `GOVERNANCE.md`

## Ground Rules

1. keep MRI-only scope for v1
2. do not introduce autonomous diagnosis claims
3. keep clinician review mandatory in product language and workflow assumptions
4. do not add public API or workflow states that contradict the locked docs without updating those docs together
5. do not claim launch readiness without evidence added to `docs/verification/launch-evidence-index.md`

## Preferred Contribution Order

1. align docs and boundary assumptions first
2. add or change runtime behavior second
3. update evidence and release verdict last

## Pull Request Expectations

Every meaningful PR should explain:

1. what boundary or behavior changed
2. which docs were updated to stay truthful
3. what evidence exists for the new claim or behavior

## Data Safety

1. do not commit PHI
2. use synthetic MRI-safe demo inputs for public examples
3. do not attach real patient studies to issues or pull requests