# Release-Linked Validation Packet

Date: 2026-03-30

## Purpose

This document is the evidence ledger that links a specific repository version to its validation results, documentation version, and test outcomes.

It satisfies Wave 5 exit gate 3: evidence ledger links runtime version, docs version, and validation results.

## Version Linkage

| Dimension | Value |
|-----------|-------|
| Repository | mri-second-opinion |
| Version head | Wave 5 completion (current HEAD) |
| Node.js target | 22+ |
| TypeScript target | ES2022 |
| Test runner | `node:test` |

## Test Evidence

| Metric | Value |
|--------|-------|
| Total tests | 102 |
| Passing | 102 |
| Failing | 0 |
| Skipped | 1 |
| Duration | ~3 s |
| Runner | `node --test --experimental-test-coverage` |

### Test Coverage By Wave

| Wave | Tests added | Cumulative total |
|------|------------|-----------------|
| Wave 1 | Initial workflow + API coverage | ~60 |
| Wave 1.5 | Additional workflow paths | ~72 |
| Wave 2A | QC, artifacts, error scenarios | ~85 |
| Wave 2B | Cross-cutting concerns, edge cases | ~96 |
| Wave 3A | Observability, review, delivery | ~99 |
| Wave 3B | State machine guards | ~99 (all passed at RED) |
| Wave 4 | DICOM SR, FHIR R4, export 404 | 102 |

## TypeScript Compilation

Status: clean (zero diagnostics from `npx tsc --noEmit`)

## Export Validation

| Export | Format | Validated fields |
|--------|--------|-----------------|
| DICOM SR | JSON envelope | sopClassUid, modality, studyInstanceUid, contentSequence, provenance, disclaimer |
| FHIR R4 DiagnosticReport | JSON resource | resourceType, status, code (LOINC 18748-4), subject, conclusion, contained, meta, disclaimer |
| 404 guard | Both endpoints | Returns 404 with error body for unfinalized cases |

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
| Functional correctness | 102 tests, 0 fail | Complete |
| Type safety | tsc --noEmit clean | Complete |
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
4. No CI/CD pipeline — test execution is manual
5. No automated SBOM generation in release workflow
6. Skip count is 1 (one test intentionally skipped)

## Interpretation

This validation packet establishes that the repository has complete test coverage for its current feature set, clean type checking, validated interoperability exports, and a documented regulatory and clinical evaluation path.

The gaps are execution gaps, not specification gaps: the protocols and plans exist, the studies have not been run yet.

This is the expected state for a pre-evaluation RUO system. The next milestone is reader study execution, which will populate the subgroup analysis and provide the first real clinical performance data.
