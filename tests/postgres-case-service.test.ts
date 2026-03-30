import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { MemoryCaseService, WorkflowError } from "../src/cases";

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

function createPostgresPersistenceHarness() {
  const database = newDb();
  const adapter = database.adapters.createPg();
  const adminPool = new adapter.Pool();

  return {
    createService: () =>
      new MemoryCaseService({
        storageMode: "postgres",
        caseStoreDatabaseUrl: "postgresql://unit.test/mri_second_opinion",
        caseStoreSchema: "mri_wave1",
        postgresPoolFactory: () => new adapter.Pool(),
      } as unknown as ConstructorParameters<typeof MemoryCaseService>[0]),
    async setInferenceLeaseExpiry(jobId: string, leaseExpiresAt: string | null) {
      await adminPool.query(
        "UPDATE mri_wave1.inference_jobs SET lease_expires_at = $1 WHERE job_id = $2",
        [leaseExpiresAt, jobId],
      );
    },
    async close() {
      await adminPool.end();
    },
  };
}

async function expectWorkflowError(
  action: () => Promise<unknown>,
  statusCode: number,
  code: string,
) {
  await assert.rejects(action, (error: unknown) => {
    assert.equal(error instanceof WorkflowError, true);
    assert.equal((error as WorkflowError).statusCode, statusCode);
    assert.equal((error as WorkflowError).code, code);
    return true;
  });
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

test("stale postgres service can renew a claimed inference lease", async () => {
  const createService = createPostgresServiceFactory();
  const seed = createService();
  const workerA = createService();
  const workerB = createService();

  try {
    const created = await seed.createCase({
      patientAlias: "postgres-live-lease-renew",
      studyUid: "1.2.3.postgres.live.lease.renew",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const primedJobs = await workerB.listInferenceJobs();
    assert.equal(primedJobs.length, 1);
    assert.equal(primedJobs[0].caseId, created.caseId);
    assert.equal(primedJobs[0].status, "queued");

    const claimed = await workerA.claimNextInferenceJob("postgres-live-worker-a");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.status, "claimed");
    assert.equal(typeof claimed?.leaseId, "string");
    assert.equal(typeof claimed?.leaseExpiresAt, "string");

    const renewed = await workerB.renewLease(claimed!.leaseId!);
    assert.equal(renewed.jobId, claimed!.jobId);
    assert.equal(renewed.leaseId, claimed!.leaseId);
    assert.equal(new Date(renewed.leaseExpiresAt!).getTime() >= new Date(claimed!.leaseExpiresAt!).getTime(), true);
  } finally {
    await seed.close();
    await workerA.close();
    await workerB.close();
  }
});

test("postgres live renew reports LEASE_NOT_FOUND for an unknown lease", async () => {
  const createService = createPostgresServiceFactory();
  const service = createService();

  try {
    await expectWorkflowError(() => service.renewLease("missing-live-lease"), 404, "LEASE_NOT_FOUND");
  } finally {
    await service.close();
  }
});

test("stale postgres service reports LEASE_EXPIRED when the persisted lease is already expired", async () => {
  const harness = createPostgresPersistenceHarness();
  const seed = harness.createService();
  const workerA = harness.createService();
  const workerB = harness.createService();

  try {
    const created = await seed.createCase({
      patientAlias: "postgres-live-lease-expired",
      studyUid: "1.2.3.postgres.live.lease.expired",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const primedJobs = await workerB.listInferenceJobs();
    assert.equal(primedJobs.length, 1);
    assert.equal(primedJobs[0].caseId, created.caseId);
    assert.equal(primedJobs[0].status, "queued");

    const claimed = await workerA.claimNextInferenceJob("postgres-live-worker-expired-a");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.status, "claimed");
    assert.equal(typeof claimed?.leaseId, "string");

    await harness.setInferenceLeaseExpiry(
      claimed!.jobId,
      new Date(Date.now() - 60_000).toISOString(),
    );

    await expectWorkflowError(() => workerB.renewLease(claimed!.leaseId!), 409, "LEASE_EXPIRED");
  } finally {
    await seed.close();
    await workerA.close();
    await workerB.close();
    await harness.close();
  }
});

test("stale postgres service can requeue a transient dispatch failure", async () => {
  const createService = createPostgresServiceFactory();
  const seed = createService();
  const workerA = createService();
  const workerB = createService();

  try {
    const created = await seed.createCase({
      patientAlias: "postgres-live-dispatch-fail",
      studyUid: "1.2.3.postgres.live.dispatch.fail",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const primedJobs = await workerB.listInferenceJobs();
    assert.equal(primedJobs.length, 1);
    assert.equal(primedJobs[0].caseId, created.caseId);
    assert.equal(primedJobs[0].status, "queued");

    const claimed = await workerA.claimNextInferenceJob("postgres-live-worker-fail-a");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.status, "claimed");
    assert.equal(typeof claimed?.leaseId, "string");

    const failed = await workerB.failInferenceJob({
      caseId: created.caseId,
      leaseId: claimed!.leaseId!,
      failureClass: "transient",
      errorCode: "UPSTREAM_502",
      detail: "stale postgres instance should still resolve the active lease",
    });
    assert.deepEqual(failed, {
      failureClass: "transient",
      requeued: true,
      jobId: claimed!.jobId,
    });

    const refreshedJobs = await workerB.listInferenceJobs();
    assert.equal(refreshedJobs.length, 1);
    assert.equal(refreshedJobs[0].jobId, claimed!.jobId);
    assert.equal(refreshedJobs[0].status, "queued");
    assert.equal(refreshedJobs[0].workerId, null);
    assert.equal(refreshedJobs[0].failureClass, "transient");
    assert.equal(refreshedJobs[0].leaseId, null);
  } finally {
    await seed.close();
    await workerA.close();
    await workerB.close();
  }
});

test("stale postgres service marks a terminal dispatch failure as failed without requeue", async () => {
  const createService = createPostgresServiceFactory();
  const seed = createService();
  const workerA = createService();
  const workerB = createService();

  try {
    const created = await seed.createCase({
      patientAlias: "postgres-live-dispatch-fail-terminal",
      studyUid: "1.2.3.postgres.live.dispatch.fail.terminal",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const primedJobs = await workerB.listInferenceJobs();
    assert.equal(primedJobs.length, 1);
    assert.equal(primedJobs[0].caseId, created.caseId);
    assert.equal(primedJobs[0].status, "queued");

    const claimed = await workerA.claimNextInferenceJob("postgres-live-worker-fail-terminal-a");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.status, "claimed");
    assert.equal(typeof claimed?.leaseId, "string");

    const failed = await workerB.failInferenceJob({
      caseId: created.caseId,
      leaseId: claimed!.leaseId!,
      failureClass: "terminal",
      errorCode: "MISSING_CONFIG",
      detail: "stale postgres instance should preserve the terminal failure branch",
    });
    assert.deepEqual(failed, {
      failureClass: "terminal",
      requeued: false,
      jobId: claimed!.jobId,
    });

    const refreshedJobs = await workerB.listInferenceJobs();
    assert.equal(refreshedJobs.length, 1);
    assert.equal(refreshedJobs[0].jobId, claimed!.jobId);
    assert.equal(refreshedJobs[0].status, "failed");
    assert.equal(refreshedJobs[0].failureClass, "terminal");
    assert.notEqual(refreshedJobs[0].completedAt, null);
    assert.equal(refreshedJobs[0].leaseId, null);
    assert.equal(refreshedJobs[0].leaseExpiresAt, null);
    assert.ok(refreshedJobs[0].lastError?.includes("MISSING_CONFIG"));
  } finally {
    await seed.close();
    await workerA.close();
    await workerB.close();
  }
});

test("stale postgres service reports JOB_NOT_FOUND when the claimed job is already completed", async () => {
  const createService = createPostgresServiceFactory();
  const seed = createService();
  const workerA = createService();
  const workerB = createService();

  try {
    const created = await seed.createCase({
      patientAlias: "postgres-live-dispatch-fail-missing",
      studyUid: "1.2.3.postgres.live.dispatch.fail.missing",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const primedJobs = await workerB.listInferenceJobs();
    assert.equal(primedJobs.length, 1);
    assert.equal(primedJobs[0].caseId, created.caseId);
    assert.equal(primedJobs[0].status, "queued");

    const claimed = await workerA.claimNextInferenceJob("postgres-live-worker-fail-missing-a");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.status, "claimed");
    assert.equal(typeof claimed?.leaseId, "string");

    const completed = await workerA.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["Completing the claimed job should invalidate the stale lease."],
      measurements: [{ label: "brain_volume_ml", value: 1102 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Stale lease invalidation draft.",
    });
    assert.equal(completed.status, "AWAITING_REVIEW");

    await expectWorkflowError(
      () =>
        workerB.failInferenceJob({
          caseId: created.caseId,
          leaseId: claimed!.leaseId!,
          failureClass: "transient",
          errorCode: "LATE_FAIL",
          detail: "stale postgres instance should not find a completed job via the old lease",
        }),
      404,
      "JOB_NOT_FOUND",
    );
  } finally {
    await seed.close();
    await workerA.close();
    await workerB.close();
  }
});

test("caller-owned postgres pool remains usable after one service closes", async () => {
  const database = newDb();
  const adapter = database.adapters.createPg();
  const sharedPool = new adapter.Pool();
  let endCalls = 0;

  sharedPool.end = (async () => {
    endCalls += 1;
  }) as typeof sharedPool.end;

  const createService = () =>
    new MemoryCaseService({
      storageMode: "postgres",
      caseStoreDatabaseUrl: "postgresql://unit.test/mri_second_opinion",
      caseStoreSchema: "mri_wave1",
      postgresPoolFactory: () => sharedPool,
    } as unknown as ConstructorParameters<typeof MemoryCaseService>[0]);

  const first = createService();
  const second = createService();

  try {
    const created = await first.createCase({
      patientAlias: "postgres-shared-pool-lifecycle",
      studyUid: "1.2.3.postgres.shared.pool.lifecycle",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await first.close();
    assert.equal(endCalls, 0);

    const jobs = await second.listInferenceJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].caseId, created.caseId);
    assert.equal(jobs[0].status, "queued");
  } finally {
    await second.close();
    await sharedPool.end();
  }
});