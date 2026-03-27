---
title: "PostgreSQL Bootstrap Audit 2026-03-27"
status: "active"
version: "1.0.0"
last_updated: "2026-03-27"
tags: [verification, postgres, bootstrap, durability, mri]
role: evidence
---

# MRI Standalone PostgreSQL Bootstrap Audit 2026-03-27

## Purpose

Record the first live clean-database PostgreSQL bootstrap proof for the standalone repository.

This audit proves that the repository's declared PostgreSQL bootstrap path can create the required schema and tables from empty state.

It does not claim hosted runtime proof, end-to-end real-PostgreSQL workflow execution, or broader production durability beyond clean bootstrap.

## Implemented Surfaces Exercised

The proof exercised these repository surfaces:

1. `src/postgres-bootstrap.ts`
2. `scripts/verify-postgres-bootstrap.ts`
3. `package.json` script `verify:postgres-bootstrap`
4. `.env.example` PostgreSQL environment contract

## Verification Environment

Validation completed on 2026-03-27 against a temporary local PostgreSQL container:

1. image: `postgres:16-alpine`
2. database: `mri_second_opinion`
3. schema: `mri_wave1`
4. connection target: `postgresql://postgres:postgres@127.0.0.1:55432/mri_second_opinion`

## Commands Run

The runtime proof used these commands:

```powershell
docker rm -f mri-postgres-proof 2>$null
docker run -d --name mri-postgres-proof -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mri_second_opinion -p 55432:5432 postgres:16-alpine
docker exec mri-postgres-proof pg_isready -U postgres -d mri_second_opinion
$env:MRI_CASE_STORE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/mri_second_opinion'
$env:MRI_CASE_STORE_SCHEMA = 'mri_wave1'
npm run verify:postgres-bootstrap
```

## Observed Output

The verifier returned this success signal:

```text
[mri-second-opinion] PostgreSQL bootstrap verified schema=mri_wave1 tables=case_records,delivery_jobs,store_metadata statementsApplied=9
```

## Verified Behaviors

The following behaviors are now backed by live proof:

1. the PostgreSQL bootstrap path accepts the documented environment contract
2. the bootstrap path creates the target schema from empty state
3. the bootstrap path creates `store_metadata`, `case_records`, and `delivery_jobs`
4. the bootstrap path completes successfully against a real PostgreSQL server, not only the pg-mem test harness

## Boundary Note

This audit closes the clean-database bootstrap proof needed by Gate 3 in the launch checklist.

Open PostgreSQL-related evidence gaps still include:

1. release-linked or hosted workflow verification on a real PostgreSQL runtime path
2. broader real-PostgreSQL durability proof beyond bootstrap-only initialization
3. distributed or externally brokered worker execution proof

## Audit Decision

The standalone repository now has truthful evidence that its PostgreSQL bootstrap path works from a clean database.

The formal release verdict remains governed by `docs/releases/v1-go-no-go.md`.