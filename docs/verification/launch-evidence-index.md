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
2. main-branch `ci` build and test evidence is still pending capture in this index

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

- Status: partial
- Hosted note:
  - docs-governance hosted publication check is green on `1eac899`
  - main-branch `ci` install, build, and test proof is still pending capture
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

- Status: partial
- Artifact links:
  - `tests/memory-case-service.test.ts`
  - `docs/verification/runtime-baseline-verification.md`
  - `docs/verification/architecture-and-publication-audit-2026-03-25.md`

## 4. Frontend Verification

Required artifacts:

- frontend smoke test output
- screenshot bundle
- UI-to-endpoint mapping review

Record:

- Status: missing
- Artifact links:
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

- Status: partial
- Hosted note:
  - `docs-governance` GitHub-hosted proof: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23555671232`
  - public repository is live with About metadata applied
  - main-branch `ci` evidence is still missing from this ledger
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