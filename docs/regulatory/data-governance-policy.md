# Data Governance Policy

Date: 2026-03-27

## Purpose

This document defines the data governance policy for the standalone MRI second-opinion repository.

It describes what data the system handles, how it is stored and protected, and what governance controls are in place for the current implemented slice.

## Scope

This policy applies to the data managed by the repository in its current form:

1. case metadata including patient alias, study reference, and workflow configuration
2. inference results including QC disposition, findings, measurements, and processing summary
3. clinician review records including reviewer identity and final impression
4. derived artifacts generated during the workflow
5. finalized reports with provenance and disclaimer
6. structured exports in DICOM SR and FHIR R4 formats

It does not cover:

1. raw DICOM pixel data or imaging files
2. inference model weights or training data
3. external PACS or EHR systems
4. data in transit over network infrastructure beyond the local API boundary

## Data Classification

### Clinical Data (Sensitivity: High)

1. patient alias
2. study reference UIDs
3. inference findings and measurements
4. clinician review records and final impression
5. finalized report content

### Operational Data (Sensitivity: Medium)

1. case status and lifecycle timestamps
2. artifact manifest and storage metadata
3. workflow configuration parameters
4. request correlation identifiers

### System Data (Sensitivity: Low)

1. application logs
2. health check responses
3. SBOM dependency inventory

## Data Minimization

The repository currently applies the following data minimization controls:

1. patient identification is limited to an alias — the system does not store patient name, date of birth, or national identifier
2. study reference is limited to the study UID needed to link the case to the imaging source
3. inference results store only the computed output, not the raw input data
4. clinician review stores only the review decision, not the full clinical reasoning

## Data Retention

### Current Implementation

The current repository does not implement automated data retention or deletion.

All case data persists in the configured storage backend until manually removed.

### Target State

A future governed deployment should implement:

1. configurable retention periods per data classification level
2. automated anonymization or deletion of clinical data after retention expiry
3. audit-logged deletion operations
4. retention policy enforcement at the storage layer

## Access Controls

### Current Implementation

1. API routes are unauthenticated except for inference callbacks which use HMAC-SHA256
2. the workbench review surface serves from the same process
3. no role-based access control is implemented at the application level

### Target State

A future governed deployment should implement:

1. authenticated access for all clinical data routes
2. role-based access distinguishing operators, reviewing clinicians, and administrators
3. audit logging of data access events
4. session management with timeout and revocation

## Data Integrity Controls

### Currently Implemented

1. Zod schema validation on all API inputs
2. state machine enforcement preventing invalid workflow transitions
3. SQLite WAL mode and PostgreSQL ACID transactions
4. HMAC authentication on inference callbacks preventing unauthorized data injection
5. report builder requiring complete provenance chain before finalization
6. derived-artifact manifest tracking for output integrity

### What These Controls Do Not Cover

1. end-to-end encryption of data at rest
2. cryptographic integrity verification of stored artifacts
3. tamper-evident audit logging
4. data lineage tracking across external system boundaries

## Cross-Border Transfer

The current repository is a standalone application with no built-in data transfer mechanisms beyond its local API surface.

If deployed in a context where cross-border data transfer applies, the following must be addressed:

1. applicable data protection regulation mapping
2. transfer impact assessment
3. appropriate safeguards for the transfer mechanism
4. data subject rights implementation

## Incident Response For Data Events

Data governance incidents should be handled per the vulnerability response SOP with additional considerations:

1. assess whether personal or clinical data was exposed
2. determine the scope of affected records
3. notify relevant governance or supervisory functions
4. document the incident and corrective actions in the known-bugs or incident register

## Limitations

This policy describes the governance posture of the current repository code.

It does not constitute a data protection impact assessment and should not be used as evidence of regulatory compliance with GDPR, HIPAA, or other data protection frameworks.

Deployment in a regulated environment requires extending this policy to cover the specific deployment infrastructure, organization, and jurisdiction.
