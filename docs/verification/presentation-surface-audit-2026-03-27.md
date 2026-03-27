---
title: "Presentation Surface Audit 2026-03-27"
status: "active"
version: "1.0.0"
last_updated: "2026-03-27"
tags: [verification, presentation, api, mri]
role: evidence
---

# Presentation Surface Audit 2026-03-27

## Purpose

Record the closure of the presentation-surface tightening step for the standalone MRI API.

The goal of this step was to stop exposing raw internal read models directly on the public read endpoints.

## Implemented Runtime Change

Public read-side presentation is now routed through presenter helpers in `src/case-presentation.ts`.

The changed endpoints are:

1. `GET /api/cases`
2. `GET /api/cases/:caseId`
3. `GET /api/cases/:caseId/report`
4. `GET /api/operations/summary`

The presenters now provide:

1. stable list items for case collections
2. detail payloads with `planSummary` and `reportSummary` instead of raw internal planner state
3. report envelopes that separate `artifactRefs` from typed `artifacts`
4. summary envelopes with explicit `totals` plus `byStatus`, `recentOperations`, and `retryHistory`

## Deliberate Non-Goals

This step does not rename routes or redesign write-side callback payloads.

It also does not remove every internal field from write responses.

The tightening is intentionally scoped to the read surfaces named in the standalone gap audit.

## Validation Performed

Validation completed on 2026-03-27:

1. changed-file diagnostics passed for `src/case-presentation.ts`, `src/app.ts`, and `tests/workflow-api.test.ts`
2. standalone subtree tests passed via `npm test`
3. standalone subtree build passed via `npm run build`

## Audit Decision

`Tighten presentation surfaces` is complete for the standalone repository.

The remaining plan steps are:

1. deterministic demo verification coverage
2. final closure audits