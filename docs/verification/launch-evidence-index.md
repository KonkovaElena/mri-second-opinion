# MRI Standalone Launch Evidence Index

This file is the evidence ledger for MRI Standalone release readiness.

Every claim about launch readiness should link back to one or more artifacts listed here.

## Repository Status

- Current verdict: `PUBLIC_GITHUB_READY`
- Last reviewed: 2026-03-29
- Current remote head: `b295a2a98362168df11b7e36600733893f22e154`
- Latest hosted-validated head: `1e340b978bfa35a2ed339adcdb0d2add56cc08c3`
- Wave 1.5 evidence status: in progress until one same-head reconciliation commit carries both hosted `ci` and `docs-governance`; the current remote head `b295a2a98362168df11b7e36600733893f22e154` is the active reconciliation head, `f6021ecdb45f4ecf5aece2c52cc0e6f462361d49` already has hosted `ci`, and `1e340b978bfa35a2ed339adcdb0d2add56cc08c3` remains the latest head with both proofs
- Public repository: `https://github.com/KonkovaElena/mri-second-opinion`
- Auditor handoff: `docs/verification/ai-auditor-handoff-2026-03-25.md` (historical snapshot dated 2026-03-25; current verdict advanced later)
- Repository-status retrospective: `docs/verification/publication-retrospective-audit-2026-03-27.md`
- Gap audit: `docs/verification/standalone-gap-audit-2026-03-27.md`
- Archive/viewer seam audit: `docs/verification/archive-viewer-seam-audit-2026-03-27.md`
- Presentation surface audit: `docs/verification/presentation-surface-audit-2026-03-27.md`
- Demo-flow audit: `docs/verification/demo-flow-audit-2026-03-27.md`
- Workbench frontend audit: `docs/verification/workbench-frontend-audit-2026-03-27.md`
- Durable delivery queue audit: `docs/verification/durable-delivery-queue-audit-2026-03-27.md`
- Inference queue lease audit: `docs/verification/inference-queue-lease-audit-2026-03-27.md`
- PostgreSQL bootstrap audit: `docs/verification/postgres-bootstrap-audit-2026-03-27.md`
- Phase-1 governance pack: `docs/security/sbom-policy.md`, `docs/security/threat-model.md`, `docs/academic/bias-analysis-framework.md`, `docs/regulatory/pms-plan.md`
- Formal system analysis: `docs/academic/formal-system-analysis.md`
- Standalone closure audit: `docs/verification/standalone-closure-audit-2026-03-27.md`
- Repository audit: `docs/verification/repository-audit-2026-03-25.md`
- Hosted evidence scaffold: `docs/verification/hosted-evidence-capture-template.md`

## Hosted Workflow Snapshot

Recorded hosted evidence for the latest hosted-validated head:

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
6. `ci` succeeded on `6c2cfee` after the artifact-truth promotion and runtime-hardening reconciliation:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23682412690`
7. `docs-governance` succeeded on `6c2cfee`:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23682412696`
8. `ci` succeeded on `1e340b978bfa35a2ed339adcdb0d2add56cc08c3` after persisted execution-contract truth on case detail and report surfaces:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23684738474`
9. `docs-governance` succeeded on `1e340b978bfa35a2ed339adcdb0d2add56cc08c3`:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23684738468`
10. `ci` succeeded on `f6021ecdb45f4ecf5aece2c52cc0e6f462361d49` after local artifact persistence and public artifact retrieval landed:
  `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23693425627`

The current local and remote `main` refs now both resolve to `b295a2a98362168df11b7e36600733893f22e154`, the latest head with both hosted `ci` and `docs-governance` proof is still `1e340b978bfa35a2ed339adcdb0d2add56cc08c3`, and the active reconciliation head `b295a2a98362168df11b7e36600733893f22e154` has not yet been captured by both hosted workflows in this ledger. The previous runtime-bearing head `f6021ecdb45f4ecf5aece2c52cc0e6f462361d49` already has hosted `ci`. That keeps Wave 1.5 evidence closure open until `b295a2a98362168df11b7e36600733893f22e154` or a newer reconciliation head carries both hosted workflows even though the conservative publication verdict is unchanged.

Local reconciliation also exists beyond the latest hosted-validated head:

1. `7bf7ae3` closed the stash-pop merge and revalidated the full standalone build plus test baseline locally before push
2. `d352d9c` corrected the final docs-governance drift in `README.md` and `package.json` and re-ran the equivalent local workflow assertions before push
3. `33ac458` clarified the dated auditor handoff as a historical snapshot and aligned the active evidence routing with the current publication verdict
4. `db5e7bb` aligned the standalone evidence head after publish and external-repository reconciliation
5. `6c2cfee` hardened the runtime further and promoted typed artifact truth to first-class durable case state before the new hosted workflow closure
6. `1e340b978bfa35a2ed339adcdb0d2add56cc08c3` aligned persisted execution-contract truth on case detail and report surfaces and became the latest head with both hosted `ci` and `docs-governance` proof
7. `f6021ecdb45f4ecf5aece2c52cc0e6f462361d49` extends Wave 2A truth with local file-backed artifact persistence and public artifact retrieval
8. `b295a2a98362168df11b7e36600733893f22e154` is the current local and remote `main` head and reconciles launch evidence and wave status ahead of the next same-head hosted refresh

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
  - `ci` green on `6c2cfee`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23682412690`
  - `docs-governance` green on `6c2cfee`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23682412696`
  - `ci` green on `1e340b978bfa35a2ed339adcdb0d2add56cc08c3`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23684738474`
  - `docs-governance` green on `1e340b978bfa35a2ed339adcdb0d2add56cc08c3`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23684738468`
  - previous runtime head `f6021ecdb45f4ecf5aece2c52cc0e6f462361d49` already has hosted `ci`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23693425627`
  - current `main` head `b295a2a98362168df11b7e36600733893f22e154` still needs a same-head `docs-governance` run plus workflow-dispatched `ci` before Wave 1.5 closes
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

- Status: complete for the local standalone workflow surface
- Note: route inventory, stable API boundary docs, and deterministic workflow coverage now exist locally; hosted or release-linked capture is still tracked separately under release evidence
- Artifact links:
  - `docs/scope-inventory.md`
  - `docs/api-scope.md`
  - `docs/public-vocabulary.md`
  - `docs/status-model.md`
  - `tests/workflow-api.test.ts`
  - `docs/verification/runtime-baseline-verification.md`
  - `docs/verification/demo-flow-audit-2026-03-27.md`
  - `docs/verification/presentation-surface-audit-2026-03-27.md`
  - `docs/verification/standalone-closure-audit-2026-03-27.md`

## 3. Durable State Verification

Required artifacts:

- migration run log
- restart persistence test output
- queue rebuild proof
- delivery retry history proof

Record:

- Status: complete for the current standalone launch-gate interpretation
- Note: local SQLite-backed durability now includes explicit restart-safe delivery jobs, queue rebuild proof, retry persistence, worker-claim coverage, and internal inference-job stale-claim recovery; clean-database PostgreSQL bootstrap is also proven against a real PostgreSQL instance. Broader release-linked persistence evidence and production-grade PostgreSQL runtime maturity remain future work, but they do not block the current public GitHub publication gate.
- Artifact links:
  - `tests/memory-case-service.test.ts`
  - `tests/workflow-api.test.ts`
  - `tests/postgres-bootstrap.test.ts`
  - `tests/postgres-case-service.test.ts`
  - `docs/verification/durable-delivery-queue-audit-2026-03-27.md`
  - `docs/verification/inference-queue-lease-audit-2026-03-27.md`
  - `docs/verification/postgres-bootstrap-audit-2026-03-27.md`
  - `docs/verification/runtime-baseline-verification.md`
  - `docs/verification/standalone-closure-audit-2026-03-27.md`

## 4. Frontend Verification

Required artifacts:

- frontend smoke test output
- screenshot bundle
- UI-to-endpoint mapping review

Record:

- Status: complete for the built-in standalone workbench surface
- Note: the current frontend closure is a built-in synthetic-demo workbench over the live API, not an OHIF deployment or production imaging UI
- Artifact links:
  - `public/workbench/index.html`
  - `public/workbench/review-workbench.css`
  - `public/workbench/review-workbench.js`
  - `docs/verification/workbench-frontend-audit-2026-03-27.md`
  - `docs/demo/operator-transcript-2026-03-27.md`
  - `docs/screenshots/workbench-queue.png`
  - `docs/screenshots/workbench-review.png`
  - `docs/screenshots/workbench-report.png`
  - `docs/screenshots/workbench-delivery.png`
  - `docs/architecture/mvp-work-package-map.md`

## 5. Demo Verification

Required artifacts:

- synthetic demo input package provenance note
- demo setup transcript
- completed walk-through transcript
- screenshot set used by README

Record:

- Status: complete for the current synthetic internal-demo path
- Note: the current demo path is screenshot-backed, operator-documented, and routed through the built-in workbench plus existing API and internal callback seams; it does not claim hosted or worker-backed demo closure
- Artifact links:
  - `tests/workflow-api.test.ts`
  - `docs/verification/demo-flow-audit-2026-03-27.md`
  - `docs/verification/workbench-frontend-audit-2026-03-27.md`
  - `docs/verification/standalone-closure-audit-2026-03-27.md`
  - `docs/demo/demo-script.md`
  - `docs/demo/operator-transcript-2026-03-27.md`
  - `docs/screenshots/workbench-queue.png`
  - `docs/screenshots/workbench-review.png`
  - `docs/screenshots/workbench-report.png`
  - `docs/screenshots/workbench-delivery.png`
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
  - `ci` green on `6c2cfee`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23682412690`
  - `docs-governance` green on `6c2cfee`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23682412696`
  - `ci` green on `1e340b978bfa35a2ed339adcdb0d2add56cc08c3`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23684738474`
  - `docs-governance` green on `1e340b978bfa35a2ed339adcdb0d2add56cc08c3`: `https://github.com/KonkovaElena/mri-second-opinion/actions/runs/23684738468`
  - previous runtime-bearing head `f6021ecdb45f4ecf5aece2c52cc0e6f462361d49` keeps the same conservative publication verdict and already has hosted `ci`, while the current `main` head `b295a2a98362168df11b7e36600733893f22e154` still needs same-head hosted capture here before Wave 1.5 closes
  - public repository is live with About metadata applied
  - remaining GitHub-UI follow-up is tracked separately and does not change the current repository-content verdict
- Artifact links:
  - `README.md`
  - `LICENSE`
  - `CODE_OF_CONDUCT.md`

## 7. Formal Workflow Analysis

Required artifacts:

- state-machine definition aligned with the live status vocabulary
- protocol inventory aligned with the live route surface
- explicit safety, liveness, and auditability gap map

Record:

- Status: complete for the current standalone repository explanation layer
- Note: this category clarifies what the repository can formally claim today and which security, liveness, and reproducibility seams remain open; it is supporting evidence, not a release-readiness upgrade by itself
- Artifact links:
  - `docs/academic/formal-system-analysis.md`
  - `docs/status-model.md`
  - `docs/api-scope.md`
  - `docs/verification/durable-delivery-queue-audit-2026-03-27.md`
  - `docs/verification/standalone-closure-audit-2026-03-27.md`
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

- Status: complete
- Note: current authority docs were reconciled again on 2026-03-29 so the active release and evidence layer reflects the current `main` head `b295a2a98362168df11b7e36600733893f22e154`, treats `1e340b978bfa35a2ed339adcdb0d2add56cc08c3` as the latest fully hosted-validated head, preserves `PUBLIC_GITHUB_READY` as the conservative publication verdict, acknowledges the earlier Wave 2A runtime milestone at `f6021ecdb45f4ecf5aece2c52cc0e6f462361d49`, and keeps Wave 1.5 hosted evidence refresh explicitly open until one same-head reconciliation commit carries both hosted workflows
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