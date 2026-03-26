import test from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { PostgresCaseRepository } from "../src/postgres-case-repository";
import { MemoryCaseService, type CaseRecord } from "../src/cases";
import { buildArtifactReferenceProjection, buildCaseSummaryProjection, buildWorkflowJobProjection } from "../src/case-projections";

// ---------------------------------------------------------------------------
// Shared pool stub that behaves like a real Postgres: keeps rows in memory
// across multiple repository and service instances (simulates shared DB).
// ---------------------------------------------------------------------------

function buildPoolBackend() {
  const rows = new Map<string, { case_id: string; study_uid: string; status: string; created_at: string; updated_at: string; payload: CaseRecord }>();
  const caseSummaries = new Map<string, { case_id: string; study_uid: string; status: string; updated_at: string; payload: Record<string, unknown> }>();
  const workflowJobs = new Map<string, { case_id: string; updated_at: string; payload: Record<string, unknown> }>();
  const artifactReferences = new Map<string, { case_id: string; updated_at: string; payload: Record<string, unknown> }>();

  async function query(sql: string, params?: unknown[]) {
      const text = sql.replace(/\s+/g, " ").trim();

      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
        return { rows: [] };
      }

      // SELECT list
      if (/^SELECT payload FROM case_records ORDER BY/i.test(text)) {
        return { rows: Array.from(rows.values()).map((r) => ({ payload: r.payload })) };
      }

      if (/^SELECT payload FROM case_summary_projection ORDER BY/i.test(text)) {
        return { rows: Array.from(caseSummaries.values()).map((r) => ({ payload: r.payload })) };
      }

      if (/^SELECT payload FROM workflow_job_projection ORDER BY/i.test(text)) {
        return { rows: Array.from(workflowJobs.values()).map((r) => ({ payload: r.payload })) };
      }

      if (/^SELECT payload FROM artifact_reference_projection ORDER BY/i.test(text)) {
        return { rows: Array.from(artifactReferences.values()).map((r) => ({ payload: r.payload })) };
      }

      // DELETE (must come before WHERE case_id check)
      if (/^DELETE FROM case_summary_projection/i.test(text) && params) {
        caseSummaries.delete(String(params[0]));
        return { rows: [] };
      }

      if (/^DELETE FROM workflow_job_projection/i.test(text) && params) {
        workflowJobs.delete(String(params[0]));
        return { rows: [] };
      }

      if (/^DELETE FROM artifact_reference_projection/i.test(text) && params) {
        artifactReferences.delete(String(params[0]));
        return { rows: [] };
      }

      if (/^DELETE FROM case_records/i.test(text) && params) {
        rows.delete(String(params[0]));
        return { rows: [] };
      }

      // SELECT by case_id
      if (/WHERE case_id = \$1/i.test(text) && params) {
        const row = rows.get(String(params[0]));
        return { rows: row ? [{ payload: row.payload }] : [] };
      }

      // SELECT by study_uid
      if (/^SELECT case_id FROM case_summary_projection WHERE study_uid = \$1 LIMIT 1/i.test(text) && params) {
        const match = Array.from(caseSummaries.values()).find((r) => r.study_uid === String(params[0]));
        return { rows: match ? [{ case_id: match.case_id }] : [] };
      }

      // INSERT / UPSERT
      if (/^INSERT INTO case_records/i.test(text) && params) {
        const caseId = String(params[0]);
        const payload = JSON.parse(String(params[5])) as CaseRecord;
        const hasConcurrencyGuard = /WHERE case_records\.updated_at = \$7/i.test(text);

        if (hasConcurrencyGuard) {
          const existing = rows.get(caseId);
          if (!existing || existing.updated_at !== String(params[6])) {
            return { rows: [] };
          }
        }

        rows.set(caseId, {
          case_id: caseId,
          study_uid: String(params[1]),
          status: String(params[2]),
          created_at: String(params[3]),
          updated_at: String(params[4]),
          payload,
        });
        return { rows: hasConcurrencyGuard ? [{ case_id: caseId }] : [] };
      }

      if (/^INSERT INTO case_summary_projection/i.test(text) && params) {
        const caseId = String(params[0]);
        caseSummaries.set(caseId, {
          case_id: caseId,
          study_uid: String(params[1]),
          status: String(params[2]),
          updated_at: String(params[3]),
          payload: JSON.parse(String(params[4])) as Record<string, unknown>,
        });
        return { rows: [] };
      }

      if (/^INSERT INTO workflow_job_projection/i.test(text) && params) {
        const caseId = String(params[0]);
        workflowJobs.set(caseId, {
          case_id: caseId,
          updated_at: String(params[1]),
          payload: JSON.parse(String(params[2])) as Record<string, unknown>,
        });
        return { rows: [] };
      }

      if (/^INSERT INTO artifact_reference_projection/i.test(text) && params) {
        const caseId = String(params[0]);
        artifactReferences.set(caseId, {
          case_id: caseId,
          updated_at: String(params[1]),
          payload: JSON.parse(String(params[2])) as Record<string, unknown>,
        });
        return { rows: [] };
      }

      return { rows: [] };
  }

  const pool = { query } as unknown as Pick<pg.Pool, "query">;

  return { pool, rows };
}

test("projection-backed list and operations reads survive restart in postgres mode", async () => {
  const { pool, rows } = buildPoolBackend();

  const repo1 = new PostgresCaseRepository("postgresql://test", pool);
  const service1 = new MemoryCaseService({ repository: repo1 });

  const created = await service1.createCase({
    patientAlias: "projection-patient",
    studyUid: "1.2.3.projection.study",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  const rawStored = rows.get(created.caseId);
  if (!rawStored) {
    throw new Error("missing stored case record for projection test");
  }

  rawStored.payload.planEnvelope = undefined as unknown as CaseRecord["planEnvelope"];
  rawStored.payload.workerArtifacts = undefined as unknown as CaseRecord["workerArtifacts"];
  rawStored.payload.evidenceCards = undefined as unknown as CaseRecord["evidenceCards"];

  const repo2 = new PostgresCaseRepository("postgresql://test", pool);
  const summaries = await repo2.listSummaries();
  const jobs = await repo2.listWorkflowJobs();
  const artifacts = await repo2.listArtifactReferences();
  const operations = await new MemoryCaseService({ repository: repo2 }).getOperationsSummary();

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].caseId, created.caseId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].jobs[0].stage, "inference");
  assert.equal(artifacts.length, 1);
  assert.deepEqual(artifacts[0].reportArtifactRefs, []);
  assert.equal(operations.totalCases, 1);
  assert.equal(operations.queue.totalActive, 1);
  assert.equal(operations.queue.byStage.inference, 1);
});

// ---------------------------------------------------------------------------
// 1. Postgres restart test — state written through PostgresCaseRepository
//    survives a simulated restart (new service instance, same backing store).
// ---------------------------------------------------------------------------

test("case state written through postgres repository survives a simulated restart", async () => {
  const { pool } = buildPoolBackend();

  // Session 1: create and advance a case
  const repo1 = new PostgresCaseRepository("postgresql://test", pool);
  const service1 = new MemoryCaseService({ repository: repo1 });

  const created = await service1.createCase({
    patientAlias: "restart-patient",
    studyUid: "1.2.3.restart.study",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  await service1.completeInference(created.caseId, {
    qcDisposition: "pass",
    findings: ["No acute finding."],
    measurements: [{ label: "brain_volume_ml", value: 1100 }],
    artifacts: ["artifact://report"],
    generatedSummary: "Restart test.",
  });

  // Session 2: new repository + service on the same backing store
  const repo2 = new PostgresCaseRepository("postgresql://test", pool);
  const service2 = new MemoryCaseService({ repository: repo2 });

  const reloaded = await service2.getCase(created.caseId);
  const allCases = await service2.listCases();

  assert.equal(reloaded.status, "AWAITING_REVIEW", "case should have advanced to AWAITING_REVIEW");
  assert.equal(reloaded.report !== null, true, "report should be present");
  assert.equal(allCases.length, 1, "exactly one case should survive");
  assert.equal(allCases[0].caseId, created.caseId);
});

// ---------------------------------------------------------------------------
// 2. Full lifecycle via HTTP when wired in postgres mode.
// ---------------------------------------------------------------------------

test("full case lifecycle survives simulated restart in postgres mode", async () => {
  const { pool } = buildPoolBackend();

  const repo = new PostgresCaseRepository("postgresql://test", pool);
  const service = new MemoryCaseService({ repository: repo });

  const created = await service.createCase({
    patientAlias: "http-test-patient",
    studyUid: "1.2.3.http.test",
    sequenceInventory: ["T1w", "FLAIR"],
    indication: "headache",
  });

  assert.equal(created.status, "SUBMITTED");

  // Layer B: advance the case through the full lifecycle
  const afterInference = await service.completeInference(created.caseId, {
    qcDisposition: "pass",
    findings: ["Mild white matter changes."],
    measurements: [{ label: "brain_volume_ml", value: 1050 }],
    artifacts: ["artifact://qc", "artifact://report"],
    generatedSummary: "HTTP integration test draft.",
  });
  assert.equal(afterInference.status, "AWAITING_REVIEW");

  const afterReview = await service.reviewCase(created.caseId, {
    reviewerId: "clinician-http-test",
    comments: "Approved for delivery.",
  });
  assert.equal(afterReview.status, "REVIEWED");

  const afterFinalize = await service.finalizeCase(created.caseId, {
    clinicianId: "clinician-http-test",
    deliveryOutcome: "pending",
  });
  assert.equal(afterFinalize.status, "DELIVERY_PENDING");

  // Simulate restart — new service, same pool
  const repo2 = new PostgresCaseRepository("postgresql://test", pool);
  const service2 = new MemoryCaseService({ repository: repo2 });

  const reloaded = await service2.getCase(created.caseId);

  assert.equal(reloaded.status, "DELIVERY_PENDING");
  assert.equal(reloaded.review.reviewerId, "clinician-http-test");
  assert.deepEqual(reloaded.report?.versionPins, {
    machineDraftVersion: 1,
    reviewedReleaseVersion: 1,
    finalizedReleaseVersion: 1,
  });
  assert.equal(reloaded.report !== null, true);
  assert.equal(reloaded.workerArtifacts.studyContext.studyUid, "1.2.3.http.test");
  assert.equal(reloaded.workerArtifacts.qcSummary?.disposition, "pass");
  assert.equal(reloaded.workerArtifacts.findingsPayload?.findings[0], "Mild white matter changes.");
  assert.equal(reloaded.workerArtifacts.structuralRun?.packageId, "brain-structural-fastsurfer");
  assert.equal(reloaded.workerArtifacts.structuralRun?.status, "succeeded");
  assert.equal(
    reloaded.workerArtifacts.structuralRun?.artifacts.some((artifact) => artifact.artifactType === "report-preview"),
    true,
  );
  assert.equal(reloaded.operationLog.length > 0, true);
  assert.equal(
    reloaded.workflowQueue.some((entry) => entry.stage === "delivery" && entry.status === "queued"),
    true,
  );
});

// ---------------------------------------------------------------------------
// 3. Delete operation cleans up from the backing store.
// ---------------------------------------------------------------------------

test("deleted case is absent after simulated restart", async () => {
  const { pool, rows } = buildPoolBackend();

  const repo = new PostgresCaseRepository("postgresql://test", pool);
  const service = new MemoryCaseService({ repository: repo });

  const created = await service.createCase({
    patientAlias: "delete-test",
    studyUid: "1.2.3.delete.test",
    sequenceInventory: ["T1w"],
  });

  assert.equal(rows.size, 1);

  // delete is internal; exercised via repository directly
  await repo.delete(created.caseId);

  // new service on same pool
  const repo2 = new PostgresCaseRepository("postgresql://test", pool);
  const service2 = new MemoryCaseService({ repository: repo2 });

  const allCases = await service2.listCases();
  assert.equal(allCases.length, 0, "no cases should remain after delete");
});

test("postgres repository rejects stale whole-record overwrites", async () => {
  const { pool } = buildPoolBackend();

  const repo1 = new PostgresCaseRepository("postgresql://test", pool);
  const repo2 = new PostgresCaseRepository("postgresql://test", pool);

  const service = new MemoryCaseService({ repository: repo1 });
  const created = await service.createCase({
    patientAlias: "stale-claim-guard",
    studyUid: "1.2.3.postgres.stale.guard",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  const snapshotA = (await repo1.get(created.caseId)) as CaseRecord;
  const snapshotB = (await repo2.get(created.caseId)) as CaseRecord;

  snapshotA.workflowQueue[0].status = "claimed";
  snapshotA.workflowQueue[0].leaseId = "lease-a";
  snapshotA.workflowQueue[0].claimedBy = "worker-a";
  snapshotA.workflowQueue[0].claimedAt = "2026-03-26T10:00:00.000Z";
  snapshotA.workflowQueue[0].claimExpiresAt = "2026-03-26T10:05:00.000Z";
  snapshotA.updatedAt = "2026-03-26T10:00:00.000Z";

  snapshotB.workflowQueue[0].status = "claimed";
  snapshotB.workflowQueue[0].leaseId = "lease-b";
  snapshotB.workflowQueue[0].claimedBy = "worker-b";
  snapshotB.workflowQueue[0].claimedAt = "2026-03-26T10:01:00.000Z";
  snapshotB.workflowQueue[0].claimExpiresAt = "2026-03-26T10:06:00.000Z";
  snapshotB.updatedAt = "2026-03-26T10:01:00.000Z";

  await repo1.upsert(snapshotA, { expectedUpdatedAt: created.updatedAt });

  await assert.rejects(
    () => repo2.upsert(snapshotB, { expectedUpdatedAt: created.updatedAt }),
    /Concurrent case store modification detected/,
  );

  const reloaded = await repo1.get(created.caseId);
  assert.equal(reloaded?.workflowQueue[0].claimedBy, "worker-a");
  assert.equal(reloaded?.workflowQueue[0].leaseId, "lease-a");
});

test("claimed lease heartbeat survives postgres-backed restart", async () => {
  const { pool } = buildPoolBackend();
  const repo1 = new PostgresCaseRepository("postgresql://test", pool);
  const service1 = new MemoryCaseService({ repository: repo1 });
  const created = await service1.createCase({
    patientAlias: "postgres-heartbeat",
    studyUid: "1.2.3.postgres.heartbeat",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  const claimed = await service1.claimNextDispatch({
    workerId: "worker-postgres",
    stage: "inference",
    leaseSeconds: 30,
  });

  const heartbeatAt = new Date(Date.parse(claimed?.claimedAt as string) + 20_000).toISOString();

  await service1.renewDispatchLease(created.caseId, {
    leaseId: claimed?.leaseId as string,
    stage: "inference",
    workerId: "worker-postgres",
    leaseSeconds: 120,
    now: heartbeatAt,
  });

  const repo2 = new PostgresCaseRepository("postgresql://test", pool);
  const service2 = new MemoryCaseService({ repository: repo2 });
  const reloaded = await service2.getCase(created.caseId);
  const activeClaim = reloaded.workflowQueue.find((entry) => entry.stage === "inference" && entry.status === "claimed");

  assert.equal(activeClaim?.lastHeartbeatAt, heartbeatAt);
  assert.equal(activeClaim?.claimExpiresAt, new Date(Date.parse(heartbeatAt) + 120_000).toISOString());
});
