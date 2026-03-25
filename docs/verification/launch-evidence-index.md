# MRI Standalone Launch Evidence Index

This file is the evidence ledger for MRI Standalone release readiness.

Every claim about launch readiness should link back to one or more artifacts listed here.

## Repository Status

- Current verdict: `NOT_READY`
- Last reviewed: 2026-03-25
- Public repository: `https://github.com/KonkovaElena/mri-second-opinion`
- Auditor handoff: `docs/verification/ai-auditor-handoff-2026-03-25.md`
- Repository audit: `docs/verification/repository-audit-2026-03-25.md`
- Hosted evidence scaffold: `docs/verification/hosted-evidence-capture-template.md`

## Hosted Workflow Snapshot

Recorded hosted evidence today:

1. `docs-governance` succeeded on GitHub-hosted runners for commit `1eac899` on 2026-03-25:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23555671232`
2. `ci` succeeded on GitHub-hosted runners for commit `177094a` on 2026-03-25:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374310`
3. `docs-governance` also succeeded on `177094a`:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374341`
4. `docs-governance` succeeded on `8f851b3` after the auditor-handoff corrections:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23557754782`
5. `docs-governance` succeeded on `49b794c` after adding the pending manual GitHub actions runbook:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23557837645`

## Priority Tracks

Use these two tracks when deciding what evidence to gather next.

### Track A: Public GitHub readiness

Focus on:

1. clean checkout and build proof
2. public repository hygiene
3. documentation honesty
4. GitHub-facing metadata and repository-card discipline

Primary planning references:

1. `../releases/public-github-and-mvp-path.md`
2. `../launch-readiness-checklist.md`
3. `../releases/github-publication-playbook.md`

### Track B: Internal MVP closure

Focus on:

1. API workflow verification
2. durable state verification
3. frontend verification
4. demo verification

Primary planning references:

1. `../architecture/mvp-work-package-map.md`
2. `../architecture/neuro-first-mvp-slice.md`

## Evidence Categories

## 1. Clean Checkout And Build

Required artifacts:

- CI install log
- CI build log
- local clean-checkout run transcript

Record:

- Status: complete
- Hosted note:
  - `ci` green on `177094a`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374310`
  - `docs-governance` green on `177094a`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374341`
  - `docs-governance` green on `8f851b3`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23557754782`
  - `docs-governance` green on `49b794c`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23557837645`
- Artifact links:
  - `package.json`
  - `package-lock.json`
  - `tsconfig.json`
  - `.env.example`
  - `src/config.ts`
  - `src/app.ts`
  - `src/index.ts`
  - `.github/workflows/ci.yml`
  - `docs/verification/runtime-baseline-verification.md`
  - `docs/verification/repository-audit-2026-03-25.md`
  - `docs/releases/public-github-and-mvp-path.md`
  - `tests/workflow-api.test.ts`
  - `tests/memory-case-service.test.ts`

## 2. API Workflow Verification

Required artifacts:

- route inventory
- endpoint contract tests
- end-to-end API transcript for intake, review, finalize, report, and retry

Record:

- Status: partial
- Artifact links:
  - `tests/workflow-api.test.ts`
  - `tests/memory-case-service.test.ts`
  - `tests/postgres-integration.test.ts`
  - `src/cases.ts`
  - `docs/verification/worker-artifact-contract-samples.md`
  - `docs/verification/runtime-baseline-verification.md`
  - `docs/verification/repository-audit-2026-03-25.md`
  - `docs/verification/architecture-and-publication-audit-2026-03-25.md`

## 3. Durable State Verification

Required artifacts:

- migration run log
- restart persistence test output
- queue rebuild proof
- delivery retry history proof

Record:

- Status: complete for the current local baseline
- Artifact links:
  - `tests/memory-case-service.test.ts`
  - `tests/postgres-case-repository.test.ts`
  - `tests/postgres-integration.test.ts`
  - `tests/db-migrations.test.ts`
  - `src/db-migrations.ts`
  - `scripts/db-migrate.ts`
  - `scripts/db-migrate-smoke.ts`
  - `.github/workflows/ci.yml` (postgres-smoke job)
  - `docs/verification/runtime-baseline-verification.md`
  - `docs/verification/architecture-and-publication-audit-2026-03-25.md`

Recorded local evidence on 2026-03-25:

1. `npm test` passed with `35/35` tests in the standalone subtree after the durable queue-model and worker-artifact tests were added
2. `npm run db:migrate:smoke` succeeded against a clean local `postgres:17-alpine` container
3. the smoke confirmed `schema_migrations` contains `001_create_case_records`
4. the smoke confirmed the `case_records` table exists after migration
5. `tests/memory-case-service.test.ts` verifies that the workflow queue and operations read model rebuild correctly from durable records across restart
6. `tests/postgres-integration.test.ts` verifies restart survival, full lifecycle persistence, and delete propagation through the Postgres repository layer, including persisted workflow-queue state
7. CI `postgres-smoke` job added to `.github/workflows/ci.yml` — runs migration against a `postgres:17-alpine` service container and verifies schema on GitHub-hosted runners
8. `tests/memory-case-service.test.ts`, `tests/workflow-api.test.ts`, and `tests/postgres-integration.test.ts` verify durable study-context, QC artifact, and findings-payload surfaces across snapshot restart, API detail reads, and PostgreSQL restart

## 4. Frontend Verification

Required artifacts:

- frontend smoke test output
- screenshot bundle
- UI-to-endpoint mapping review

Record:

- Status: partial
- Artifact links:
  - `tests/workflow-api.test.ts`
  - `src/app.ts`
  - `docs/verification/operator-surface-verification.md`
  - `docs/architecture/mvp-work-package-map.md`

## 5. Demo Verification

Required artifacts:

- synthetic demo input package provenance note
- demo setup transcript
- completed walk-through transcript
- screenshot set used by README

Record:

- Status: missing
- Artifact links:
  - `docs/demo/demo-script.md`
  - `docs/architecture/mvp-work-package-map.md`

## 6. Public Repository Hygiene

Required artifacts:

- CI status proof
- file inventory for root governance docs
- workflow permission review
- repository-card and About metadata plan
- go-live operator checklist

Record:

- Status: complete
- Hosted note:
  - `docs-governance` green on `1eac899`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23555671232`
  - `ci` green on `177094a`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374310`
  - `docs-governance` green on `177094a`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23556374341`
  - `docs-governance` green on `8f851b3`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23557754782`
  - `docs-governance` green on `49b794c`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23557837645`
  - public repository is live with About metadata applied
- Artifact links:
  - `README.md`
  - `LICENSE`
  - `CODE_OF_CONDUCT.md`
  - `SECURITY.md`
  - `CONTRIBUTING.md`
  - `SUPPORT.md`
  - `GOVERNANCE.md`
  - `.github/ISSUE_TEMPLATE/bug-report.yml`
  - `.github/ISSUE_TEMPLATE/feature-request.yml`
  - `.github/ISSUE_TEMPLATE/docs-scope.yml`
  - `.github/PULL_REQUEST_TEMPLATE.md`
  - `.github/dependabot.yml`
  - `.github/workflows/docs-governance.yml`
  - `.github/workflows/ci.yml`
  - `docs/verification/public-repository-hygiene-review.md`
  - `docs/verification/hosted-evidence-capture-template.md`
  - `docs/releases/github-publication-playbook.md`
  - `docs/releases/github-go-live-checklist.md`
  - `docs/releases/github-metadata-copy.md`
  - `docs/releases/pending-manual-github-actions.md`
  - `docs/releases/github-settings-worksheet.md`
  - `docs/releases/github-live-publication-sequence.md`
  - `docs/releases/first-public-announcement-draft.md`
  - `docs/releases/github-operator-packet.md`
  - `docs/demo/social-preview-brief.md`
  - `docs/scope-lock.md`
  - `docs/status-model.md`
  - `docs/api-scope.md`
  - `docs/architecture/overview.md`
  - `docs/releases/v1-go-no-go.md`
  - `docs/releases/public-github-and-mvp-path.md`

## 7. Documentation Honesty Review

Required artifacts:

- README-to-runtime review note
- API scope-to-runtime review note
- status model-to-runtime review note
- jargon cleanup review note

Record:

- Status: partial
- Artifact links:
  - `docs/verification/documentation-honesty-review.md`
  - `docs/verification/repository-audit-2026-03-25.md`
  - `docs/releases/v1-go-no-go.md`
  - `docs/releases/public-github-and-mvp-path.md`
  - `docs/releases/github-publication-playbook.md`
  - `README.md`
  - `docs/academic/evidence-and-claims-policy.md`
  - `docs/verification/runtime-baseline-verification.md`
  - `docs/verification/architecture-and-publication-audit-2026-03-25.md`

## 8. Academic Rationale Layer

Required artifacts:

- claims and evidence policy
- open-source stack rationale
- consistency with public architecture and scope documents

Record:

- Status: partial
- Artifact links:
  - `docs/academic/evidence-and-claims-policy.md`
  - `docs/academic/open-source-rationale.md`
  - `docs/architecture/overview.md`
  - `docs/open-source-target-architecture.md`

## Change Rule

When a release verdict changes, update this file and cite the exact evidence artifacts that justify the new verdict.

When a work package closes, also update the relevant record here even if the top-level verdict does not change yet.