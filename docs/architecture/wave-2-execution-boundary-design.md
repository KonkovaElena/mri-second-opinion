# Wave 2 Execution Boundary Design

Date: 2026-03-29

## Purpose

This document defines the first implementation wave after the hyperdeep audit.

Its purpose is to convert the current truthful control-plane baseline into a minimally trust-separated execution boundary without pretending that the full worker, queue, and object-store planes already exist.

## Status 2026-03-29

The full local execution-truth slice of Wave 2A is now closed in the current `main` history.

Authority-doc reconciliation and hosted Wave 1.5 closure are now recorded on `04cb0a57d1e64f8a5cf03a22b4a5c60d37dffc3a`.

The repository now proves:

1. internal-route bearer-token protection for worker-facing mutations
2. durable package, plan-envelope, and artifact-manifest state on case reads
3. restart-safe inference and delivery queue state
4. hosted `ci` and `docs-governance` proof for the latest fully hosted-validated head `04cb0a57d1e64f8a5cf03a22b4a5c60d37dffc3a`
5. HMAC-authenticated `/api/internal/dispatch/claim` and `/api/internal/dispatch/heartbeat` routes that return or renew a bounded execution lease
6. local file-backed artifact persistence plus public artifact retrieval on the earlier runtime-bearing head `f6021ecdb45f4ecf5aece2c52cc0e6f462361d49`, which remains part of the current `main` history

Wave 2A no longer needs another artifact or retrieval implementation slice. The bounded Wave 2B compute seam has now landed in the current repository state, so the next runtime wave after the current docs and evidence reconciliation is Wave 3A archive and viewer truth.

The minimal additive contract implemented in this slice is:

1. `/api/internal/inference-jobs/claim-next` still returns the durable `job` envelope for compatibility
2. the same response now also returns an `execution` block with claim metadata, selected package manifest, dispatch profile, required artifacts, and planned object-store persistence targets
3. the persistence targets remain declarative only; they do not claim that MinIO, S3, or another object store is already wired

This keeps the current single-process runtime honest while moving the worker handoff surface onto stable, testable contracts.

## Problem Statement

The current repository already proves:

1. durable case lifecycle state
2. queue and operations transcript state
3. review and finalize flow
4. report preview and delivery retry flow
5. operator-visible contract surfaces such as plan envelopes and evidence cards
6. internal-route bearer-token protection for internal mutation endpoints
7. persisted workflow-package, structural execution, and artifact-manifest surfaces on case detail reads

The current repository does not yet prove:

1. that internal execution mutations are trusted and bounded
2. that worker-produced state is separated from public API callers
3. that package identity and execution provenance are anchored to a runtime execution boundary instead of in-process synthesis only

## Wave Goal

Wave 2 should establish an explicit execution boundary.

The current implemented slice is not a full workflow engine.

The current implemented slice is:

1. explicit internal-callback authentication
2. worker-facing package declaration surface
3. a durable execution envelope that can later be handed to a real worker process
4. a typed artifact manifest promoted to first-class case state that can later map to object-store-backed durability

## Scope For This First Wave 2 Slice

Implemented now:

1. a shared-secret boundary for internal ingest, inference callback, and delivery callback routes
2. configuration support for the internal callback secret
3. tests proving that public callers cannot mutate internal workflow state without the secret
4. persisted workflow-package manifest for the current structural package
5. persisted structural execution envelope on case detail reads
6. persisted typed artifact manifest on case detail reads
7. documentation updates describing the new boundary honestly
8. local file-backed persistence for bounded artifact payloads accepted by the inference callback
9. public artifact retrieval via `GET /api/cases/:caseId/artifacts/:artifactId` plus retrieval URLs on case-detail and report surfaces

Do not implement yet:

1. a real external worker process
2. Redis-backed queueing
3. MinIO or object-store-backed artifacts
4. Orthanc integration
5. OHIF integration

## Why This Slice First

This is the narrowest change that materially improves architectural truth.

It upgrades the runtime from “workflow-capable control plane with openly reachable internal mutation routes” to “workflow-capable control plane with a minimal trusted worker/integration boundary.”

That is a real system-quality improvement, not cosmetic hardening.

## Security Posture

The internal routes remain part of the same process for now.

That is acceptable for the current baseline if they require an explicit secret and fail closed when the secret is configured.

The design rules are:

1. public routes remain unchanged
2. internal routes require an authorization surface separate from the public API
3. the implementation must be simple enough to migrate later to a separate worker or gateway
4. when no secret is configured, the runtime should stay explicit about insecure local mode rather than silently pretending to be protected

## Authentication Design

Use a single shared secret provided through configuration.

Recommended transport:

1. `Authorization: Bearer <secret>`

Reasons:

1. smallest implementation surface
2. easy to pass from a future worker process
3. easy to validate in tests
4. easy to replace later with stronger trust surfaces such as signed tokens or service identity

## Runtime Rules

1. If `MRI_INTERNAL_API_TOKEN` is configured, all internal routes must require a matching bearer token.
2. If the token is missing or invalid, the route must return `401`.
3. Public routes must never require this token.
4. The root surface should expose whether internal-route authentication is enabled as runtime metadata, but should not reveal the secret itself.

## Configuration Contract

Add one new config field:

1. `internalApiToken?: string`

Behavior:

1. undefined means local insecure mode
2. non-empty string means internal auth is enforced

## Test Plan

Tests must prove:

1. internal routes still work when no token is configured
2. internal routes reject unauthenticated requests when a token is configured
3. internal routes reject incorrect tokens
4. internal routes accept the correct bearer token
5. public routes remain unaffected

## Success Criteria

This slice is complete when:

1. internal callback routes fail closed under configured token mode
2. tests cover allow and deny paths
3. README and verification docs describe the boundary honestly
4. docs closure rail and preflight pass

## Follow-On Step

The Wave 2A execution-truth closure described by this design has already landed, and the repository now also carries a bounded Wave 2B worker handoff and compute plane.

Subsequent work should treat this document as Wave 2 design history and build Wave 3A archive/viewer truth on top of the existing dispatch, callback, and artifact contracts.

The key truth boundary is now explicit:

1. artifact manifest state is read from durable case state, not reconstructed only as report decoration
2. report responses can stay stable while the runtime moves toward real worker and object-store boundaries