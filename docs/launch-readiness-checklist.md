# MRI Standalone v1 Launch Readiness Checklist

Status values:

- `[ ]` not started
- `[-]` in progress
- `[x]` complete

This checklist is the operator view of the MRI Standalone launch gate.

The repository must not be described as public-launch-ready until every required item below is complete and backed by evidence.

Use `releases/public-github-and-mvp-path.md` to distinguish safe public publication from actual MVP closure.

## Gate 1. Repository Independence

- [x] standalone install works from clean checkout
- [x] standalone build works from repo root
- [x] no runtime imports depend on parent repository `src/**`
- [x] `.env.example` is sufficient for first local startup
- [x] CI proves install and build independently

Primary evidence:

1. clean-checkout CI run
2. dependency scan showing no parent runtime imports
3. local startup transcript

## Gate 2. Backend Workflow Closure

- [x] `POST /api/cases` exists and creates a case
- [x] `GET /api/cases` exists and drives queue view
- [x] `GET /api/cases/:caseId` exists and returns case detail
- [x] `POST /api/cases/:caseId/review` exists and supports approve or amend flow
- [x] `POST /api/cases/:caseId/finalize` exists and finalizes reviewed case
- [x] `GET /api/cases/:caseId/report` exists and retrieves rendered report output
- [x] `POST /api/delivery/:caseId/retry` exists and retries delivery without mutating clinical approval state
- [x] `GET /api/operations/summary` exists and supports operations view with queue and worker diagnostics
- [x] signed internal mutation routes reject unsigned or malformed HMAC requests
- [x] replayed nonces are rejected on signed internal ingest and dispatch-claim routes
- [x] the bounded worker transcript proves claim -> heartbeat -> callback flow against real routes
- [x] runtime payloads use the locked status vocabulary from `docs/status-model.md`

Primary evidence:

1. route map
2. API contract tests
3. end-to-end API transcript
4. signed worker transcript fixture and HMAC route tests

## Gate 3. Durable Workflow Truth

- [x] case state survives restart
- [x] delivery state survives restart
- [x] retry history survives restart
- [x] queue view can be rebuilt from durable records
- [x] operations totals can be rebuilt from durable records
- [x] runtime can switch between snapshot and PostgreSQL persistence modes
- [x] migrations run from clean database
- [x] Postgres-backed restart survival verified through integration tests
- [x] CI postgres-smoke job configured for migration verification on GitHub-hosted runners
- [x] finalized release version remains pinned across later machine reruns
- [x] typed artifact-reference projections survive restart and light-read paths

Primary evidence:

1. restart persistence tests
2. persistence-mode and PostgreSQL repository tests
3. `npm run db:migrate:smoke` local PostgreSQL migration log
4. read-model verification
5. `tests/postgres-integration.test.ts` (3 tests: restart survival, full lifecycle, delete propagation)
6. `.github/workflows/ci.yml` postgres-smoke job
7. `sql/migrations/004_projection_split.sql`
8. `docs/architecture/reporting-and-export-contract.md`

## Gate 4. Frontend Closure

- [x] queue dashboard exists
- [x] case detail and review workspace exists
- [x] final report preview exists
- [x] operations summary screen exists with explicit queue and worker health semantics
- [x] delivery failure and retry view exists
- [x] no dead navigation or placeholder panels remain
- [x] every visible action maps to a real backend endpoint

Primary evidence:

1. frontend smoke test
2. screenshot set
3. manual demo walk-through

## Gate 5. Demo Credibility

- [x] demo uses synthetic MRI-safe input only
- [ ] demo setup is reproducible in under ten minutes
- [x] `docs/demo/demo-script.md` matches the real UI and runtime
- [ ] screenshots reflect current UI, not mockups
- [x] demo path covers intake through delivery state

Primary evidence:

1. demo transcript
2. seed/setup instructions
3. screenshot bundle

## Gate 6. Public Repository Hygiene

- [x] `README.md` exists and is externally readable
- [x] `LICENSE` exists
- [x] `SECURITY.md` exists
- [x] `CONTRIBUTING.md` exists
- [x] CI workflow exists and passes
- [x] workflow permissions are minimized
- [x] no stale internal-only docs are presented as public-facing product docs

Primary evidence:

1. repo root file inventory
2. passing CI
3. workflow review notes

## Gate 7. Documentation Honesty

- [x] README promises only verified behavior
- [x] clinician-in-the-loop requirement is explicit
- [x] non-goals are explicit
- [x] API scope matches runtime reality
- [x] status model matches runtime reality
- [x] parent-platform jargon is removed from public product docs

Primary evidence:

1. README review
2. API-vs-runtime comparison
3. status-vs-runtime comparison

## Allowed Verdicts

Use only one of these repository-level verdicts:

1. `NOT_READY`
2. `INTERNAL_DEMO_READY`
3. `PUBLIC_GITHUB_READY`

The verdict must be supported by evidence, not aspiration.

## Practical Reading Rule

Interpret the checklist in two passes.

1. safe public GitHub publication work focuses mainly on Repository Independence, Public Repository Hygiene, and Documentation Honesty
2. repository-level verdict `PUBLIC_GITHUB_READY` still requires the full gate set defined in `docs/releases/v1-go-no-go.md`
3. `INTERNAL_DEMO_READY` additionally requires workflow, durability, frontend, and demo gates to close for one bounded MVP slice