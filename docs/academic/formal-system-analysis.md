---
title: "Formal System Analysis"
status: "active"
version: "1.0.1"
last_updated: "2026-04-03"
tags: [academic, formal-analysis, workflow, mri]
---

# MRI Second Opinion Formal System Analysis

## Purpose

This document gives a repository-backed formal reading of the current MRI Second Opinion workflow system.

It treats the repository as a workflow system with explicit states, guarded transitions, companion delivery-job state, and checkable safety, liveness, and auditability properties.

It does not promote target architecture or external research posture into implemented runtime truth.

## Evidence Boundary

This analysis uses the current standalone repository state as of 2026-04-03.

Implemented claims in this document are grounded in:

1. `src/cases.ts`
2. `src/case-planning.ts`
3. `src/app.ts`
4. `src/reviewer-auth.ts`
5. `tests/workflow-api.test.ts`
6. `tests/runtime-hardening.test.ts`
7. `tests/memory-case-service.test.ts`
8. `docs/status-model.md`
9. `docs/api-scope.md`
10. `docs/verification/durable-delivery-queue-audit-2026-03-27.md`
11. `docs/verification/runtime-and-production-boundary-revalidation-2026-04-03.md`

The following remain target seams or open gaps, not implemented standalone truth:

1. relationship-based or case-scoped reviewer authorization
2. hosted or distributed inference-worker lease recovery and scheduler-backed expiry automation
3. production PostgreSQL durability
4. distributed or externally brokered workers
5. production-grade Python compute-plane closure
6. OHIF-backed review workspace
7. artifact checksum verification and full compute reproducibility envelope

## 1. Case Workflow As EFSM

We model the current case lifecycle as an extended finite state machine:

$$
M = (S, \Sigma_{ext}, \Sigma_{int}, V, \delta, \lambda, s_0, F, I)
$$

| Component | Current standalone meaning |
|---|---|
| $S$ | persisted case statuses |
| $\Sigma_{ext}$ | HTTP events from public and internal routes |
| $\Sigma_{int}$ | service-level replay checks, queue availability checks, and persistence-side effects |
| $V$ | mutable workflow data carried by `CaseRecord` |
| $\delta$ | guarded transition function |
| $\lambda$ | side-effects: report generation, queue record mutation, history and operation log append |
| $s_0$ | `INGESTING` for internal-ingest path, with a public shortcut that starts directly in `SUBMITTED` |
| $F$ | `QC_REJECTED` and `DELIVERED` in the current standalone runtime |
| $I$ | runtime invariants enforced by status guards, report guards, queue guards, and transition tables |

### 1.1. State Set

The canonical workflow states are:

$$
S = \{\texttt{INGESTING},\ \texttt{QC\_REJECTED},\ \texttt{SUBMITTED},\ \texttt{AWAITING\_REVIEW},\ \texttt{REVIEWED},\ \texttt{FINALIZED},\ \texttt{DELIVERY\_PENDING},\ \texttt{DELIVERED},\ \texttt{DELIVERY\_FAILED}\}
$$

Two nuances matter:

1. the public `POST /api/cases` path bypasses a long-lived `INGESTING` state and starts directly in `SUBMITTED`
2. `DELIVERY_FAILED` is not terminal in the standalone runtime because manual retry is implemented

### 1.2. External Input Alphabet

The repo-backed external triggers are:

1. `POST /api/cases`
2. `POST /api/internal/ingest`
3. `POST /api/internal/inference-callback`
4. `POST /api/cases/:caseId/review`
5. `POST /api/cases/:caseId/finalize`
6. `POST /api/delivery/:caseId/retry`
7. `POST /api/internal/delivery-callback`
8. `POST /api/internal/delivery-jobs/claim-next`

### 1.3. State Variables

The most relevant state variables are:

1. `status`
2. `sequenceInventory`
3. `qcSummary`
4. `report`
5. `planEnvelope`
6. `history`
7. `operationLog`
8. `review`
9. `lastInferenceFingerprint`
10. persisted `deliveryJobs[]`

### 1.4. Implemented Invariants

The current standalone runtime enforces these invariants directly:

1. every case-state transition must belong to `ALLOWED_TRANSITIONS`
2. public case creation requires the required T1w sequence for the active MVP slice
3. review and finalize require an existing draft report
4. finalize can only start from `REVIEWED`
5. retry can only start from `DELIVERY_FAILED`
6. delivery callback can only mutate a case in `DELIVERY_PENDING` and only when an active persisted delivery job exists
7. duplicate inference callbacks are idempotent only when the stored fingerprint matches exactly

The following are explicitly not enforced today:

1. relationship-based or case-scoped reviewer authorization beyond authenticated reviewer JWT identity plus role allowlisting
2. signed internal callbacks
3. lease-based recovery for inference execution

## 2. Implemented Transition Function

The current guarded transitions are:

| From | Event | Guard | Side-effects | To |
|---|---|---|---|---|
| `START` | `POST /api/cases` | required T1w sequence present | build plan envelope, append creation operation | `SUBMITTED` |
| `START` | `POST /api/internal/ingest` | request payload valid | create initial case in `INGESTING`, then evaluate sequence gate | `INGESTING` then `SUBMITTED` or `QC_REJECTED` |
| `SUBMITTED` | `POST /api/internal/inference-callback` with `qcDisposition=reject` | payload valid and fingerprint not conflicting | write QC summary, append blocked operation | `QC_REJECTED` |
| `SUBMITTED` | `POST /api/internal/inference-callback` with `qcDisposition in {pass,warn}` | payload valid and fingerprint not conflicting | create draft report, update evidence cards, append completion operation | `AWAITING_REVIEW` |
| `AWAITING_REVIEW` | `POST /api/cases/:caseId/review` | report exists, reviewer JWT is valid, and reviewer role is allowlisted | write JWT-derived reviewer identity plus comments, append clinician operation | `REVIEWED` |
| `REVIEWED` | `POST /api/cases/:caseId/finalize` | report exists, reviewer JWT is valid, and reviewer role is allowlisted | lock report, append finalization operation | `FINALIZED` |
| `FINALIZED` | same finalize request | always in current standalone path | enqueue persisted delivery job and append queue operation | `DELIVERY_PENDING` |
| `DELIVERY_PENDING` | `POST /api/internal/delivery-callback` with `deliveryStatus=delivered` | active persisted delivery job exists | mark job delivered, append delivery success operation | `DELIVERED` |
| `DELIVERY_PENDING` | `POST /api/internal/delivery-callback` with `deliveryStatus=failed` | active persisted delivery job exists | mark job failed, append delivery failure operation | `DELIVERY_FAILED` |
| `DELIVERY_FAILED` | `POST /api/delivery/:caseId/retry` | retry explicitly requested | create new queued delivery job and append retry operation | `DELIVERY_PENDING` |

### 2.1. Public Finalize No Longer Accepts Delivery Overrides

The current standalone public finalize flow no longer exposes a `deliveryOutcome` shortcut.

The public finalize contract now locks the report and then walks the legal delivery path through persisted delivery-job state:

$$
\texttt{REVIEWED} \rightarrow \texttt{FINALIZED} \rightarrow \texttt{DELIVERY\_PENDING} \rightarrow \{\texttt{DELIVERED},\ \texttt{DELIVERY\_FAILED}\}
$$

Delivery success or failure is now expressed through internal delivery callbacks or explicit retry from `DELIVERY_FAILED`, not through a public finalize request field.

## 3. Companion Delivery-Job Automaton

The repository now contains a second persisted state machine for outbound delivery jobs:

$$
J = \{\texttt{queued},\ \texttt{claimed},\ \texttt{delivered},\ \texttt{failed}\}
$$

The implemented job transitions are:

| Job state | Event | Guard | Next |
|---|---|---|---|
| `queued` | `claim-next` | `availableAt <= now` | `claimed` |
| `queued` or `claimed` | delivery callback success | case still in `DELIVERY_PENDING` and active job exists | `delivered` |
| `queued` or `claimed` | delivery callback failure | case still in `DELIVERY_PENDING` and active job exists | `failed` |
| `failed` | public delivery retry | explicit operator action | new `queued` job record |

Companion invariants:

1. a case cannot complete delivery without an active persisted job
2. future-scheduled queued jobs are not claimable early
3. stale queue-claim contention reloads persisted state instead of surfacing as an uncontrolled conflict on the tested local path

## 4. Missing Transitions And Open Seams

Formal analysis exposes the following missing or only-partially-realized transitions:

| Gap | Current state |
|---|---|
| `QC_REJECTED -> reingest` | absent in standalone runtime |
| inference-worker `SUBMITTED` lease, heartbeat, and expiry reset | absent |
| automated scheduler for lease expiry or background requeue | absent |
| archival or long-term retention state | absent |
| hosted or distributed worker recovery semantics | absent |
| production PostgreSQL-backed persistence semantics | absent |

These are primarily liveness and operational-closure gaps, not case-vocabulary gaps.

## 5. Message Protocols

### 5.1. Public Case Creation

```text
Public client -> POST /api/cases
API -> validate patientAlias, studyUid, sequenceInventory
API -> enforce required T1w presence
API -> build CaseRecord in SUBMITTED
API -> persist case, append operationLog, return case envelope
```

Key property:

$$
\texttt{POST /api/cases} \Rightarrow \texttt{status = SUBMITTED}
$$

only when the required sequence gate passes.

### 5.2. Internal Ingest And Inference Callback

```text
Integration source -> POST /api/internal/ingest
API -> create CaseRecord in INGESTING
API -> evaluate required sequence gate
API -> persist as SUBMITTED or QC_REJECTED

Integration source -> POST /api/internal/inference-callback
API -> reject conflicting duplicate callback fingerprints
API -> write QC summary
API -> create draft report on pass/warn
API -> persist as AWAITING_REVIEW or QC_REJECTED
```

Key property:

$$
\texttt{SUBMITTED} \xrightarrow{\texttt{inference-callback}} \{\texttt{AWAITING\_REVIEW},\ \texttt{QC\_REJECTED}\}
$$

The current standalone repo already implements bounded dispatch claim and heartbeat rails, but it does not yet prove a hosted or distributed lease-recovery control plane.

### 5.3. Review And Finalize

```text
Clinician-facing client -> POST /api/cases/:id/review
API -> require status AWAITING_REVIEW
API -> require report draft
API -> require reviewer JWT identity and allowlisted reviewer role
API -> write JWT-derived reviewer metadata and comments
API -> persist REVIEWED

Clinician-facing client -> POST /api/cases/:id/finalize
API -> require status REVIEWED
API -> require report draft
API -> require reviewer JWT identity and allowlisted reviewer role
API -> lock report and enqueue delivery job
API -> persist FINALIZED then DELIVERY_PENDING
```

Key safety property:

$$
\texttt{finalize(case)} \Rightarrow \texttt{status was REVIEWED before finalization}
$$

Important boundary note:

The current standalone repo now binds reviewer identity to reviewer JWT subject data and enforces a reviewer-role allowlist, but it does not yet prove relationship-based or case-scoped reviewer authorization.

### 5.4. Delivery Claim And Callback

```text
Delivery worker -> POST /api/internal/delivery-jobs/claim-next
API -> choose earliest queued job with availableAt <= now
API -> persist claimed workerId and attemptCount

Delivery worker -> POST /api/internal/delivery-callback
API -> require case status DELIVERY_PENDING
API -> require active queued or claimed delivery job
API -> mark job delivered or failed
API -> persist case as DELIVERED or DELIVERY_FAILED
```

Key safety property:

$$
\texttt{delivery-callback} \Rightarrow \exists j \in \{\texttt{queued},\texttt{claimed}\} : j.caseId = caseId
$$

## 6. Checkable Properties

### 6.1. Safety Properties

| ID | Property | Current status |
|---|---|---|
| `S-01` | illegal case-state transitions are rejected by `ALLOWED_TRANSITIONS` plus `assertStatus` | implemented |
| `S-02` | public case creation rejects missing required T1w for the active MVP slice | implemented |
| `S-03` | review requires an existing report draft | implemented |
| `S-04` | finalize requires `REVIEWED` status and a report draft | implemented |
| `S-05` | duplicate inference callbacks are only idempotent when the stored fingerprint matches | implemented |
| `S-06` | delivery callback cannot mutate the case without an active persisted delivery job | implemented |
| `S-07` | early delivery-job claim before `availableAt` is blocked | implemented |
| `S-08` | review/finalize reject missing or non-allowlisted reviewer JWT principals | implemented |
| `S-09` | nonce replay on internal routes is rejected | implemented: `MemoryReplayStore` wired into dispatch HMAC middleware with configurable TTL and max-entries |

### 6.2. Liveness Properties

| ID | Property | Current status |
|---|---|---|
| `L-01` | restart-safe local delivery jobs remain visible and claimable after reload | implemented for local SQLite and snapshot baseline |
| `L-02` | a case in `DELIVERY_FAILED` can return to `DELIVERY_PENDING` via explicit retry | implemented |
| `L-03` | queued delivery work becomes claimable once `availableAt` is reached | partially implemented; the negative guard is proven, but no hosted or scheduler-backed proof exists |
| `L-04` | expired inference work is automatically requeued after worker failure | absent |
| `L-05` | distributed multi-worker progress is guaranteed beyond local contention tests | absent |

### 6.3. Auditability Properties

| ID | Property | Current status |
|---|---|---|
| `A-01` | every case-state transition appends `history[]` | implemented |
| `A-02` | each business action appends an `operationLog` entry | implemented |
| `A-03` | report provenance includes `workflowVersion`, `plannerVersion`, and `generatedAt` | implemented |
| `A-04` | derived artifacts carry archive locator and viewer-readiness metadata | implemented |
| `A-05` | artifact checksums are stored and verified | absent |
| `A-06` | full compute reproducibility fields are persisted | absent |

## 7. Threat Model Snapshot

| Threat | Current posture |
|---|---|
| stale writer on queue claim | mitigated on the tested local path by persistence reload and retry logic |
| duplicate inference callback replay | mitigated by fingerprint-based replay detection |
| premature delivery callback after queue loss | mitigated by active delivery-job guard |
| machine impersonation of clinician actions | partially mitigated by reviewer JWT identity plus role allowlisting; object-scoped and relationship-based authorization remain open |
| internal route replay or signature spoofing | mitigated: HMAC request signing with nonce replay enforcement is active on dispatch routes |
| artifact tampering after generation | open gap because checksum verification is not implemented |
| inference-worker crash and silent work loss | open liveness gap because lease and scheduler recovery are not implemented |

## 8. Reproducibility Envelope

The current standalone repo preserves workflow provenance more strongly than compute reproducibility.

The effective current envelope is:

$$
R_{current}(case) = \{studyUid, sequenceInventory, qcDisposition, plannerVersion, workflowVersion, generatedAt, artifactRefs, archiveLocator\}
$$

The missing fields for a stronger reproducibility claim are:

$$
R_{missing}(case) = \{inputHash, artifactChecksum, containerDigest, dependencyLock, randomSeed, hardwareProfile\}
$$

This means the repository can currently support workflow reconstruction and local audit reasoning better than end-to-end compute rerun equivalence.

## 9. Architectural Interpretation

The strongest repo-backed contribution is a transparent workflow orchestrator with:

1. explicit case-state vocabulary
2. guarded review and finalization gates
3. append-only transition and operation traces
4. planner and report provenance fields
5. a persisted local delivery-job companion machine
6. conservative readiness language that keeps `PUBLIC_GITHUB_READY` bounded below launch-ready, clinical-ready, and production-ready claims

The strongest open seams are:

1. object-scoped and relationship-based authorization
2. inference liveness and scheduler recovery
3. production durability beyond local SQLite-backed truth
4. artifact integrity and compute reproducibility closure
5. clinically realistic compute and viewer integration

## 10. Current Formal Verdict

The standalone repository now supports a defensible formal reading as a transparent clinical workflow system.

That reading is strong enough to justify precise discussion of:

1. the case-state EFSM
2. the companion delivery-job automaton
3. current safety properties
4. current auditability properties
5. explicit liveness and security gaps

It is not strong enough to justify claims of:

1. case-scoped clinician authorization
2. production inference-worker recovery
3. production PostgreSQL-backed durability
4. full reproducibility of compute outputs
5. clinical readiness or deployment readiness

That is why the current repository-content verdict should be read as `PUBLIC_GITHUB_READY`, not as launch-ready, clinical-ready, or production-ready.