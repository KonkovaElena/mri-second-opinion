import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { MemoryCaseService } from "../src/cases";

function createPostgresServiceFactory() {
  const database = newDb();
  const adapter = database.adapters.createPg();

  return () =>
    new MemoryCaseService({
      storageMode: "postgres",
      caseStoreDatabaseUrl: "postgresql://unit.test/mri_second_opinion",
      caseStoreSchema: "mri_wave1",
      postgresPoolFactory: () => new adapter.Pool(),
    } as unknown as ConstructorParameters<typeof MemoryCaseService>[0]);
}

test("postgres storage mode preserves delivery queue state across service restart", async () => {
  const createService = createPostgresServiceFactory();
  const first = createService();

  try {
    const created = await first.createCase({
      patientAlias: "postgres-queue",
      studyUid: "1.2.3.postgres.queue",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await first.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["Postgres queue verification."],
      measurements: [{ label: "brain_volume_ml", value: 1101 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Postgres queue draft.",
    });

    await first.reviewCase(created.caseId, {
      reviewerId: "postgres-reviewer",
      comments: "Postgres queue reviewed.",
    });

    await first.finalizeCase(created.caseId);
  } finally {
    await first.close();
  }

  const second = createService();

  try {
    const jobs = await second.listDeliveryJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "queued");

    const claimed = await second.claimNextDeliveryJob("postgres-worker");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.status, "claimed");
    assert.equal(claimed?.workerId, "postgres-worker");
  } finally {
    await second.close();
  }
});

test("postgres storage mode persists inference jobs through claim and callback completion", async () => {
  const createService = createPostgresServiceFactory();
  const first = createService();
  let caseId = "";

  try {
    const created = await first.createCase({
      patientAlias: "postgres-inference-queue",
      studyUid: "1.2.3.postgres.inference.queue",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    caseId = created.caseId;
  } finally {
    await first.close();
  }

  const second = createService();

  try {
    const jobs = await second.listInferenceJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].caseId, caseId);
    assert.equal(jobs[0].status, "queued");

    const claimed = await second.claimNextInferenceJob("postgres-inference-worker");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.status, "claimed");
    assert.equal(claimed?.workerId, "postgres-inference-worker");

    const completed = await second.completeInference(caseId, {
      qcDisposition: "pass",
      findings: ["Postgres inference queue verification."],
      measurements: [{ label: "brain_volume_ml", value: 1101 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Postgres inference queue draft.",
    });

    assert.equal(completed.status, "AWAITING_REVIEW");
  } finally {
    await second.close();
  }

  const third = createService();

  try {
    const jobs = await third.listInferenceJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].caseId, caseId);
    assert.equal(jobs[0].status, "completed");
    assert.equal(jobs[0].workerId, "postgres-inference-worker");
    assert.notEqual(jobs[0].completedAt, null);
  } finally {
    await third.close();
  }
});

test("postgres storage mode requeues expired claimed inference jobs", async () => {
  const createService = createPostgresServiceFactory();
  const first = createService();
  let caseId = "";

  try {
    const created = await first.createCase({
      patientAlias: "postgres-inference-requeue",
      studyUid: "1.2.3.postgres.inference.requeue",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    caseId = created.caseId;

    const claimed = await first.claimNextInferenceJob("postgres-stale-worker");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.status, "claimed");
  } finally {
    await first.close();
  }

  const second = createService();

  try {
    const requeued = await second.requeueExpiredInferenceJobs(0);
    assert.equal(requeued.length, 1);
    assert.equal(requeued[0].caseId, caseId);
    assert.equal(requeued[0].status, "queued");
    assert.equal(requeued[0].workerId, null);

    const reclaimed = await second.claimNextInferenceJob("postgres-fresh-worker");
    assert.notEqual(reclaimed, null);
    assert.equal(reclaimed?.status, "claimed");
    assert.equal(reclaimed?.workerId, "postgres-fresh-worker");
    assert.equal(reclaimed?.attemptCount, 2);
  } finally {
    await second.close();
  }
});