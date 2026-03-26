# Status Model

## Canonical Workflow States

1. `INGESTING`
2. `QC_REJECTED`
3. `SUBMITTED`
4. `AWAITING_REVIEW`
5. `REVIEWED`
6. `FINALIZED`
7. `DELIVERY_PENDING`
8. `DELIVERED`
9. `DELIVERY_FAILED`

## State Intent

1. `INGESTING`: DICOM intake and normalization are in progress
2. `QC_REJECTED`: study failed minimum quality or completeness gate
3. `SUBMITTED`: case exists and is queued for inference
4. `AWAITING_REVIEW`: AI draft exists and requires clinician action
5. `REVIEWED`: clinician review is complete and finalization can proceed
6. `FINALIZED`: final clinical summary is locked
7. `DELIVERY_PENDING`: finalized report awaits outbound delivery
8. `DELIVERED`: report delivery succeeded
9. `DELIVERY_FAILED`: delivery failed and requires retry or operator intervention

## Allowed Transitions

1. `INGESTING` -> `SUBMITTED`
2. `INGESTING` -> `QC_REJECTED`
3. `SUBMITTED` -> `AWAITING_REVIEW`
4. `AWAITING_REVIEW` -> `REVIEWED`
5. `REVIEWED` -> `FINALIZED`
6. `FINALIZED` -> `DELIVERY_PENDING`
7. `DELIVERY_PENDING` -> `DELIVERED`
8. `DELIVERY_PENDING` -> `DELIVERY_FAILED`
9. `DELIVERY_FAILED` -> `DELIVERY_PENDING`

## State And Queue Invariant Matrix (PR-06)

| Case status | Report reviewStatus | Active queue stages | Reviewer identity | FinalizedBy |
|-------------|---------------------|---------------------|-------------------|-------------|
| `INGESTING` | `null` | none | forbidden | forbidden |
| `QC_REJECTED` | `null` | none | forbidden | forbidden |
| `SUBMITTED` | `null` | `inference` | forbidden | forbidden |
| `AWAITING_REVIEW` | `draft` | none | forbidden | forbidden |
| `REVIEWED` | `reviewed` | none | required | forbidden |
| `FINALIZED` | `finalized` | none | required | required |
| `DELIVERY_PENDING` | `finalized` | `delivery` | required | required |
| `DELIVERED` | `finalized` | none | required | required |
| `DELIVERY_FAILED` | `finalized` | none | required | required |

## Forbidden Pairings

1. `SUBMITTED` without exactly one active `inference` queue entry
2. `AWAITING_REVIEW` or `REVIEWED` with any active queue entry
3. `DELIVERY_PENDING` without a finalized report and exactly one active `delivery` queue entry
4. `DELIVERED` or `DELIVERY_FAILED` with any active queue entry still open
5. Any reviewed-or-later state without reviewer identity
6. Any finalized-or-later state without `finalizedBy`

## Notes

Human review remains mandatory.

No state transition may imply autonomous diagnosis.

Inference failures remain internal execution outcomes in wave 1. They should surface in timeline, logs, and operator feedback without expanding the public workflow vocabulary unless the product deliberately adds a new persisted state.

## Transition Journal (PR-04)

Every mutation that changes case state or represents a significant lifecycle event appends an entry to the case's `transitionJournal` array. The journal is append-only and strictly ordered.

### TransitionJournalEntry

| Field | Type | Description |
|-------|------|-------------|
| `journalId` | `string` (UUID) | Unique identifier for this entry |
| `caseId` | `string` (UUID) | Owning case |
| `sequence` | `number` | Monotonically increasing (1-based) |
| `transitionType` | `string` | Semantic label (see table below) |
| `fromStatus` | `string \| null` | Status before the event (`null` for creation) |
| `toStatus` | `string` | Status after the event |
| `actor` | `"system" \| "clinician" \| "integration"` | Who caused the event |
| `source` | `string` | Code path or API route |
| `detail` | `string` | Human-readable explanation |
| `timestamp` | `string` (ISO 8601) | When the event occurred |
| `stateSnapshot` | `JournalStateSnapshot` | Point-in-time snapshot (see below) |

### JournalStateSnapshot

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Case status at time of capture |
| `queueSummary` | `Array<{stage, status}>` | Workflow queue state |
| `hasReport` | `boolean` | Whether findings payload exists |
| `reportReviewStatus` | `string \| null` | Current review state |
| `reviewerId` | `string \| null` | Reviewing clinician if any |
| `finalizedBy` | `string \| null` | Clinician identity that finalized the case if any |

### Transition Types

| Type | Trigger | Actor |
|------|---------|-------|
| `case-created` | `buildCaseRecord` (public create) | system |
| `ingest-received` | `buildCaseRecord` (internal ingest) | integration |
| `ingest-accepted` | `ingestCase` → SUBMITTED | integration |
| `ingest-rejected` | `ingestCase` → QC_REJECTED | integration |
| `inference-completed` | `completeInference` → AWAITING_REVIEW | integration |
| `inference-rejected` | `completeInference` (QC reject) | integration |
| `inference-replayed` | Duplicate inference callback | integration |
| `clinician-reviewed` | `reviewCase` → REVIEWED | clinician |
| `case-finalized` | `finalizeCase` → FINALIZED | clinician |
| `delivery-queued` | `finalizeCase` → DELIVERY_PENDING | system |
| `delivery-succeeded` | Delivery callback or finalize | integration |
| `delivery-failed` | Delivery callback or finalize | integration |
| `delivery-retry-requested` | `retryDelivery` → DELIVERY_PENDING | system |
| `delivery-replayed` | Duplicate delivery callback | integration |
| `{stage}-dispatch-claimed` | `claimNextDispatch` | system |
| `{stage}-dispatch-lease-expired` | `releaseExpiredDispatchClaims` | system |

### PostgreSQL Schema

Migration `003_transition_journal.sql` creates a `transition_journal` table with:
- Primary key on `journal_id`
- Unique constraint on `(case_id, sequence)`
- Foreign key to `cases(case_id)` with CASCADE delete
- Indexes on `case_id`, `timestamp`, and `transition_type`
