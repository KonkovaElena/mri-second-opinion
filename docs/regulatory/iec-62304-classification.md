# IEC 62304 Software Safety Classification

Date: 2026-03-27

## Purpose

This document applies IEC 62304:2006/AMD1:2015 software lifecycle classification to the standalone MRI second-opinion repository.

It describes the current implemented software and its safety classification rationale.

## Regulatory Context

IEC 62304 requires that software used as or within a medical device be classified into one of three safety classes:

1. Class A — no injury or damage to health is possible
2. Class B — non-serious injury is possible
3. Class C — death or serious injury is possible

The classification determines the rigor of the software lifecycle process requirements including architecture documentation, risk analysis integration, verification and validation depth, and maintenance and problem resolution procedures.

## Current Product Classification

### Classification Decision

The current repository is classified as **Class A with Class B transitional controls**.

### Rationale

The repository is currently research-use-only software with mandatory clinician-in-the-loop review before any output is used in a clinical context.

Under Class A, no injury or damage to health is possible because:

1. the software does not make autonomous clinical decisions
2. all outputs require explicit clinician review and sign-off before finalization
3. the system enforces a mandatory review gate in the workflow state machine that cannot be bypassed through the API
4. the intended use statement limits the product to research and decision-support contexts
5. every output carries a research-use disclaimer

However, because the output domain is medical imaging and the software could influence clinical decision-making if improperly deployed, the repository applies Class B-level controls proactively:

1. version-controlled quality documentation
2. architecture documentation maintained as active design-control surfaces
3. risk analysis artifacts maintained alongside the codebase
4. regression test coverage for safety-critical workflow transitions
5. structured export validation against healthcare interoperability standards

## Software System Architecture Decomposition

IEC 62304 Section 5.3 requires identification of software items and their safety classification.

### Software Items

| Item | Description | Classification |
|------|-------------|----------------|
| Workflow API | Express HTTP server managing case lifecycle | Class A |
| Case State Machine | 7-state SUBMITTED→DELIVERED transition engine | Class A |
| Inference Callback Handler | HMAC-authenticated result ingestion | Class A |
| Clinician Review Gate | Mandatory review with identity and sign-off | Class B controls |
| Report Builder | Finalized report assembly with provenance | Class A |
| DICOM SR Export | Structured report envelope generation | Class A |
| FHIR Export | DiagnosticReport R4 resource generation | Class A |
| Persistence Layer | SQLite and PostgreSQL case storage | Class A |
| Artifact Manager | Derived-artifact manifest and storage | Class A |

### Classification Notes

The Clinician Review Gate receives Class B controls because it is the primary safety-critical boundary. If this gate malfunctioned, unreviewed outputs could be delivered. The current implementation enforces the gate at the state machine level, the API validation level, and the report builder level.

## Software Development Process Mapping

### Class A Requirements Already Met

1. software development planning documented in the action plan
2. software requirements traceable to test cases
3. software architecture documented in threat model and this classification
4. software unit verification through 102+ automated tests
5. software integration verification through end-to-end workflow tests
6. software release with version-tagged artifacts

### Class B Controls Applied Proactively

1. risk analysis integration through the ISO 14971 risk management baseline
2. traceability between risk controls and test evidence
3. SOUP (software of unknown provenance) management through SBOM generation
4. problem resolution documented in known-bugs tracking
5. change control documented through version-controlled documentation

## SOUP Identification

Software of unknown provenance relevant to IEC 62304 includes:

1. Node.js runtime
2. Express web framework
3. better-sqlite3 database driver
4. pg PostgreSQL client
5. Zod validation library
6. CycloneDX SBOM tooling

Each SOUP item is tracked in the lockfile-based SBOM seam and subject to vulnerability monitoring per the vulnerability response SOP.

## Maintenance And Problem Resolution

The current maintenance surface includes:

1. automated test regression on every change
2. SBOM regeneration on dependency changes
3. known-bugs tracking for discovered defects
4. post-market surveillance transition plan for field-detected issues

## Limitations

This classification applies to the current RUO-scoped repository.

If the intended use changes to include autonomous decision-making, direct diagnostic claims, or deployment without clinician oversight, the classification must be upgraded to Class B or Class C and the corresponding lifecycle process requirements must be applied.
