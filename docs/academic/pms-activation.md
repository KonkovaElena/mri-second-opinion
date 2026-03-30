# PMS Activation And Evidence Collection

Date: 2026-03-30

## Purpose

This document bridges the post-market surveillance transition plan (`docs/regulatory/pms-plan.md`) and the current repository state by defining what evidence collection activities should begin now in RUO mode and what activation criteria must be met before the PMS plan becomes an operational program.

## Current State

The PMS transition plan describes the surveillance program the repository should grow into.

This document defines the evidence collection activities that can start today without requiring a full regulated PMS program.

## Evidence Collection Activities For RUO Mode

### Activity 1: Version-Linked Test Evidence

Every repository release or tagged version should have test evidence linked to it.

This means:

1. test pass count and skip count recorded per version
2. export validation results recorded per version
3. architecture or workflow regression noted if any tests fail

Current state: test evidence is recorded in `docs/verification/launch-evidence-index.md` and linked to version heads.

### Activity 2: Dependency Vulnerability Tracking

Per the vulnerability response SOP, dependency advisories should be tracked and linked to repository versions.

This means:

1. `npm audit` output reviewed per release
2. SBOM regenerated per release
3. any vulnerability remediation documented in the known-bugs register or release notes

Current state: SBOM generation is available via `npm run sbom`. Vulnerability response SOP is documented.

### Activity 3: Workflow Failure Inventory

Any workflow failure discovered during evaluation runs should be recorded with:

1. case identifier or pseudonym
2. failure mode (QC rejection, processing error, export error, review error)
3. root cause if determinable
4. resolution status

Current state: no evaluation runs have been executed yet. The failure inventory will be populated when the reader study begins.

### Activity 4: Documentation Drift Monitoring

Governance documents should be audited for drift at each release milestone.

Drift means:

1. a document claims something the code no longer supports
2. a document omits a capability the code now provides
3. two documents disagree about the same surface

Current state: evidence index and roadmap are maintained per wave. Drift monitoring is manual.

## PMS Activation Criteria

The PMS plan should be upgraded from transition document to active program when all of the following are true:

1. intended use is formally narrowed beyond RUO
2. a reader study or equivalent evaluation has been completed
3. subgroup analysis has been executed per the analysis plan
4. incident handling responsibilities are assigned to named individuals
5. a release management process is formalized beyond repository tagging
6. data governance controls are implemented beyond policy documentation

## Pre-Activation Evidence Milestones

| Milestone | Evidence | Status |
|-----------|----------|--------|
| Stable workflow version | 102+ tests, 0 fails | Complete |
| Export seams validated | DICOM SR + FHIR R4 tests pass | Complete |
| Regulatory governance pack | PCCP + IEC 62304 + ISO 14971 + data governance + vuln SOP | Complete |
| Reader study protocol written | Applicable to neuro-first slice | Complete |
| Subgroup analysis plan written | Operationalizes bias framework | Complete |
| Reader study executed | -- | Not started |
| Subgroup analysis executed | -- | Not started |
| PMS plan activated | All activation criteria met | Not started |

## Limitations

This document does not constitute an active PMS program.

It defines the evidence collection discipline and activation criteria.

The distinction matters because claiming an active PMS program without meeting activation criteria would be dishonest.
