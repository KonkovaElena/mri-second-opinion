# Dependency Reproducibility Audit

Date: 2026-04-12

## Purpose

This note records the April 12, 2026 dependency and runtime-metadata recheck for the standalone MRI repository.

It closes the previously active local concern that the public release story was stronger than the frozen-install proof available in CI and release workflows.

## Scope

Audited surfaces:

1. `package.json`
2. `package-lock.json`
3. `.github/workflows/ci.yml`
4. `.github/workflows/release.yml`
5. `README.md`
6. `docs/verification/runtime-baseline-verification.md`
7. `docs/verification/release-validation-packet.md`
8. `docs/verification/launch-evidence-index.md`

## Findings

### 1. Manifest and lock root are now aligned

The root `package.json` and `package-lock.json` agree on the active Node and dependency baseline:

1. Node engine: `>=24`
2. Express: `^5.2.1`
3. Active direct runtime dependencies: AWS S3 client and presigner, Express 5, express-rate-limit, helmet, pg, prom-client, redis, and zod
4. Active direct dev dependencies: CycloneDX npm CLI, `@types/*`, `pg-mem`, `tsx`, and TypeScript 6

This closes the earlier drift where the human-readable manifest and the lock-backed runtime graph were telling materially different stories.

### 2. Strict frozen installs now pass locally

Local verification on 2026-04-12 confirmed that `npm ci` succeeds cleanly on the current head.

This matters because the official npm CLI contract defines `npm ci` as the clean-install path for automated environments: it requires an existing lockfile, fails when `package.json` and the lock disagree, removes pre-existing `node_modules`, and never rewrites manifest or lock state.

### 3. Workflow rails were still using mutable installs

Even though the manifest and lock are now aligned, the active GitHub Actions `ci` and `release` workflows were still using `npm install`.

That left a release-proof gap: hosted validation could succeed while silently tolerating future manifest-lock drift.

## Remediation applied

1. switched `.github/workflows/ci.yml` from `npm install` to `npm ci`
2. switched `.github/workflows/release.yml` from `npm install` to `npm ci`
3. updated `README.md` quick-start commands to the current reproducible install path
4. updated active verification docs so they no longer claim that the Node 24 Linux path requires `npm install --omit=optional`

## Validation

Local rerun on the current working head:

1. `npm ci` — success
2. `npm run build` — success
3. `npm test` — `239` total, `238` passing, `0` failing, `1` skipped

## Remaining gap

Hosted proof for the new frozen-install lane is still pending the next GitHub Actions run on the head that includes this remediation.

That is now a hosted-evidence gap, not a local dependency-truth gap.