# ISO 14971 Risk Management Baseline

Date: 2026-03-27

## Purpose

This document establishes the risk management baseline for the standalone MRI second-opinion repository per ISO 14971:2019.

It identifies hazards, estimates risks, documents risk controls, and evaluates residual risk for the current implemented bounded slice.

## Scope

This risk management file covers the repository as it exists today:

1. a brain volumetry research-use-only workflow
2. a Node.js API with SQLite and PostgreSQL persistence
3. structured DICOM SR and FHIR R4 export seams
4. mandatory clinician-in-the-loop review before output delivery

It does not cover deployment infrastructure, network perimeter security in production, or inference model training and validation.

## Risk Acceptability Criteria

Risk acceptability follows the ISO 14971 framework:

1. **Unacceptable**: risks that cannot be mitigated to an acceptable level regardless of benefit
2. **ALARP (As Low As Reasonably Practicable)**: risks that are reduced as far as technically and economically feasible
3. **Broadly acceptable**: risks with negligible probability and negligible severity

For the current RUO posture, the primary acceptability criterion is: **no unreviewed clinical output can reach a patient pathway without explicit clinician sign-off**.

## Hazard Identification

### H-001: Unreviewed Output Delivery

| Field | Value |
|-------|-------|
| Hazard | Automated inference output delivered without clinician review |
| Harm | Incorrect volumetric finding influences clinical decision |
| Severity | Moderate (non-serious injury through delayed or incorrect follow-up) |
| Probability Before Controls | Low (state machine enforces review gate) |

### H-002: Measurement Inaccuracy

| Field | Value |
|-------|-------|
| Hazard | Volumetric measurement outside acceptable tolerance |
| Harm | Misleading quantitative result presented to clinician |
| Severity | Moderate |
| Probability Before Controls | Medium (depends on model and input quality) |

### H-003: QC Gate Bypass

| Field | Value |
|-------|-------|
| Hazard | Poor-quality input passes QC gating and produces unreliable output |
| Harm | Low-confidence result presented as if it were reliable |
| Severity | Low to moderate |
| Probability Before Controls | Low (QC disposition is explicitly gated) |

### H-004: Export Format Corruption

| Field | Value |
|-------|-------|
| Hazard | DICOM SR or FHIR export contains structurally invalid data |
| Harm | Downstream system misinterprets or silently drops clinical data |
| Severity | Low (research context, no direct patient impact) |
| Probability Before Controls | Low (export builders are deterministic from validated report data) |

### H-005: Unauthorized Workflow Manipulation

| Field | Value |
|-------|-------|
| Hazard | Unauthorized entity submits forged inference callbacks or review approvals |
| Harm | Case state corrupted, potentially bypassing safety gates |
| Severity | Moderate |
| Probability Before Controls | Low (HMAC authentication on inference callbacks) |

### H-006: Data Loss Or Corruption

| Field | Value |
|-------|-------|
| Hazard | Case data or derived artifacts lost due to storage failure |
| Harm | Clinical workflow disruption, loss of audit trail |
| Severity | Low in RUO context |
| Probability Before Controls | Low (SQLite WAL mode, PostgreSQL ACID guarantees) |

### H-007: Bias In Volumetric Output

| Field | Value |
|-------|-------|
| Hazard | Systematic measurement bias across patient subgroups |
| Harm | Differential quality of care for affected populations |
| Severity | Moderate |
| Probability Before Controls | Medium (model bias is an inherent risk) |

## Risk Controls

### RC-001: Mandatory Clinician Review Gate (mitigates H-001)

The workflow state machine enforces that no case can transition from AWAITING_REVIEW to REVIEWED without an explicit clinician review action that includes reviewer identity and sign-off.

This control is verified by:
1. state machine tests preventing unauthorized transitions
2. API validation rejecting review payloads without required reviewer fields
3. report builder refusing to include review status without completed review record

Residual risk after control: **Broadly acceptable**. The mandatory review gate makes autonomous unreviewed delivery infeasible through the current API surface.

### RC-002: QC Disposition Gating (mitigates H-002, H-003)

The inference callback includes a QC disposition field. Cases with failed QC are flagged in the report and visible to the reviewing clinician.

Residual risk: **ALARP**. The clinician sees QC status and can reject or annotate accordingly.

### RC-003: Structured Export Validation (mitigates H-004)

DICOM SR and FHIR exports are built from validated ReportPayload data through deterministic builder functions. Export structure is verified by automated tests checking:
1. SOP Class UID correctness for DICOM SR
2. FHIR R4 resource type and coding correctness
3. presence of required fields including provenance and disclaimer
4. rejection of exports for unfinalized cases

Residual risk: **Broadly acceptable** for the current JSON envelope seam.

### RC-004: HMAC Authentication (mitigates H-005)

Inference callbacks are authenticated using HMAC-SHA256 signatures. The shared secret is configured per deployment and is not hardcoded.

Residual risk: **ALARP**. Replay attacks and secret rotation require additional production-deployment controls beyond the current repository scope.

### RC-005: Database Integrity (mitigates H-006)

SQLite uses WAL mode. PostgreSQL uses standard ACID transactions. Both backends verify schema migrations at startup.

Residual risk: **Broadly acceptable** for the current single-instance deployment model.

### RC-006: Research-Use Disclaimer (mitigates H-001, H-007)

Every output carries a research-use disclaimer. Export envelopes include disclaimer fields. The intended use is explicitly limited to research with clinician oversight.

Residual risk: **ALARP**. Disclaimer alone does not prevent misuse but establishes the boundary of manufacturer responsibility.

## Residual Risk Summary

| Hazard | Pre-Control Risk | Controls | Post-Control Risk |
|--------|-----------------|----------|-------------------|
| H-001 | Low-Moderate | RC-001, RC-006 | Broadly acceptable |
| H-002 | Medium-Moderate | RC-002 | ALARP |
| H-003 | Low-Moderate | RC-002 | ALARP |
| H-004 | Low-Low | RC-003 | Broadly acceptable |
| H-005 | Low-Moderate | RC-004 | ALARP |
| H-006 | Low-Low | RC-005 | Broadly acceptable |
| H-007 | Medium-Moderate | RC-006 | ALARP |

## Overall Risk-Benefit Evaluation

The overall residual risk of the current bounded slice is acceptable given:

1. the product is research-use-only
2. a mandatory clinician gate prevents autonomous clinical decision-making
3. risk controls are verified by automated tests
4. known limitations are documented and disclaimed

No unacceptable residual risks have been identified for the current intended use.

## Limitations

This baseline covers risks within the repository boundary. Production deployment risks including network security, container security, multi-tenant isolation, and real-time availability are out of scope and must be addressed in a deployment-specific risk assessment.

Expansion to additional workflow families or anatomical regions requires updating the hazard identification and repeating the risk estimation.
