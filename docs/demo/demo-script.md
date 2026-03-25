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

## Target Walk-Through

1. create or ingest a new MRI case
2. show the case entering the queue
3. open case detail and inspect metadata
4. generate or retrieve AI-assisted draft
5. show clinician review and amendment or approval
6. finalize case
7. show report preview
8. show delivery state or delivery retry path

## Required Evidence Capture

During the first complete demo run, capture:

1. startup command sequence
2. API transcript or logs for major state transitions
3. screenshots for queue, case detail, review, report, and delivery state
4. any manual operator steps still required

## Current Gap

This script is a staging artifact.

It becomes authoritative only after the standalone runtime and UI can actually execute the walk-through above.