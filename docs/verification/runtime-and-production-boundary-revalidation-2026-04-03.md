---
title: "Runtime And Production Boundary Revalidation"
status: "active"
version: "1.0.1"
last_updated: "2026-04-03"
tags: [verification, audit, security, runtime, publication]
role: evidence
---

# Runtime And Production Boundary Revalidation

Date: 2026-04-03

## Purpose

This note is an independent revalidation of the current MRI Second Opinion working tree.

It answers two questions:

1. which 2026-04-02 boundary findings still hold
2. which older claims are now outdated and should no longer be treated as current runtime truth

## Evidence Base

This revalidation used four evidence classes:

1. source review across `src/app.ts`, `src/config.ts`, `src/operator-auth.ts`, `src/reviewer-auth.ts`, `src/validation.ts`, `src/http-runtime.ts`, `src/cases.ts`, `src/case-postgres-repository.ts`, and `worker/main.py`
2. test review across `tests/workflow-api.test.ts`, `tests/runtime-hardening.test.ts`, and `tests/validation-limits.test.ts`
3. runtime verification via a fresh `npm test` rerun on 2026-04-03 plus editor diagnostics over `src` and `tests`
4. external standards context from FDA/IMDRF GMLP guidance, OWASP Authorization guidance, OWASP SSRF guidance, Node HTTP server guidance, and Helmet documentation

## Validation Snapshot

The current local rerun confirmed the following:

1. editor diagnostics on `src` and `tests` are clean
2. the full `npm test` rerun is currently green on the working tree
3. current test result is `166 total`, `165 passing`, `0 failing`, `1 skipped`
4. review and finalize mutations now enforce a deny-by-default reviewer-role allowlist on top of reviewer JWT identity
5. internal and operator middleware now fail closed outside development when their route-auth secrets are unset
6. `worker/main.py` now blocks disallowed absolute `volumeDownloadUrl` origins before any network fetch, allowing only MRI API same-origin or explicitly allowlisted origins before falling back to metadata mode instead
7. persisted payload-backed derived artifacts now carry SHA-256 and byte-size integrity metadata across case-detail and report surfaces

## Executive Verdict

The conservative repository verdict remains `PUBLIC_GITHUB_READY` when that verdict is interpreted strictly as publication honesty only.

This working tree should not currently be used as evidence for stronger deployment, clinical, or security-readiness claims.

The dominant blockers are now:

1. object and relationship authorization semantics rather than raw route existence
2. stronger input and output provenance rather than raw worker reachability alone
3. hosted-evidence lag rather than local test failure

## Closed Since The 2026-04-02 Boundary Audit

### 1. Reviewer identity is no longer request-body data

Current `review` handling binds persisted reviewer identity to `resolveAuthenticatedReviewer(req, config)` rather than to body fields.

Runtime proof:

1. `src/app.ts` merges the parsed review payload with authenticated reviewer data
2. `tests/workflow-api.test.ts` verifies that review persistence uses the JWT subject as `reviewerId`

### 2. Public finalize no longer accepts `deliveryOutcome`

The public finalize HTTP contract now accepts `finalSummary` only.

Runtime proof:

1. `src/validation.ts` exposes `parsePublicFinalizeCaseInput()` without `deliveryOutcome`
2. `src/app.ts` uses `parsePublicFinalizeCaseInput()` for `POST /api/cases/:caseId/finalize`
3. `tests/workflow-api.test.ts` verifies that sending `deliveryOutcome` now returns `400 INVALID_INPUT`

### 3. Route-level operator and internal protection now fail closed outside development

`/api/cases`, `/api/operations`, and `/api/delivery` are gated by `x-api-key` through `src/operator-auth.ts`, and `/api/internal/*` is gated by bearer-token auth through `src/internal-auth.ts`.

Runtime proof:

1. `src/operator-auth.ts` and `src/internal-auth.ts` now return `503 SERVICE_CONFIG_ERROR` when their expected auth secret is absent outside development
2. `tests/runtime-hardening.test.ts` verifies both fail-closed paths explicitly

This improves the previous unauthenticated public-surface posture, but it does not by itself solve actor-scoped or object-scoped authorization.

### 4. Reviewer role allowlisting now exists for review and finalize

Reviewer JWTs now do more than establish identity. They also enforce an explicit reviewer-role policy before either clinical mutation route proceeds.

Runtime proof:

1. `src/config.ts` now parses `MRI_REVIEWER_ALLOWED_ROLES` with a deny-by-default baseline of `clinician`, `radiologist`, and `neuroradiologist`
2. `src/reviewer-auth.ts` now rejects missing reviewer roles and non-allowlisted reviewer roles with `403 FORBIDDEN`
3. `src/app.ts` now uses action-aware reviewer authorization for both `POST /api/cases/:caseId/review` and `POST /api/cases/:caseId/finalize`
4. `tests/workflow-api.test.ts` now proves that missing-role and unauthorized-role JWTs are denied while allowlisted reviewer roles can still review and finalize

### 5. The local `dist` runtime artifact set is now aligned to current `src`

The stale compiled files previously called out in this revalidation have now been removed from the working tree.

Runtime proof:

1. `docs/verification/dist-artifact-cleanup-validation-2026-04-03.md` records the removed orphaned filenames
2. `npm run build` remains clean after the cleanup
3. `package.json` and `Dockerfile` still point the runtime entry to `dist/index.js`

## Current Findings

### High 1. Authorization is still route-gated, not actor-scoped or object-scoped

The repository now authenticates more surfaces than it did before, but authorization semantics remain shallow.

Code proof:

1. `src/operator-auth.ts` protects operator routes with one static shared `x-api-key`
2. `src/reviewer-auth.ts` verifies JWT integrity and extracts `sub` plus optional role metadata
3. current route handling does not enforce case relationship, tenant boundary, object ownership, or role whitelist logic before read-side or finalize-side access

Why this matters:

1. OWASP Authorization guidance distinguishes authentication from authorization
2. OWASP explicitly recommends validating permissions on every request for the specific object, not just the route type
3. access to one case/report/export/artifact route does not imply access to every case/report/export/artifact of the same type

Interpretation:

The repository now proves route protection and explicit reviewer role allowlisting, but it still does not prove deployment-grade object authorization.

### Medium 2. Worker fetch policy is now bounded, but not yet provenance-strong

The worker no longer performs arbitrary absolute-origin fetches for `studyContext.series[].volumeDownloadUrl`, but the current control is still a bounded runtime guard rather than a full provenance model.

Code proof:

1. `src/validation.ts` still accepts `studyContext.series[].volumeDownloadUrl`
2. `worker/main.py` now rejects non-relative absolute URLs unless they are same-origin to `MRI_API_BASE_URL` or explicitly present in `MRI_WORKER_ALLOWED_VOLUME_ORIGINS`
3. `tests/workflow-api.test.ts` now proves both the allowed voxel-backed path and the blocked-origin metadata fallback path

Why this matters:

1. this closes the arbitrary external-origin fetch path that previously created the strongest SSRF-class concern
2. input provenance is still not signed or object-store-bound by contract
3. API-side validation still allows callers to present the field even though the worker now refuses non-same-origin absolute URLs unless they are explicitly allowlisted at runtime

Interpretation:

This boundary is materially better than before, but the long-term target should still be signed internal object-store URLs or API-side allowlist enforcement.

### Medium 3. Artifact integrity is stronger, but not yet verification-complete

Persisted payload-backed derived artifacts now expose SHA-256 and byte-size metadata through the artifact manifest and report surfaces.

Code proof:

1. `src/case-artifact-storage.ts` now computes SHA-256 and byte-size values from decoded payload bytes at persistence time
2. `src/case-artifacts.ts` now carries those values through derived artifact descriptors
3. `src/case-sqlite-storage.ts` normalizes the new fields for persisted records and older reload paths
4. `tests/workflow-api.test.ts` now proves that checksum and size survive through both case-detail and report artifact surfaces

Why this matters:

1. this closes the earlier state where stored artifacts had only location and MIME metadata, which made post-persistence tampering harder to reason about
2. downstream reviewers and future export adapters now have a stable integrity field to compare against
3. this is still weaker than signed attestations, immutable audit trails, or retrieval-time verification of the stored bytes

Interpretation:

Artifact provenance is materially stronger than it was on 2026-04-03, but the repository still does not prove full deployment-grade integrity attestation.

### Medium 4. Current local proof is stronger than hosted evidence on the same date

The current local working tree now has a green full-suite rerun, but the latest hosted-validated head still trails that state.

Interpretation:

This is no longer a broken-test problem. It is now an evidence-publication lag problem.

## What Still Looks Good

1. the repository has a real and non-trivial standalone runtime, not just a paper architecture
2. reviewer identity handling is materially stronger than it was before because the persisted reviewer now comes from JWT subject data
3. reviewer mutations now also enforce an explicit role allowlist rather than accepting any authenticated JWT subject
4. the public finalize delivery override issue appears closed at the HTTP contract boundary
5. runtime hardening is real: Helmet, CSP, CORS controls, rate limiting, typed 413 handling, timeout tuning, and graceful shutdown are implemented and tested
6. the worker now refuses disallowed absolute volume origins before network egress and preserves a classified metadata fallback instead
7. the full local suite is currently green

## Regulatory Interpretation

FDA and IMDRF GMLP guidance emphasizes total product lifecycle risk management, human oversight, and safe operational controls.

This repository is aligned with those expectations in one important way: it now binds reviewer identity to an authenticated JWT surface instead of body text.

It remains misaligned in other ways that matter for stronger claims:

1. object authorization is not yet demonstrated
2. reviewer authorization is still role-scoped only; it is not yet relationship-based or case-scoped
3. worker input provenance is not yet reduced to signed internal object-store references or equivalent API-side policy
4. hosted evidence still lags the current local runtime truth

## Recommendations

1. replace shared-secret route gating with actor-aware and object-aware authorization for case, report, export, and artifact surfaces
2. extend reviewer authorization from role allowlisting to relationship-based or case-scoped policy where the deployment model requires it
3. tighten worker input provenance further by preferring signed internal object-store URLs or API-side allowlist validation instead of caller-supplied URL surfaces
4. refresh the hosted evidence packet on the current green local head

## Bottom Line

The repository is in a better state than the 2026-04-02 boundary audit alone suggests.

Two previously central findings are no longer current runtime truth:

1. reviewer identity is no longer body-supplied
2. public finalize no longer accepts delivery-plane overrides

The remaining blockers are now narrower and more important:

1. object authorization
2. relationship-based reviewer authorization
3. stronger input provenance for worker volume fetch
4. hosted-evidence hygiene

Those are the boundaries that now determine whether the project can ever justify claims stronger than `PUBLIC_GITHUB_READY`.