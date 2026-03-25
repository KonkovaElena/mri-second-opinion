import test from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { PostgresCaseRepository } from "../src/postgres-case-repository";
import type { CaseRecord } from "../src/cases";

function buildCaseRecord(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    caseId: "case-1",
    patientAlias: "patient-a",
    studyUid: "1.2.3.study",
    workflowFamily: "brain-structural",
    status: "SUBMITTED",
    createdAt: "2026-03-25T10:00:00.000Z",
    updatedAt: "2026-03-25T10:00:00.000Z",
    indication: null,
    sequenceInventory: ["T1w", "FLAIR"],
    history: [],
    operationLog: [],
    planEnvelope: {
      version: "0.1.0",
      caseId: "case-1",
      workflowFamily: "brain-structural",
      source: "public-api",
      createdAt: "2026-03-25T10:00:00.000Z",
      packageResolution: {
        selectedPackage: "pkg-neuro-structural-v1",
        routingKey: "brain-structural",
        rationale: "test",
      },
      requiredArtifacts: [],
      branches: [],
      downgradeRecord: null,
      policyGate: {
        clinicianReviewRequired: true,
        exportControl: "manual-release",
        releaseBlockers: [],
      },
    },
    evidenceCards: [],
    report: null,
    lastInferenceFingerprint: null,
    review: {
      reviewerId: "",
      reviewerRole: null,
      comments: null,
      reviewedAt: null,
    },
    ...overrides,
  };
}

function createPoolStub() {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const responses: Array<{ rows: Array<{ payload: CaseRecord }> }> = [];

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
  const record = buildCaseRecord();
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

test("PostgresCaseRepository upsert persists normalized JSON payload", async () => {
  const stub = createPoolStub();
  const repository = new PostgresCaseRepository("postgresql://example", stub.pool);
  const record = buildCaseRecord({ lastInferenceFingerprint: null });

  await repository.upsert(record);

  assert.equal(stub.calls.length, 1);
  assert.match(stub.calls[0].sql, /INSERT INTO case_records/i);
  assert.deepEqual(stub.calls[0].params?.slice(0, 5), [
    record.caseId,
    record.studyUid,
    record.status,
    record.createdAt,
    record.updatedAt,
  ]);
  assert.equal(
    JSON.parse(String(stub.calls[0].params?.[5])).lastInferenceFingerprint,
    null,
  );
});

test("PostgresCaseRepository delete and study-uid lookup use targeted queries", async () => {
  const stub = createPoolStub();
  const record = buildCaseRecord({ studyUid: "1.2.3.lookup" });
  stub.queueResponse([{ payload: record }]);
  const repository = new PostgresCaseRepository("postgresql://example", stub.pool);

  const found = await repository.findByStudyUid("1.2.3.lookup");
  await repository.delete("case-1");

  assert.equal(found?.studyUid, "1.2.3.lookup");
  assert.match(stub.calls[0].sql, /WHERE study_uid = \$1 LIMIT 1/);
  assert.deepEqual(stub.calls[0].params, ["1.2.3.lookup"]);
  assert.match(stub.calls[1].sql, /DELETE FROM case_records WHERE case_id = \$1/);
  assert.deepEqual(stub.calls[1].params, ["case-1"]);
});