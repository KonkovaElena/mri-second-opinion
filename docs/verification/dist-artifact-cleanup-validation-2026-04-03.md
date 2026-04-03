---
title: "Dist Artifact Cleanup Validation"
status: "active"
version: "1.0.0"
last_updated: "2026-04-03"
tags: [verification, build, dist, runtime]
role: evidence
---

# Dist Artifact Cleanup Validation

Date: 2026-04-03

## Purpose

This note records the local closure of the committed `dist` residue identified in the 2026-04-03 runtime boundary revalidation.

## Before

The working tree contained compiled top-level `dist` artifacts that no longer had current `src` peers:

1. `dist/artifact-store.js`
2. `dist/case-projections.js`
3. `dist/dispatch-queue.js`
4. `dist/orthanc-bridge.js`
5. `dist/postgres-case-repository.js`
6. `dist/runtime-contract.js`

## Action

The orphaned files were removed from the committed `dist` set.

## Verification

1. `npm run build` succeeds on the cleaned runtime artifact set
2. the stale filenames above no longer exist under `dist/`
3. the runtime entrypoint remains unchanged and still points to `dist/index.js` in both `package.json` and `Dockerfile`

## Interpretation

The local working tree no longer has the `dist`/`src` parity issue that previously weakened runtime provenance clarity.

This closes the `dist` residue finding for the current local head.

It does not by itself close hosted-evidence lag, because the latest hosted-validated head still predates this cleanup.