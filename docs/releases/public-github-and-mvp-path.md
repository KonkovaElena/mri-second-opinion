# Public GitHub And MVP Path

Date: 2026-03-25

## Purpose

This document separates two goals that are often confused.

1. publishing the repository publicly on GitHub without overstating maturity
2. reaching an internally credible MVP path for the first real workflow slice

Both matter.

They do not require the same evidence on the same day.

## Governing Rule

Public publication may happen before full MVP closure.

Public launch claims may not.

Repository-level verdicts remain governed by `v1-go-no-go.md` and the full launch checklist.

## Current Position

The current repository is best understood as:

1. public-repo-preparation in progress
2. wave1 workflow API baseline verified locally
3. workflow MVP not yet closed
4. verdict still `NOT_READY`

## Track A: Public GitHub Readiness

The repository is ready for broad public publication only when outsiders can clone it, build it, understand its limits, and avoid being misled.

That means Track A focuses on:

1. truthful README and docs
2. standalone install and build proof
3. minimal repository hygiene
4. explicit non-goals and RUO posture
5. no hidden dependence on internal parent-project runtime pieces
6. coherent GitHub-facing metadata and repository-card language

### Minimum evidence for Track A

1. passing standalone GitHub Actions install and build workflow
2. root governance files present and externally readable
3. launch-readiness docs consistent with actual runtime state
4. public docs free of parent-platform assumptions that do not apply to the standalone subtree
5. one current evidence index showing what is real and what is still only planned
6. support, governance, and contributor-intake surfaces present without invented ownership claims
7. dependency maintenance posture declared for the standalone repository
8. a documented GitHub publication kit covering description, topics, social preview, and About-page posture

### Track A exit condition

Track A is complete when the repository can be published publicly on GitHub without misleading outsiders about runtime completeness, workflow maturity, or current intended use.

This is a publication-safety state, not by itself a higher repository verdict.

Primary planning references:

1. `../launch-readiness-checklist.md`
2. `github-publication-playbook.md`

## Track B: Internal MVP Closure

The MVP track is stricter.

It requires one end-to-end bounded workflow slice that actually works.

For this repository, that slice remains neuro-first, clinician-reviewed, and synthetic-demo-friendly.

Track B focuses on:

1. workflow API closure
2. durable state and restart-safe truth
3. queue and operations visibility
4. review and finalize loop
5. report preview
6. truthful synthetic demo path

### Minimum evidence for Track B

1. one synthetic case can move through intake, processing, review, finalize, and report retrieval
2. the state survives restart where required by the checklist
3. the UI or equivalent review surface exposes queue, case detail, evidence, and report preview
4. the demo script matches the real system
5. the launch evidence index links to concrete artifacts for each gate

### Track B exit condition

Track B is complete when the repository can truthfully claim `INTERNAL_DEMO_READY` for the neuro-first slice.

## Recommended Sequence

Do the tracks in this order.

1. finish Track A enough to publish safely on GitHub
2. keep the verdict conservative
3. execute Track B work packages until one real demo slice closes
4. only then revisit a higher product-readiness verdict

## Execution Rule

Do not block GitHub publication on every future export, every workflow family, or every later-phase architecture seam.

Do block it on anything that would mislead external readers about:

1. what builds today
2. what runs today
3. what is only design intent
4. what remains RUO and clinician-reviewed

## Interaction With Other Docs

Use this document together with:

1. `v1-go-no-go.md`
2. `../launch-readiness-checklist.md`
3. `../verification/launch-evidence-index.md`
4. `../architecture/mvp-work-package-map.md`
5. `../architecture/neuro-first-mvp-slice.md`
6. `github-publication-playbook.md`
7. `github-go-live-checklist.md`
8. `github-metadata-copy.md`
9. `github-settings-worksheet.md`
10. `github-live-publication-sequence.md`