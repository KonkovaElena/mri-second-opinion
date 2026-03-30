# MVP Work Package Map

Date: 2026-03-29

## Purpose

This document converts the neuro-first MVP target into implementation-sized work packages tied directly to launch evidence.

It is an execution map, not a claim that the packages below are already complete.

## Governing Rule

Every work package must leave behind both code and evidence.

If a package changes runtime behavior but produces no verification artifact, the MVP is still not ready.

## MVP Slice Restatement

The first target remains a bounded neuro structural workflow with:

1. Orthanc intake
2. durable case record
3. QC plus structural processing path
4. reviewable evidence surface
5. report preview
6. clinician-in-the-loop finalize path

## Work Package Set

### WP-1 Case Intake And State Backbone

Goal:

Create the durable case lifecycle foundation.

Primary outputs:

1. case creation path
2. case list path
3. case detail path
4. state model persisted in PostgreSQL
5. restart-safe migration flow

Evidence required:

1. route inventory
2. API contract tests for create, list, and detail
3. migration log from clean database
4. restart persistence proof for case records

Launch gates advanced:

1. Backend Workflow Closure
2. Durable Workflow Truth

### WP-2 Queue, Dispatch, And Operations Summary

Goal:

Make execution state visible and durable rather than implicit.

Primary outputs:

1. queue-backed dispatch for bounded workflow stages
2. delivery and retry state persistence
3. operations summary endpoint
4. rebuildable queue and operations read models

Evidence required:

1. queue-state transcript
2. retry-history proof
3. operations-summary verification
4. degraded-path and retry-path test output

Launch gates advanced:

1. Backend Workflow Closure
2. Durable Workflow Truth

### WP-3 Neuro Structural Worker Path

Goal:

Close one real processing branch for the neuro-first slice.

Current execution note 2026-03-29:

1. Wave 2A boundary truth is already in place and publicly evidenced
2. Wave 2B contract layering on inference-job claim responses and HMAC-protected dispatch lease closure are already in place
3. local file-backed artifact persistence and public artifact retrieval are already in place on the current pushed head
4. WP-3 is now locally closed on a bounded compute seam: the Python worker can preserve the callback and artifact contract while executing either a metadata-fallback path or one bounded voxel-backed pass
5. the next smallest honest step is WP-4 archive/viewer truth while keeping the current worker callback and artifact contract stable

Primary outputs:

1. study-context creation
2. QC summary artifact
3. bounded structural-processing path
4. structured findings payload
5. evidence-card assembly

Evidence required:

1. synthetic or benchmark-safe workflow transcript
2. sample plan envelope
3. sample QC artifact
4. sample findings payload
5. measured runtime profile on named hardware

Launch gates advanced:

1. Backend Workflow Closure
2. Demo Credibility
3. Documentation Honesty

### WP-4 Review, Finalize, And Report Preview

Goal:

Make the clinician-in-the-loop release loop real.

Primary outputs:

1. review action endpoint
2. finalize endpoint
3. report retrieval endpoint
4. UI or equivalent operator surface for case review and report preview

Evidence required:

1. review-state transcript
2. finalize transcript
3. report preview artifact
4. screenshots for queue, case detail, review, and report preview

Launch gates advanced:

1. Backend Workflow Closure
2. Frontend Closure
3. Demo Credibility

### WP-5 Public GitHub Publication Proof

Goal:

Make the standalone subtree safe for public external consumption.

Primary outputs:

1. passing GitHub Actions install and build workflow
2. current root governance files
3. truthful public docs and launch verdict
4. explicit evidence index for publication state

Evidence required:

1. CI success proof
2. workflow review note
3. public-repository hygiene review
4. README-to-runtime honesty review

Launch gates advanced:

1. Repository Independence
2. Public Repository Hygiene
3. Documentation Honesty

### WP-6 Synthetic Demo Closure

Goal:

Produce the first truthful end-to-end MVP demo for the neuro-first path.

Primary outputs:

1. synthetic demo input package
2. repeatable setup instructions
3. completed walk-through from intake to reviewed report
4. screenshot bundle and transcript

Evidence required:

1. demo transcript
2. setup transcript
3. screenshot bundle
4. operator-step log for any remaining manual actions

Launch gates advanced:

1. Demo Credibility
2. Internal Demo readiness path

## Recommended Order

Execute the MVP path in this order.

1. WP-5 Public GitHub Publication Proof
2. WP-1 Case Intake And State Backbone
3. WP-2 Queue, Dispatch, And Operations Summary
4. WP-3 Neuro Structural Worker Path
5. WP-4 Review, Finalize, And Report Preview
6. WP-6 Synthetic Demo Closure

## Why This Order

1. GitHub publication is blocked mainly by proof and hygiene, not by the full workflow
2. the workflow cannot be demonstrated honestly until state and queue truth exist
3. review and report preview should be layered after one real processing branch exists
4. the demo should be the last packaging step, not the first source of truth

## Evidence Mapping Rule

When a work package is closed, update:

1. `../verification/launch-evidence-index.md`
2. `../launch-readiness-checklist.md`
3. `../releases/v1-go-no-go.md` when a verdict actually changes

## Interaction With Other Docs

Use this document together with:

1. `neuro-first-mvp-slice.md`
2. `orchestrator-reference-contracts.md`
3. `../verification/launch-evidence-index.md`
4. `../releases/public-github-and-mvp-path.md`
5. `../launch-readiness-checklist.md`