# Threat Model

Date: 2026-03-27

## Purpose

This document turns the repository's current threat snapshot into a maintained design-control surface for the MRI Second Opinion workflow system.

It is meant to describe the current security and integrity posture.

It is not a claim that the repository already satisfies a full regulated cybersecurity file.

## System Boundary

The current threat model applies to the standalone repository as it exists today.

That means:

1. a Node.js and TypeScript workflow API
2. local SQLite-backed default persistence plus a locally verified PostgreSQL path
3. built-in workbench review surface
4. internal callback, dispatch-auth, and queue-claim routes used by the bounded workflow system

It does not yet describe a production deployment perimeter with external identity, hosted DICOM infrastructure, or a hosted or distributed Python inference fleet.

## Trust Boundaries

The most important current trust boundaries are:

1. public operator-facing HTTP routes versus internal callback and queue routes
2. persisted workflow truth versus transient worker execution state
3. report and derived-artifact metadata versus the underlying stored files
4. repository dependency inputs versus the runtime assembled in CI or local installation

## Protected Assets

The current workflow system should protect:

1. case-state integrity
2. clinician-review and finalization gating
3. operation and history logs used for audit reasoning
4. report provenance fields and artifact references
5. dependency-composition transparency for the released codebase

## Current Threat Register

| Threat | Current posture | Immediate consequence |
|---|---|---|
| stale writer on queue claim | partially mitigated on the tested local path | duplicate or misleading background work attribution |
| duplicate inference callback replay | mitigated by callback replay guards | repeated case mutation or state confusion |
| premature delivery callback after queue loss | mitigated by active delivery-job guard | incorrect delivery completion state |
| machine impersonation of clinician actions | open gap | review or finalize actions are recorded as data, not authenticated proof |
| internal route replay or signature spoofing | mitigated | namespace bearer protection gates all `/api/internal/*` routes; HMAC-SHA256 request signing with nonce replay enforcement protects `/api/internal/dispatch/*` |
| artifact tampering after generation | open gap | report and derived artifacts do not yet have checksum verification |
| inference-worker crash and silent work loss | open gap | stronger lease recovery and scheduler-driven liveness are absent |
| vulnerable dependency introduction | partially mitigated | dependency risk can still enter between updates without explicit inventory and triage |

## Current Mitigations

The repository already has meaningful baseline mitigations.

1. explicit workflow-state vocabulary reduces hidden state transitions
2. durable history and operation-log records preserve audit trace context
3. replay and active-job guards reduce some callback-path corruption cases
4. clinician review remains mandatory in the workflow contract
5. `npm run sbom` plus CI artifact upload now provide a repeatable dependency inventory seam
6. `MRI_INTERNAL_API_TOKEN` can gate the full `/api/internal/*` namespace with bearer authentication
7. HMAC-SHA256 nonce replay store is wired into the live dispatch middleware with configurable TTL and max-entries bounds
8. Helmet manages the document response header baseline: strict Content-Security-Policy, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `X-Permitted-Cross-Domain-Policies`, same-origin COOP/CORP, production HSTS, and `X-Powered-By` remains suppressed
9. archive-lookup HTTP client enforces a 10-second `AbortSignal.timeout` to bound external-service latency

## Open Gaps

The highest-value security gaps that still remain are:

1. authenticated clinician identity and stronger operator authorization semantics
2. ~~nonce replay enforcement~~ — closed: replay store is now wired into dispatch middleware (see mitigations 6–7)
3. artifact checksum persistence and verification
4. stronger lease recovery for inference work after crash or network interruption
5. a formal vulnerability-intake and remediation SOP tied to release evidence

## Phase 1 Hardening Actions

The current Phase 1 documentation hardening pass closes only the governance layer, not the implementation gaps themselves.

This pass adds:

1. `sbom-policy.md` for supply-chain transparency
2. `pms-plan.md` for future surveillance and incident-intake expectations
3. `bias-analysis-framework.md` for subgroup-risk evaluation planning

These are design controls that make later implementation work easier to verify.

## Non-Claims

This document must not be read as proof of:

1. production-grade API hardening
2. hospital deployment readiness
3. regulated cybersecurity-file completion
4. authenticated multi-actor clinical operations

## Interaction With Other Docs

Use this document together with:

1. `../academic/formal-system-analysis.md` for the source threat snapshot and property model
2. `sbom-policy.md` for dependency-inventory rules
3. `../regulatory/pms-plan.md` for surveillance-transition planning
4. `../academic/regulatory-positioning.md` for RUO boundary discipline