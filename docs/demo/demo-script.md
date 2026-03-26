# MRI Standalone Demo Script

Status: draft

This script defines the minimum truthful demo for MRI Standalone v1.

Do not present steps that are not yet implemented in the standalone repository.

## Demo Goal

Show the MRI second-opinion workflow from intake to delivery state using synthetic data and explicit clinician review.

## Preconditions

1. standalone repository boots locally
2. synthetic MRI-safe demo package is available
3. queue screen is operational
4. case detail screen is operational
5. final report preview is operational
6. signed worker scaffold can execute one claim -> heartbeat -> callback transcript

## Target Walk-Through

1. create or ingest a new MRI case
2. show the case entering the queue
3. open case detail and inspect metadata
4. run the bounded worker transcript and show lease heartbeat plus signed callback
5. show clinician review and amendment or approval
6. finalize case
7. show report preview
8. show delivery state or delivery retry path

## Required Evidence Capture

During the first complete demo run, capture:

1. startup command sequence
2. API transcript or logs for major state transitions, including signed worker claim, heartbeat, and callback
3. screenshots for queue, case detail, review, report, and delivery state
4. any manual operator steps still required

## Current Gap

This script is a staging artifact.

It becomes authoritative only after the standalone runtime and UI can actually execute the walk-through above.

The current worker-loop proof source is `tests/fixtures/worker-inference-transcript.json` plus the HMAC transcript test in `tests/workflow-api.test.ts`.

## Current Proof Anchors Before PR-18

Use these artifacts when checking whether the future demo script is still truthful:

1. signed worker claim, heartbeat, and callback proof: `tests/workflow-api.test.ts` plus `tests/fixtures/worker-inference-transcript.json`
2. queue and worker diagnostics proof: `GET /api/operations/summary` assertions in `tests/workflow-api.test.ts` and `tests/memory-case-service.test.ts`
3. delivery-safe release pin proof: `tests/memory-case-service.test.ts` for pinned finalized release behavior and delivery dispatch claims
4. current runtime evidence note: `docs/verification/runtime-baseline-verification.md`

These anchors justify planning the demo path.

They do not yet justify changing the repository verdict from `NOT_READY`.

## Active Packet Links

The current bounded demo packet is:

1. `docs/demo/synthetic-demo-input-provenance.md`
2. `docs/demo/demo-transcript.md`

The screenshot bundle is still missing.