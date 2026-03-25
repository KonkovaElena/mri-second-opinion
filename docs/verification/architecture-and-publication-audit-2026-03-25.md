# MRI Standalone Architecture And Publication Audit

Date: 2026-03-25

## Purpose

This note records a subtree-local audit of two questions:

1. how the MRI standalone architecture fits its own stated goals
2. how ready the subtree is for conservative public GitHub publication

## Executive Summary

The current MRI subtree is aligned with a narrow wave1 baseline, not with the full target architecture.

That is acceptable for public-preparation work as long as the docs keep distinguishing:

1. implemented local baseline
2. target open-source deployment architecture
3. still-missing MVP closure

Relative to the full MicroPhoenix 10-layer SSOT, MRI Standalone is still intentionally simpler, but it is no longer entirely collapsed into one concrete file.

That is reasonable for an extractable subtree, and this continuation wave moves the runtime toward internal seams before adding PostgreSQL, Redis, or worker adapters.

## Comparison To MRI Goals

### What already fits

1. MRI-only scope is explicit
2. clinician-in-the-loop posture is explicit
3. wave1 workflow API exists locally
4. local restart-safe file-backed durability exists
5. release verdict remains conservative

### What does not yet fit

1. the public runtime remains single-process and in-memory-first even though planning and persistence concerns are now split out of the main orchestration file
2. the target stack assumes PostgreSQL, Redis, object storage, Orthanc, worker, and frontend boundaries that do not yet exist in runtime
3. the current durability proof is local-file-based rather than database-backed

## Comparison To MicroPhoenix Architecture

The parent MicroPhoenix platform uses a 10-layer SSOT with strict layer boundaries, DI, protocol separation, and infrastructure adapters.

MRI Standalone does not mirror that architecture yet.

Current posture:

1. HTTP routes still call the orchestration service directly
2. persistence now sits behind a snapshot repository seam
3. workflow planning and report assembly now sit behind a dedicated planning seam
4. there is still no DI-driven or multi-process boundary between API, queueing, and worker execution

Interpretation:

1. this is acceptable for a narrow standalone extraction baseline
2. it is not yet a clean-layer slice of full MicroPhoenix
3. before adding new runtime dependencies, the subtree should split into repository, router-planner, and orchestrator seams

## Publication Readiness Audit

### Good enough now

1. README is conservative
2. LICENSE, SECURITY, and CONTRIBUTING are present
3. API scope and status vocabulary match runtime
4. launch verdict remains `NOT_READY`

### Gaps closed in this audit wave

1. subtree-local evidence chain updated
2. CI now runs tests as well as build
3. docs-governance now rejects parent-only evidence references and broken local markdown links
4. bug-report and pull-request intake templates now exist
5. support and governance files now exist without inventing a fake maintainer committee
6. dependency update automation is now declared with Dependabot

### Remaining blockers

1. hosted CI success evidence still needs to exist on GitHub after publication
2. security reporting still depends on an umbrella contact or repository settings rather than a repo-specific maintainer channel
3. frontend, queue, database, worker, and demo closure are still absent

## Recommended Next Runtime Step

Before adding PostgreSQL or Redis, keep extending the current three-way split instead of growing one concrete service:

1. case repository
2. study-router or workflow-planner
3. workflow-orchestrator service

This continuation wave establishes those seams at an internal module level while preserving the public HTTP contract.