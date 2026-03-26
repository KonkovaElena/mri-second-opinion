# Security Policy

## Scope

MRI Standalone is an early-stage open-source workflow project.

At the current stage, the repository should be treated as pre-production software and not as a clinically validated deployment artifact.

## Reporting A Vulnerability

Do not disclose exploitable details in a public issue.

Use one of these private reporting routes:

1. if GitHub Private Vulnerability Reporting is enabled for this repository, use the Security tab and submit the report there
2. otherwise email `security@microphoenix.io` with the subject prefix `[mri-second-opinion][security]`; this is the current shared security inbox for the repository until a repo-specific address is published

Current ownership posture is intentionally minimal:

1. no public named security maintainer is declared yet
2. the valid private routes are the repository Security tab if enabled, or the shared repository security inbox above
3. public issues, pull requests, and discussion threads are not valid channels for exploit details

Expected response windows:

1. initial acknowledgement within 5 business days
2. follow-up status update within 14 calendar days
3. coordinated disclosure after a fix or mitigation path exists

## Safe Disclosure Expectations

1. include affected file paths or surfaces
2. include reproduction steps when safe
3. avoid posting secrets, PHI, or patient data
4. avoid attaching real clinical data
5. include whether the report affects public release claims, local demo paths, or runtime safety boundaries

## Current Security Position

1. clinician-in-the-loop is mandatory
2. synthetic demo data should be used for public examples
3. public repository state must not be represented as production-hardened without evidence
4. hosted GitHub publication should not proceed without one valid private reporting route remaining available