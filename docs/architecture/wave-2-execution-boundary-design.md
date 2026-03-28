# Wave 2 Execution Boundary Design

Date: 2026-03-26

## Purpose

This document defines the first implementation wave after the hyperdeep audit.

Its purpose is to convert the current truthful control-plane baseline into a minimally trust-separated execution boundary without pretending that the full worker, queue, and object-store planes already exist.

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

After this slice, the next Wave 2 step should move the new execution contracts from single-process durability into real worker handoff and object-store-backed artifact persistence.

The key truth boundary is now explicit:

1. artifact manifest state is read from durable case state, not reconstructed only as report decoration
2. report responses can stay stable while the runtime moves toward real worker and object-store boundaries