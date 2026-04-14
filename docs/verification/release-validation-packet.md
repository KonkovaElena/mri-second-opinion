# Release-Linked Validation Packet

Date: 2026-04-12

## Purpose

This document is the evidence ledger that links a specific repository version to its validation results, documentation version, and test outcomes.

It satisfies Wave 5 exit gate 3: evidence ledger links runtime version, docs version, and validation results.

## Version Linkage And Test Evidence

<!-- AUTHORITY:RELEASE_PACKET_SUMMARY:START -->
| Dimension | Value |
|-----------|-------|
| Repository | mri-second-opinion |
| Latest hosted-validated head | `3f42a4b8d3f912f9eb84ca0f6bf3e1d56f932170` |
| Previous hosted-validated head | `1e340b978bfa35a2ed339adcdb0d2add56cc08c3` |
| Latest documented local validation snapshot | 2026-04-14 |
| Local validation commands | `npm ci` -> `npm run build` -> `npm test` |
| Public workflow routes | 13 |
| Internal integration routes | 11 |
| Operational endpoints | 5 |
| Node.js target | 24+ |
| TypeScript target | ES2022 |
| Test runner | `npm test` (`node --import tsx --test tests/**/*.test.ts`) |

| Metric | Value |
|--------|-------|
| Total tests | 258 |
| Passing | 257 |
| Failing | 0 |
| Skipped | 1 |
<!-- AUTHORITY:RELEASE_PACKET_SUMMARY:END -->

## Local Validation Scope

The latest documented local validation snapshot covers finalized-only export gating, release-doc reconciliation, audit remediation, later validation plus persistence hardening (semantic payload-size limits, archive lookup graceful degradation, PostgreSQL payload round-trip preservation), the `s3-compatible` artifact backend plus post-A2 documentation reconciliation, artifact-boundary hardening for local-file and object-store retrieval, strict-by-default browser-origin hardening with explicit allowlist parsing plus public-route preflight enforcement, reviewer-role allowlisting for review/finalize mutations, local `dist` artifact cleanup, GitHub publication hardening with a Node 24 cross-platform install lane above the hosted baseline, fail-closed internal/operator route-auth hardening with protected-route helper reconciliation, reader-study metrics plus archive circuit-breaker coverage, and reviewer-auth JWKS cache URL-scoping hardening.

### Test Coverage By Wave

| Wave | Tests added | Cumulative total |
|------|------------|-----------------|
| Wave 1 | Initial workflow + API coverage | ~60 |
| Wave 1.5 | Additional workflow paths | ~72 |
| Wave 2A | QC, artifacts, error scenarios | ~85 |
| Wave 2B | Cross-cutting concerns, edge cases | ~96 |
| Wave 3A | Observability, review, delivery | ~99 |
| Wave 3B | State machine guards | ~99 (all passed at RED) |
| Wave 4 | DICOM SR, FHIR R4, finalized-only export gating | ~104 |
| Post-Wave reconciliation | additional runtime, PostgreSQL, and workflow regression coverage | 114 |
| Audit remediation | order-safe fingerprint, security headers, archive timeout, metrics error handling | 115 |
| Post-publication hardening | semantic payload-size validation, archive-lookup degradation, and PostgreSQL round-trip preservation | 136 |
| Hyper-deep audit + academic doc audit | structured error logging, Dockerfile HEALTHCHECK, Helmet/CSP, CI docs-governance, persistence normalization, and runtime-hardening coverage | 145 |
| A2 artifact backend + documentation reconciliation | `s3-compatible` artifact storage, object-store routing, config coverage, and authority-doc alignment | 148 |
| Artifact boundary hardening | local-file root enforcement and object-store base-path enforcement for public artifact retrieval | 150 |
| Browser-origin hardening | `MRI_CORS_ALLOWED_ORIGINS` parsing, deny-by-default cross-origin reads, allowlisted public preflights, and rejection of internal authorization-header browser preflights | 154 |
| Reviewer-role authorization | reviewer allowlist parsing plus deny-by-default role enforcement on review/finalize mutations | 163 |
| Route-auth fail-closed hardening | fail-closed internal/operator middleware behavior outside development, protected-route test-helper alignment, and auth-regression reconciliation | 166 |
| Object-scoped authorization | tenant isolation (x-tenant-id), reviewer-scoped mutation denial, cross-tenant 403 enforcement across report/export/artifact routes, try/catch hardening on list and operations-summary routes | 177 |
| Post-auth and dependency reproducibility hardening | reader-study metrics, archive circuit breaker, case pagination/presentation coverage, reviewer-auth JWKS cache URL scoping, and strict `npm ci` install proof | 239 |
| Authority SSOT + reviewer-auth audience hardening | machine-readable route or validation truth sync, generated API surface verification, and HS256 reviewer audience enforcement | 258 |

## TypeScript Compilation

Status: clean (`npm run build` -> `tsc -p tsconfig.json`)

## Export Validation

| Export | Format | Validated fields |
|--------|--------|-----------------|
| DICOM SR | JSON envelope | sopClassUid, modality, studyInstanceUid, contentSequence, provenance, disclaimer |
| FHIR R4 DiagnosticReport | JSON resource | resourceType, status, code (LOINC 18748-4), subject, conclusion, contained, meta, disclaimer |
| 404 guard | Both endpoints | Returns 404 with error body for missing, draft, and reviewed-but-unfinalized reports |

## Documentation Version Inventory

### Governance Docs

| Document | Path | Wave |
|----------|------|------|
| Action plan | `docs/academic/action-plan.md` | 1 (updated through 5) |
| Evidence index | `docs/verification/launch-evidence-index.md` | 1 (updated through 5) |
| Roadmap and validation | `docs/roadmap-and-validation.md` | 1 (updated through 5) |

### Academic Docs

| Document | Path | Wave |
|----------|------|------|
| Bias analysis framework | `docs/academic/bias-analysis-framework.md` | 2A |
| Reader study protocol | `docs/academic/reader-study-protocol.md` | 5 |
| Subgroup analysis plan | `docs/academic/subgroup-analysis-plan.md` | 5 |
| PMS activation plan | `docs/academic/pms-activation.md` | 5 |

### Regulatory Docs

| Document | Path | Wave |
|----------|------|------|
| PCCP plan | `docs/regulatory/pccp-plan.md` | 4 |
| IEC 62304 classification | `docs/regulatory/iec-62304-classification.md` | 4 |
| ISO 14971 risk baseline | `docs/regulatory/iso-14971-risk-baseline.md` | 4 |
| Data governance policy | `docs/regulatory/data-governance-policy.md` | 4 |
| PMS transition plan | `docs/regulatory/pms-plan.md` | 2B |

### Security Docs

| Document | Path | Wave |
|----------|------|------|
| Threat model | `docs/security/threat-model.md` | 2B |
| SBOM policy | `docs/security/sbom-policy.md` | 2B |
| Vulnerability response SOP | `docs/security/vulnerability-response-sop.md` | 4 |

### Verification Docs

| Document | Path | Wave |
|----------|------|------|
| Launch evidence index | `docs/verification/launch-evidence-index.md` | 1 (updated through 5) |
| Release validation packet | `docs/verification/release-validation-packet.md` | 5 |

## Validation Completeness Matrix

| Validation dimension | Artifact | Status |
|---------------------|----------|--------|
| Functional correctness | Current authority snapshot in `docs/authority/runtime-truth.json` (`258` tests, `257` pass, `0` fail, `1` skipped) | Complete |
| Type safety | `npm run build` clean | Complete |
| Interoperability | DICOM SR + FHIR R4 exports validated | Complete |
| Regulatory readiness | 5-document governance pack | Complete |
| Security baseline | Threat model + SBOM + vulnerability SOP | Complete |
| Clinical protocol | Reader study protocol written | Complete (execution pending) |
| Bias controls | Subgroup analysis plan written | Complete (execution pending) |
| PMS readiness | Activation criteria documented | Complete (activation pending) |
| Evidence traceability | This document | Complete |

## Known Gaps

1. Reader study not yet executed — protocol exists, no data collected
2. Subgroup analysis not yet executed — plan operationalizes framework, no results available
3. PMS program not yet active — activation criteria defined, none met yet
4. The current local dependency-reproducibility and auth rerun above the 2026-04-09 docs snapshot has not yet been re-hosted as a new GitHub Actions run above `3f42a4b8d3f912f9eb84ca0f6bf3e1d56f932170`
5. Skip count is 1 (one test intentionally skipped)
6. Object-store hardening is still incomplete at production-grade level: retention, multipart upload, and MinIO verification remain follow-on work
7. Hosted evidence still points to the last paired `ci` and `docs-governance` success below the current local reviewer-auth, archive-lookup, and frozen-install hardening head
8. PostgreSQL bootstrap verification is environment-gated by design; the current zero-config rerun confirms that the script still refuses to proceed without `MRI_CASE_STORE_DATABASE_URL` or `DATABASE_URL`

## Interpretation

This validation packet establishes that the repository has a current local validation snapshot with clean build output, validated interoperability exports, a strengthened validation, persistence, artifact-boundary, browser-origin, reviewer-auth, and fail-closed route-auth regression net, and a documented regulatory and clinical evaluation path.

The gaps are execution gaps, not specification gaps: the protocols and plans exist, the studies have not been run yet. Public GitHub-hosted workflow truth is still last captured for repository head `3f42a4b8d3f912f9eb84ca0f6bf3e1d56f932170`, while the present local hardening snapshot now sits above that head with strict `npm ci` proof and a larger regression net. The PostgreSQL bootstrap probe remains a deliberate env-gated check rather than part of the zero-config baseline, and the 2026-04-14 rerun confirms that it still fails closed when the connection string is absent.

This is the expected state for a pre-evaluation RUO system. The next milestone is reader study execution, which will populate the subgroup analysis and provide the first real clinical performance data.
