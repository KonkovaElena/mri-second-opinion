import test from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { PostgresCaseRepository } from "../src/postgres-case-repository";
import { MemoryCaseService, type CaseRecord } from "../src/cases";

// ---------------------------------------------------------------------------
// Shared pool stub that behaves like a real Postgres: keeps rows in memory
// across multiple repository and service instances (simulates shared DB).
// ---------------------------------------------------------------------------

function buildPoolBackend() {
  const rows = new Map<string, { case_id: string; study_uid: string; status: string; created_at: string; updated_at: string; payload: CaseRecord }>();

  async function query(sql: string, params?: unknown[]) {
      const text = sql.replace(/\s+/g, " ").trim();

      // SELECT list
      if (/^SELECT payload FROM case_records ORDER BY/i.test(text)) {
        return { rows: Array.from(rows.values()).map((r) => ({ payload: r.payload })) };
      }

      // DELETE (must come before WHERE case_id check)
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
      if (/WHERE study_uid = \$1/i.test(text) && params) {
        const match = Array.from(rows.values()).find((r) => r.study_uid === String(params[0]));
        return { rows: match ? [{ payload: match.payload }] : [] };
      }

      // INSERT / UPSERT
      if (/^INSERT INTO case_records/i.test(text) && params) {
        const caseId = String(params[0]);
        const payload = JSON.parse(String(params[5])) as CaseRecord;
        rows.set(caseId, {
          case_id: caseId,
          study_uid: String(params[1]),
          status: String(params[2]),
          created_at: String(params[3]),
          updated_at: String(params[4]),
          payload,
        });
        return { rows: [] };
      }

      return { rows: [] };
  }

  const pool = { query } as unknown as Pick<pg.Pool, "query">;

  return { pool, rows };
}

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
    deliveryOutcome: "pending",
  });
  assert.equal(afterFinalize.status, "DELIVERY_PENDING");

  // Simulate restart — new service, same pool
  const repo2 = new PostgresCaseRepository("postgresql://test", pool);
  const service2 = new MemoryCaseService({ repository: repo2 });

  const reloaded = await service2.getCase(created.caseId);

  assert.equal(reloaded.status, "DELIVERY_PENDING");
  assert.equal(reloaded.review.reviewerId, "clinician-http-test");
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
