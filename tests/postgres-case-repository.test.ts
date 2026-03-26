import test from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { PostgresCaseRepository } from "../src/postgres-case-repository";
import { MemoryCaseService, type CaseRecord } from "../src/cases";

async function buildStoredCaseRecord(overrides: Partial<CaseRecord> = {}) {
  const service = new MemoryCaseService();
  const created = await service.createCase({
    patientAlias: "patient-a",
    studyUid: overrides.studyUid ?? "1.2.3.study",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  return {
    ...created,
    ...overrides,
  };
}

function createPoolStub() {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const responses: Array<{ rows: Array<Record<string, unknown>> }> = [];

  const pool: Pick<pg.Pool, "query"> = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return responses.shift() ?? { rows: [] };
    },
  };

  return {
    pool,
    calls,
    queueResponse(rows: Array<{ payload: CaseRecord }>) {
      responses.push({ rows });
    },
  };
}

test("PostgresCaseRepository reads list and get payloads as cloned records", async () => {
  const stub = createPoolStub();
  const record = await buildStoredCaseRecord();
  stub.queueResponse([{ payload: record }]);
  stub.queueResponse([{ payload: { ...record, caseId: "case-2" } }]);

  const repository = new PostgresCaseRepository("postgresql://example", stub.pool);

  const listed = await repository.list();
  const loaded = await repository.get("case-2");

  assert.equal(listed.length, 1);
  assert.equal(loaded?.caseId, "case-2");
  listed[0].patientAlias = "mutated";
  assert.equal(record.patientAlias, "patient-a");
  assert.match(stub.calls[0].sql, /ORDER BY updated_at DESC/);
  assert.match(stub.calls[1].sql, /WHERE case_id = \$1/);
  assert.deepEqual(stub.calls[1].params, ["case-2"]);
});

test("PostgresCaseRepository reads summary and workflow projections without full payload scans", async () => {
  const stub = createPoolStub();
  const repository = new PostgresCaseRepository("postgresql://example", stub.pool);

  stub.queueResponse([
    {
      payload: {
        caseId: "case-1",
        patientAlias: "patient-a",
        studyUid: "1.2.3.study",
        workflowFamily: "brain-structural",
        status: "SUBMITTED",
        createdAt: "2026-03-25T10:00:00.000Z",
        updatedAt: "2026-03-25T10:00:00.000Z",
        indication: null,
        sequenceInventory: ["T1w", "FLAIR"],
        operationLog: [],
        review: {
          reviewerId: "",
          reviewerRole: null,
          comments: null,
          reviewedAt: null,
        },
        finalizedBy: null,
        report: null,
      },
    },
  ]);
  stub.queueResponse([
    {
      payload: {
        caseId: "case-1",
        updatedAt: "2026-03-25T10:00:00.000Z",
        jobs: [
          {
            queueEntryId: "queue-1",
            caseId: "case-1",
            stage: "inference",
            status: "queued",
            attempt: 1,
            enqueuedAt: "2026-03-25T10:00:00.000Z",
            updatedAt: "2026-03-25T10:00:00.000Z",
            resolvedAt: null,
            leaseId: null,
            claimedBy: null,
            claimedAt: null,
            claimExpiresAt: null,
            detail: "Queued for inference.",
            sourceOperation: "case-created",
          },
        ],
      },
    },
  ]);

  const summaries = await repository.listSummaries();
  const jobs = await repository.listWorkflowJobs();

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].caseId, "case-1");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].jobs[0].stage, "inference");
  assert.match(stub.calls[0].sql, /SELECT payload FROM case_summary_projection/i);
  assert.match(stub.calls[1].sql, /SELECT payload FROM workflow_job_projection/i);
});

test("PostgresCaseRepository upsert persists normalized JSON payload", async () => {
  const stub = createPoolStub();
  const repository = new PostgresCaseRepository("postgresql://example", stub.pool);
  const record = await buildStoredCaseRecord({ lastInferenceFingerprint: null });

  await repository.upsert(record);

  assert.equal(stub.calls[0].sql, "BEGIN");
  assert.match(stub.calls[1].sql, /INSERT INTO case_records/i);
  assert.deepEqual(stub.calls[1].params?.slice(0, 5), [
    record.caseId,
    record.studyUid,
    record.status,
    record.createdAt,
    record.updatedAt,
  ]);
  assert.equal(
    JSON.parse(String(stub.calls[1].params?.[5])).lastInferenceFingerprint,
    null,
  );
  assert.match(stub.calls[2].sql, /INSERT INTO case_summary_projection/i);
  assert.match(stub.calls[3].sql, /INSERT INTO workflow_job_projection/i);
  assert.match(stub.calls[4].sql, /INSERT INTO artifact_reference_projection/i);
  assert.equal(stub.calls[5].sql, "COMMIT");
});

test("PostgresCaseRepository delete and study-uid lookup use targeted queries", async () => {
  const stub = createPoolStub();
  const record = await buildStoredCaseRecord({ studyUid: "1.2.3.lookup" });
  stub.queueResponse([{ case_id: record.caseId }]);
  stub.queueResponse([{ payload: record }]);
  const repository = new PostgresCaseRepository("postgresql://example", stub.pool);

  const found = await repository.findByStudyUid("1.2.3.lookup");
  await repository.delete("case-1");

  assert.equal(found?.studyUid, "1.2.3.lookup");
  assert.match(stub.calls[0].sql, /SELECT case_id FROM case_summary_projection WHERE study_uid = \$1 LIMIT 1/i);
  assert.deepEqual(stub.calls[0].params, ["1.2.3.lookup"]);
  assert.match(stub.calls[1].sql, /SELECT payload FROM case_records WHERE case_id = \$1/i);
  assert.equal(stub.calls[2].sql, "BEGIN");
  assert.match(stub.calls[3].sql, /DELETE FROM case_summary_projection WHERE case_id = \$1/i);
  assert.match(stub.calls[4].sql, /DELETE FROM workflow_job_projection WHERE case_id = \$1/i);
  assert.match(stub.calls[5].sql, /DELETE FROM artifact_reference_projection WHERE case_id = \$1/i);
  assert.match(stub.calls[6].sql, /DELETE FROM case_records WHERE case_id = \$1/i);
  assert.equal(stub.calls[7].sql, "COMMIT");
  assert.deepEqual(stub.calls[6].params, ["case-1"]);
});