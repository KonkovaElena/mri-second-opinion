---
title: "MRI Second Opinion Synthetic Demo Input Provenance"
status: "active"
version: "1.0.0"
last_updated: "2026-03-26"
tags: [mri, demo, evidence, synthetic]
---

# MRI Second Opinion Synthetic Demo Input Provenance

## Purpose

Define the current synthetic-safe input packet that may be used for a bounded local demo of the MRI Second Opinion workflow.

## Governing Rule

The demo path must use synthetic or obviously non-clinical inputs only.

No patient-identifiable or clinical-origin imaging data is part of this packet.

## Current Input Sources

1. `tests/fixtures/worker-inference-transcript.json`
2. the synthetic create-case payloads already exercised in `tests/workflow-api.test.ts`

## Synthetic-Safe Properties

The current packet is acceptable for bounded local demonstration because it uses:

1. synthetic `patientAlias` values
2. synthetic `studyUid` values
3. sequence names only (`T1w`, `FLAIR`) rather than source imaging payloads
4. synthetic findings, measurements, artifact URIs, and generated-summary text
5. clearly non-clinical worker and correlation identifiers

## Current Bounded Packet

The worker transcript fixture currently defines:

1. one synthetic case-create payload
2. one `inference` dispatch-claim request
3. one lease-heartbeat step
4. one inference callback payload with synthetic findings and artifact references

## What This Proves

This packet is sufficient to prove:

1. the demo can stay within synthetic-safe inputs
2. the current worker loop can be exercised without inventing extra runtime contracts
3. the bounded neuro-first path can be narrated from intake through delivery state

## What This Does Not Prove

This provenance note does not prove:

1. a packaged DICOM demo dataset
2. a one-click seeded local environment
3. screenshot-backed operator capture
4. a verdict upgrade beyond `NOT_READY`