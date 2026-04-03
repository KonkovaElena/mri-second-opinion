---
title: "Runtime And Production Boundary Audit"
status: "active"
version: "1.0.0"
last_updated: "2026-04-02"
tags: [verification, audit, security, production, publication]
role: evidence
---

# Runtime And Production Boundary Audit

Date: 2026-04-02

## Purpose

This note captures the current reality boundary between:

1. a publication-safe open GitHub repository
2. a locally verified workflow runtime
3. a production-grade or clinically defensible deployment posture

It is an evidence document.

It does not change the repository-level publication verdict by itself.

It does tighten the language around what the current implementation still does not prove.

## Verification Snapshot

The current local rerun used during this audit confirmed:

1. `npm test` succeeds on the current head with 154 total tests, 153 passing tests, 0 failures, and 1 skipped test
2. `npm run build` succeeds on the current head

That means the repository still has a real, reproducible standalone baseline.

## Executive Verdict

The repository remains correctly classified as `PUBLIC_GITHUB_READY` for conservative public publication.

It does not qualify for production deployment, clinical deployment, or stronger security-readiness claims.

The gap is no longer basic repository immaturity.

The gap is trust-boundary closure.

## What The Audit Confirmed

### 1. The runtime baseline is real

The standalone repository still provides a real workflow-capable Node and TypeScript control plane with durable case state, bounded worker contracts, report generation surfaces, export seams, and a non-trivial automated test baseline.

### 2. The publication verdict can remain conservative and truthful

`PUBLIC_GITHUB_READY` in this repository means only that the codebase can be published publicly without misleading readers about current maturity.

It does not imply:

1. authenticated multi-actor clinical operations
2. production-grade API authorization
3. safe worker egress policy
4. hospital or regulated deployment readiness

### 3. The main unresolved risks are boundary risks, not code-organization risks

The strongest remaining issues are now concentrated at the trust boundaries between:

1. public routes and clinician authority
2. public object access and case-scoped authorization
3. public study input and worker-side network fetching
4. clinical finalization and delivery-plane state mutation

## Findings

### Critical 1. Public clinical actions are still recorded as data, not authenticated authority

The review and finalize surfaces still accept reviewer identity as request data rather than as an authenticated principal.

Impact:

1. clinician proof remains advisory metadata
2. a caller can impersonate reviewer identity at the HTTP layer
3. the current workflow does not prove authenticated review authorship

### Critical 2. Public object-level access remains too open for stronger claims

The public surface still exposes case listing, report retrieval, export retrieval, and artifact retrieval without actor-scoped object authorization semantics.

Impact:

1. case, report, export, or artifact access is still not tied to a protected actor or tenancy model
2. the repository does not yet prove object-level authorization discipline for workflow truth or derived outputs

### Critical 3. Public input can still influence worker-side URL fetching

The bounded worker contract still allows `studyContext.series[].volumeDownloadUrl` to reach the worker-side download path.

Impact:

1. the runtime still lacks a closed allowlist or controlled object-store-only fetch policy
2. this is the current SSRF-class boundary in the implementation
3. bounded local proof does not yet equal bounded network trust

### High 4. Clinical finalization is still coupled to delivery-state mutation

The finalize surface can still set `deliveryOutcome` directly.

Impact:

1. clinical closure and transport-state truth remain mixed in one public mutation path
2. a caller can simulate downstream delivery success or failure from the clinician-facing plane

### Medium 5. Interoperability exports are useful structural seams, not full standards-grade release proof

The DICOM SR and FHIR DiagnosticReport builders are real and valuable.

They still represent structured JSON export seams rather than full binary or validator-backed interoperability closure.

Impact:

1. the current export story is real enough for bounded workflow proof
2. it is not yet sufficient for stronger interoperability or downstream integration claims by itself

## Lessons Learned

1. publication-safe is not the same as deployment-safe
2. a body field like `reviewerId` is audit metadata, not identity
3. object-level authorization must be assessed separately from route existence and happy-path tests
4. worker URL fetch paths must be treated as security boundaries even in synthetic or bounded demo flows
5. clinician APIs and delivery/integration APIs should not share the same mutation authority model

## Documentation Consequences

This audit requires four durable documentation behaviors:

1. keep `PUBLIC_GITHUB_READY` explicitly scoped to publication honesty only
2. keep threat-model language specific about public auth, object authorization, worker egress, and delivery-plane coupling gaps
3. route current readiness arguments through the evidence ledger rather than through historical scorecards
4. preserve older audits as historical evidence instead of letting them appear to be the active current-state authority

## Interaction With Other Docs

Use this document together with:

1. `launch-evidence-index.md`
2. `../releases/v1-go-no-go.md`
3. `../releases/public-github-and-mvp-path.md`
4. `../security/threat-model.md`
5. `documentation-honesty-review.md`