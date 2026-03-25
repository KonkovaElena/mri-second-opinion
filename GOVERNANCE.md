# Governance

## Current governance model

This repository is currently maintained as a focused, conservative MRI-only open-source project in preparation for public GitHub publication.

There is no formal steering committee yet.

Current operating model:

1. scope is governed by `docs/scope-lock.md`
2. publication and launch claims are governed by `docs/releases/v1-go-no-go.md`
3. architectural direction is governed by the documents under `docs/architecture/`
4. contribution expectations are governed by `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`
5. GitHub publication mechanics are governed by `docs/releases/github-publication-playbook.md` and `docs/releases/github-go-live-checklist.md`

## Decision rules

Changes should prefer:

1. truthful documentation over aspirational claims
2. narrow MRI-only scope over platform expansion
3. clinician-in-the-loop workflow assumptions over autonomy claims
4. verifiable runtime behavior over design-only promises

## Change control

Changes that alter public workflow semantics, status vocabulary, or readiness claims should update the corresponding docs in the same change.

At minimum, that means updating the relevant files in:

1. `README.md`
2. `docs/api-scope.md`
3. `docs/status-model.md`
4. `docs/launch-readiness-checklist.md`
5. `docs/verification/launch-evidence-index.md`

## Future governance

If the project gains multiple active maintainers, this file should be extended with:

1. maintainer roles
2. review and merge rules
3. release ownership
4. security ownership
5. deprecation policy