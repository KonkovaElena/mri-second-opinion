---
title: "Demo Flow Audit 2026-03-27"
status: "active"
version: "1.0.0"
last_updated: "2026-03-27"
tags: [verification, demo, api, mri]
role: evidence
---

# Demo Flow Audit 2026-03-27

## Purpose

Record the deterministic synthetic demo-flow verification that now exists in the standalone MRI repository.

This audit covers the API-only walk-through.

It does not claim that the frontend demo path is complete.

## Verified Demo Path

The repository now contains a deterministic integration test in `tests/workflow-api.test.ts` that covers:

1. synthetic case intake
2. queue visibility through `GET /api/cases`
3. case detail metadata inspection through `GET /api/cases/:caseId`
4. draft generation via the inference callback
5. clinician review
6. finalization
7. report preview retrieval
8. delivery-state transition to `DELIVERED`

The test uses a named synthetic case payload so the path is reproducible.

## Validation Performed

Validation completed on 2026-03-27:

1. changed-file diagnostics passed for `tests/workflow-api.test.ts`
2. standalone subtree tests passed via `npm test`
3. standalone subtree build passed via `npm run build`

## Boundary Statement

This closes the deterministic demo verification path requested by the standalone execution plan.

It does not close broader demo credibility requirements that still depend on:

1. frontend walk-through evidence
2. screenshots
3. operator run transcript

## Audit Decision

`Add demo verification tests` is complete for the API-only standalone path.