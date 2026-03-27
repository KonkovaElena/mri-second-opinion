# SBOM Policy

Date: 2026-03-27

## Purpose

This document defines the software bill of materials surface for the standalone MRI second-opinion repository.

Its job is to make dependency transparency explicit without overstating supply-chain completeness.

## Current Scope

The current SBOM surface covers the Node.js standalone repository itself.

That means the current document applies to:

1. the TypeScript API runtime
2. its direct and transitive npm dependencies resolved from `package-lock.json`
3. the CI artifact generated from the checked-out repository state

It does not yet cover:

1. container base images
2. host operating-system packages
3. Orthanc or DICOM infrastructure images
4. a future Python worker stack
5. model weights, datasets, or external inference services

## Current Implementation

The repository now maintains a CycloneDX SBOM seam through two entrypoints.

1. local generation via `npm run sbom`
2. GitHub-hosted artifact generation in `.github/workflows/ci.yml`

The current command uses `@cyclonedx/cyclonedx-npm` in lockfile-only mode and writes a reproducible JSON artifact to `artifacts/sbom.cdx.json`.

This follows the current tool contract exposed by the upstream CLI, including `--package-lock-only`, `--output-format JSON`, and `--output-file`.

Lockfile-only mode is intentional here because it produces a stable repository dependency inventory without depending on local `node_modules` layout quirks.

## Operating Rules

1. regenerate the SBOM whenever `package.json` or `package-lock.json` changes materially
2. treat the generated SBOM as evidence of repository dependency composition, not as proof that every dependency is safe
3. keep the SBOM artifact out of git history unless a future release packet explicitly needs a checked-in snapshot
4. use the CI-uploaded artifact as the canonical hosted evidence surface for the exact workflow run
5. pair SBOM review with ordinary dependency-update and vulnerability-triage discipline

## Why This Exists In RUO Mode

The repository is still RUO software.

Even so, an explicit SBOM seam reduces later rework because it gives the project a repeatable dependency inventory before broader operational, security, or regulatory claims are attempted.

This is especially useful for:

1. open-source disclosure hygiene
2. vulnerability triage
3. reproducibility and audit support
4. future release-packet assembly

## Limits

The current SBOM should not be misread as:

1. a complete medical-device cybersecurity file
2. a container or deployment bill of materials
3. a vulnerability assessment
4. a signed provenance attestation
5. a substitute for release-specific threat review

## Next Expansion Path

When the repository grows beyond the standalone Node.js baseline, the SBOM surface should expand in this order.

1. application container images
2. Python worker environment and imaging-tool dependency tree
3. infrastructure images used for reproducible demo or release bundles
4. signed provenance and release-archive capture if regulated-release planning begins

## Interaction With Other Docs

Use this document together with:

1. `threat-model.md` for the security-risk framing
2. `../academic/evidence-and-claims-policy.md` for claim discipline
3. `../academic/regulatory-positioning.md` for RUO and future regulated-posture context
4. `../verification/launch-evidence-index.md` for hosted evidence routing