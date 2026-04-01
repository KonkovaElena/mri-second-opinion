# MRI Second Opinion Operator Transcript 2026-03-27

## Purpose

This transcript records the first screenshot-backed operator walk-through for the built-in MRI Review Workbench.

The path is synthetic only.

It is intended to prove the current internal-demo surface, not a production deployment.

## Startup Sequence

Commands used:

```bash
npm run build
npm start
```

Observed startup signal:

1. service listening on `http://localhost:4010`
2. built-in workbench available at `http://localhost:4010/workbench`

## Walk-Through

### 1. Queue state

Open:

`http://localhost:4010/workbench?demoStage=submitted`

Expected result:

1. a synthetic MRI case is created through the live API
2. the case appears in the queue dashboard with `SUBMITTED` state

Screenshot:

1. `docs/screenshots/workbench-queue.png`

### 2. Review state

Open:

`http://localhost:4010/workbench?demoStage=awaiting-review`

Expected result:

1. synthetic draft generation has run through the existing internal inference callback seam
2. queue, case detail, review workspace, report preview, and operations summary all render in one view
3. the selected case is in `AWAITING_REVIEW`

Screenshot:

1. `docs/screenshots/workbench-review.png`

### 3. Finalized report plus failed delivery

Open:

`http://localhost:4010/workbench?demoStage=delivery-failed`

Expected result:

1. clinician review and finalization have been applied
2. report preview shows finalized output
3. delivery state is failed and the retry control is visible

Screenshot:

1. `docs/screenshots/workbench-report.png`

### 4. Delivery retry state

Open:

`http://localhost:4010/workbench?demoStage=delivery-pending`

Expected result:

1. retry has been requested through the live retry endpoint
2. queue and operations summary show delivery back in `DELIVERY_PENDING`

Screenshot:

1. `docs/screenshots/workbench-delivery.png`

## Manual-Step Note

No extra manual API client was needed during the walkthrough.

The workbench itself drove the current runtime surface.

The only synthetic shortcut is the demo-stage seeding logic, which still calls the real standalone endpoints rather than inventing hidden mock UI state.

## Boundary Note

This transcript does not prove:

1. hosted deployment
2. PostgreSQL-backed durability
3. queue-backed worker execution
4. OHIF deployment
5. clinical readiness