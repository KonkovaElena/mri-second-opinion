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

It does not yet describe a production deployment perimeter with external identity, actor-scoped object authorization, hosted DICOM infrastructure, controlled worker egress, or a hosted or distributed Python inference fleet.

## Trust Boundaries

The most important current trust boundaries are:

1. public operator-facing HTTP routes versus internal callback and queue routes
2. persisted workflow truth versus transient worker execution state
3. report and derived-artifact metadata versus the underlying stored files
4. repository dependency inputs versus the runtime assembled in CI or local installation
5. reviewer metadata supplied in public requests versus authenticated clinician authority
6. public study input versus worker-side network fetch targets

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
| machine impersonation of clinician actions | partially mitigated | review and finalize operations now record the authenticated reviewer identity (`actorId`) from JWT claims in the operation log; request-body reviewer fields are overridden by JWT-verified identity |
| public object access without actor-scoped authorization | partially mitigated | tenant-scoped isolation (`x-tenant-id` header) filters list results and denies cross-tenant access to case, report, export, and artifact surfaces with 403; reviewer-scoped authorization denies access to cases assigned to a different reviewer on review and finalize mutations; remaining gap is cryptographic tenant identity binding (current header is not yet backed by a signed tenant token) |
| public-supplied worker fetch target | partially mitigated | a caller can still provide the field, but worker-side absolute fetches are now restricted to MRI API same-origin or explicit allowlisted origins instead of broad absolute-origin acceptance |
| clinician finalization coupled to delivery mutation | closed | public finalize route strips `deliveryOutcome` via `parsePublicFinalizeCaseInput`; only internal callers can specify delivery simulation; clinician action is now separated from delivery-plane authority |
| internal route replay or signature spoofing | mitigated | namespace bearer protection gates all `/api/internal/*` routes; HMAC-SHA256 request signing with nonce replay enforcement protects `/api/internal/dispatch/*` |
| artifact tampering after generation | partially mitigated | persisted artifact manifests now carry SHA-256 and byte-size integrity metadata for stored payload-backed artifacts, but download-time verification and stronger attestation are not yet enforced |
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
10. browser-origin access is strict by default: cross-origin reads require explicit `MRI_CORS_ALLOWED_ORIGINS` allowlisting on selected public routes, while internal browser preflights remain unapproved
11. internal bearer and HMAC protections currently apply only to internal routes and do not yet authenticate public clinician, report, export, or artifact access paths
12. reviewer JWT verification (HS256) with deny-by-default role allowlist gates review and finalize mutations; authenticated reviewer identity is captured as `actorId` in the operation log, closing the clinician impersonation vector for workflow mutations
13. persisted payload-backed artifacts now record SHA-256 and byte-size integrity metadata in the derived-artifact manifest, so case detail and report surfaces can trace each stored artifact back to a concrete content digest instead of only a storage URI
14. tenant-scoped object isolation: cases created with a `tenantId` are invisible to other tenants on list, detail, report, export, and artifact routes; cross-tenant access returns 403; unscoped operator access still sees all cases (backward compatible)
15. reviewer-scoped object authorization: cases created with an `assignedReviewerId` restrict review and finalize mutations to the assigned reviewer; mismatched JWT `sub` returns 403

## Open Gaps

The highest-value security gaps that still remain are:

1. ~~authenticated clinician identity~~ — partially closed: reviewer JWT with role allowlist gates review and finalize; `actorId` from JWT claims is recorded in the operation log; tenant and reviewer scoping are now wired for read and mutation paths; remaining gap is cryptographic tenant identity (signed tenant token) and full RBAC beyond reviewer/operator
2. ~~object-level authorization for public case, report, export, and artifact surfaces~~ — partially closed: tenant-scoped isolation and reviewer-scoped mutation authorization are wired and tested; remaining gap is cryptographic binding of tenant identity to a verifiable token rather than a trust-the-header model
3. stronger API-side provenance and tighter deployment policy for public-to-worker volume references beyond the current worker-side same-origin or explicit-origin allowlist
4. ~~separation of clinician finalization from delivery-outcome mutation authority~~ — closed: public finalize route strips `deliveryOutcome` via `parsePublicFinalizeCaseInput`; only internal callers retain delivery simulation capability
5. ~~nonce replay enforcement~~ — closed: replay store is now wired into dispatch middleware (see mitigations 6–7)
6. artifact checksum verification at retrieval time plus stronger signed-attestation or immutable provenance beyond stored manifest hashes
7. stronger lease recovery for inference work after crash or network interruption
8. a formal vulnerability-intake and remediation SOP tied to release evidence

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
4. ~~authenticated multi-actor clinical operations~~ — partially addressed: reviewer JWT with `actorId` audit trail is now wired for review and finalize; tenant and reviewer object-scoped authorization are wired for read and mutation paths; full multi-actor RBAC remains future work
5. ~~closed object-level authorization~~ — partially addressed: tenant isolation and reviewer-scoped mutations are wired and tested (see mitigations 14-15); cryptographic tenant binding and full RBAC beyond the current model remain future work
6. closed worker-egress policy — partially addressed: same-origin or explicit-allowlist enforcement is wired on worker side

## Interaction With Other Docs

Use this document together with:

1. `../academic/formal-system-analysis.md` for the source threat snapshot and property model
2. `sbom-policy.md` for dependency-inventory rules
3. `../regulatory/pms-plan.md` for surveillance-transition planning
4. `../academic/regulatory-positioning.md` for RUO boundary discipline