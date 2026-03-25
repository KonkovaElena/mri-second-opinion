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

## Notes

Human review remains mandatory.

No state transition may imply autonomous diagnosis.

Inference failures remain internal execution outcomes in wave 1. They should surface in timeline, logs, and operator feedback without expanding the public workflow vocabulary unless the product deliberately adds a new persisted state.
