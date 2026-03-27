import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { MemoryCaseService } from "../src/cases";
import type { DispatchQueueAdapter, DispatchQueueClaimInput, DispatchQueueJob } from "../src/dispatch-queue";
import type { ArtifactReferenceProjection, CaseSummaryProjection, WorkflowJobProjection } from "../src/case-projections";
import type { CaseRepository } from "../src/case-repository";
import { createPlanEnvelope } from "../src/case-planning";

function createRecordingDispatchQueue(initialJobs: DispatchQueueJob[] = []) {
  const queue = initialJobs.map((job) => structuredClone(job));
  const enqueued: DispatchQueueJob[] = [];
  const claimCalls: DispatchQueueClaimInput[] = [];

  const adapter: DispatchQueueAdapter = {
    async enqueue(job) {
      const cloned = structuredClone(job);
      enqueued.push(cloned);
      queue.push(cloned);
    },
    async claim(input) {
      claimCalls.push({ ...input });
      const index = queue.findIndex((job) => job.stage === input.stage);

      if (index === -1) {
        return null;
      }

      return queue.splice(index, 1)[0];
    },
  };

  return {
    adapter,
    enqueued,
    claimCalls,
  };
}

function createStorePath() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-case-service-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.json"),
  };
}

async function waitUntilAfter(targetIso: string, timeoutMs: number = 3_000) {
  const deadline = Date.now() + timeoutMs;
  const targetMs = Date.parse(targetIso);

  while (Date.now() <= deadline) {
    if (Date.now() > targetMs) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${targetIso}`);
}

test("stale snapshot revision rejects concurrent writers", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const writerA = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const writerB = new MemoryCaseService({ snapshotFilePath: caseStoreFile });

    await writerA.createCase({
      patientAlias: "concurrency-a",
      studyUid: "1.2.3.concurrent.a",
      sequenceInventory: ["T1w"],
    });

    await assert.rejects(
      async () => {
        await writerB.createCase({
          patientAlias: "concurrency-b",
          studyUid: "1.2.3.concurrent.b",
          sequenceInventory: ["T1w"],
        });
      },
      /Concurrent case store modification detected/,
    );

    assert.equal((await writerB.listCases()).length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("operation transcript and retry history survive service restart", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const first = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await first.createCase({
      patientAlias: "persisted-ops",
      studyUid: "1.2.3.persisted.ops",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const inferred = await first.completeInference(created.caseId, {
      qcDisposition: "warn",
      findings: ["Stable chronic change."],
      measurements: [{ label: "brain_volume_ml", value: 1098 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Draft created for persistence verification.",
    });
    const reviewed = await first.reviewCase(inferred.caseId, {
      reviewerId: "clinician-persist",
      comments: "Manual review completed.",
    });
    const finalized = await first.finalizeCase(reviewed.caseId, {
      clinicianId: "clinician-persist",
      deliveryOutcome: "failed",
    });
    await first.retryDelivery(finalized.caseId);

    const second = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const reloaded = await second.getCase(created.caseId);
    const summary = await second.getOperationsSummary();

    assert.equal(reloaded.status, "DELIVERY_PENDING");
    assert.deepEqual(reloaded.report?.versionPins, {
      machineDraftVersion: 1,
      reviewedReleaseVersion: 1,
      finalizedReleaseVersion: 1,
    });
    assert.equal(Array.isArray(reloaded.workflowQueue), true);
    assert.equal(
      reloaded.workflowQueue.some((entry) => entry.stage === "delivery" && entry.status === "queued" && entry.attempt === 2),
      true,
    );
    assert.equal(reloaded.operationLog.some((entry) => entry.operationType === "case-created"), true);
    assert.equal(reloaded.operationLog.some((entry) => entry.operationType === "delivery-retry-requested"), true);
    assert.equal(summary.retryHistory.length, 1);
    assert.equal(summary.retryHistory[0].caseId, created.caseId);
    assert.equal(summary.recentOperations.some((entry) => entry.caseId === created.caseId && entry.operationType === "delivery-retry-requested"), true);
    assert.equal(summary.queue.totalActive, 1);
    assert.equal(summary.queue.byStage.inference, 0);
    assert.equal(summary.queue.byStage.delivery, 1);
    assert.equal(summary.queue.active[0].caseId, created.caseId);
    assert.equal(summary.queue.active[0].stage, "delivery");
    assert.equal(summary.queue.active[0].attempt, 2);
    assert.equal(
      summary.queue.recent.some((entry) => entry.caseId === created.caseId && entry.stage === "delivery" && entry.status === "failed"),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("snapshot persistence stores summary, workflow, and artifact projections", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const service = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await service.createCase({
      patientAlias: "projection-snapshot",
      studyUid: "1.2.3.snapshot.projection",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await service.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["No acute finding."],
      measurements: [{ label: "brain_volume_ml", value: 1104 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Projection snapshot verification.",
    });

    const persisted = JSON.parse(readFileSync(caseStoreFile, "utf8")) as {
      version: string;
      caseSummaries?: Array<{ caseId: string }>;
      workflowJobs?: Array<{ caseId: string }>;
      artifactReferences?: Array<{ caseId: string; reportArtifactRefs: string[] }>;
    };

    assert.equal(persisted.version, "0.2.0");
    assert.equal(persisted.caseSummaries?.some((entry) => entry.caseId === created.caseId), true);
    assert.equal(persisted.workflowJobs?.some((entry) => entry.caseId === created.caseId), true);
    assert.equal(
      persisted.artifactReferences?.some(
        (entry) => entry.caseId === created.caseId && entry.reportArtifactRefs.length === 2,
      ),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("queue view can be rebuilt from durable records across inference and delivery stages", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const first = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const inferencePending = await first.createCase({
      patientAlias: "queued-inference",
      studyUid: "1.2.3.queue.inference",
      sequenceInventory: ["T1w", "FLAIR"],
    });
    const deliveryPending = await first.createCase({
      patientAlias: "queued-delivery",
      studyUid: "1.2.3.queue.delivery",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await first.completeInference(deliveryPending.caseId, {
      qcDisposition: "pass",
      findings: ["No acute finding."],
      measurements: [{ label: "brain_volume_ml", value: 1110 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Queue rebuild verification draft.",
    });
    await first.reviewCase(deliveryPending.caseId, {
      reviewerId: "clinician-queue",
      comments: "Queued for outbound delivery.",
    });
    await first.finalizeCase(deliveryPending.caseId, {
      clinicianId: "clinician-queue",
    });

    const second = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const summary = await second.getOperationsSummary();

    assert.equal(summary.totalCases, 2);
    assert.equal(summary.queue.totalActive, 2);
    assert.equal(summary.queue.byStage.inference, 1);
    assert.equal(summary.queue.byStage.delivery, 1);
    assert.equal(
      summary.queue.active.some((entry) => entry.caseId === inferencePending.caseId && entry.stage === "inference" && entry.status === "queued"),
      true,
    );
    assert.equal(
      summary.queue.active.some((entry) => entry.caseId === deliveryPending.caseId && entry.stage === "delivery" && entry.status === "queued"),
      true,
    );
    assert.equal(
      summary.queue.recent.some((entry) => entry.caseId === deliveryPending.caseId && entry.stage === "inference" && entry.status === "completed"),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("operations summary uses projection reads without full case materialization", async () => {
  const createdAt = "2026-03-26T00:00:00.000Z";
  const updatedAt = "2026-03-26T00:05:00.000Z";
  const summaryProjection: CaseSummaryProjection = {
    caseId: "projection-only-case",
    patientAlias: "projection-only",
    studyUid: "1.2.3.projection.only",
    workflowFamily: "brain-structural",
    status: "AWAITING_REVIEW",
    createdAt,
    updatedAt,
    indication: null,
    sequenceInventory: ["T1w", "FLAIR"],
    operationLog: [
      {
        operationId: "op-1",
        caseId: "projection-only-case",
        operationType: "inference-completed",
        actorType: "system",
        source: "internal-inference",
        outcome: "completed",
        detail: "Projection-backed summary proof.",
        at: updatedAt,
      },
    ],
    review: {
      reviewerId: "",
      reviewerRole: null,
      comments: null,
      reviewedAt: null,
    },
    finalizedBy: null,
    report: {
      reviewStatus: "draft",
      versionPins: {
        machineDraftVersion: 1,
        reviewedReleaseVersion: null,
        finalizedReleaseVersion: null,
      },
      qcDisposition: "pass",
      generatedAt: updatedAt,
      workflowVersion: "wf-1",
    },
  };

  const repository: CaseRepository = {
    list: async () => {
      throw new Error("full case list should not be used for operations summary");
    },
    listSummaries: async () => [summaryProjection],
    listWorkflowJobs: async (): Promise<WorkflowJobProjection[]> => [],
    listArtifactReferences: async (): Promise<ArtifactReferenceProjection[]> => [],
    get: async () => {
      throw new Error("case detail reads should not be used for operations summary");
    },
    upsert: async () => {
      throw new Error("writes are not expected during operations summary reads");
    },
    delete: async () => {
      throw new Error("deletes are not expected during operations summary reads");
    },
    findByStudyUid: async () => null,
  };

  const service = new MemoryCaseService({ repository });
  const summary = await service.getOperationsSummary();

  assert.equal(summary.totalCases, 1);
  assert.equal(summary.byStatus.AWAITING_REVIEW, 1);
  assert.equal(summary.reviewRequiredCount, 1);
  assert.equal(summary.queue.totalActive, 0);
  assert.equal(summary.queueHealth.queued, 0);
  assert.equal(summary.queueHealth.inFlight, 0);
  assert.equal(summary.queueHealth.abandoned, 0);
  assert.equal(summary.queueHealth.deadLetter, 0);
  assert.equal(summary.queueHealth.retry, 0);
  assert.equal(summary.workerHealth.activeWorkers, 0);
  assert.equal(summary.workerHealth.staleLeases, 0);
  assert.equal(summary.recentOperations[0]?.operationType, "inference-completed");
});

test("dispatch claims survive restart and expose inference package context", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const first = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await first.createCase({
      patientAlias: "dispatch-inference",
      studyUid: "1.2.3.dispatch.inference",
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "memory complaints",
    });

    const claimed = await first.claimNextDispatch({
      workerId: "worker-inference-a",
      stage: "inference",
      leaseSeconds: 120,
    });

    assert.equal(claimed?.caseId, created.caseId);
    assert.equal(claimed?.stage, "inference");
    assert.equal(claimed?.workflowPackage?.packageId, "brain-structural-fastsurfer");
    assert.equal(claimed?.studyContext.studyUid, created.studyUid);

    const second = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const reloaded = await second.getCase(created.caseId);

    assert.equal(
      reloaded.workflowQueue.some(
        (entry) =>
          entry.stage === "inference" &&
          entry.status === "claimed" &&
          entry.claimedBy === "worker-inference-a" &&
          typeof entry.leaseId === "string" &&
          entry.leaseId.length > 0,
      ),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("expired dispatch claims are re-queued and can be reclaimed by another worker", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const service = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await service.createCase({
      patientAlias: "dispatch-expiry",
      studyUid: "1.2.3.dispatch.expiry",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const firstClaim = await service.claimNextDispatch({
      workerId: "worker-expired",
      stage: "inference",
      leaseSeconds: 1,
    });

    assert.equal(firstClaim?.caseId, created.caseId);

    const reclaimed = await service.claimNextDispatch({
      workerId: "worker-reclaimed",
      stage: "inference",
      leaseSeconds: 120,
      now: new Date(Date.now() + 5_000).toISOString(),
    });

    assert.equal(reclaimed?.caseId, created.caseId);
    assert.equal(reclaimed?.workerId, "worker-reclaimed");
    assert.notEqual(reclaimed?.leaseId, firstClaim?.leaseId);

    const reloaded = await service.getCase(created.caseId);
    const activeClaim = reloaded.workflowQueue.find(
      (entry) => entry.stage === "inference" && entry.status === "claimed",
    );

    assert.equal(activeClaim?.claimedBy, "worker-reclaimed");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dispatch queue adapter receives create and retry enqueue jobs with stable attempts", async () => {
  const dispatchQueue = createRecordingDispatchQueue();
  const service = new MemoryCaseService({ dispatchQueue: dispatchQueue.adapter });

  const created = await service.createCase({
    patientAlias: "adapter-enqueue",
    studyUid: "1.2.3.adapter.enqueue",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  await service.completeInference(created.caseId, {
    qcDisposition: "pass",
    findings: ["No acute finding."],
    measurements: [{ label: "brain_volume_ml", value: 1097 }],
    artifacts: ["artifact://qc", "artifact://report"],
    generatedSummary: "Adapter enqueue verification.",
  });
  await service.reviewCase(created.caseId, {
    reviewerId: "clinician-adapter",
  });
  await service.finalizeCase(created.caseId, {
    clinicianId: "clinician-adapter",
    deliveryOutcome: "failed",
  });
  await service.retryDelivery(created.caseId);

  const inferenceJobs = dispatchQueue.enqueued.filter((job) => job.stage === "inference");
  const deliveryJobs = dispatchQueue.enqueued.filter((job) => job.stage === "delivery");

  assert.equal(inferenceJobs.length, 1);
  assert.equal(inferenceJobs[0].attempt, 1);
  assert.equal(deliveryJobs.length, 1);
  assert.equal(deliveryJobs[0].attempt, 2);
});

test("dispatch queue adapter drives claims and expiry requeue through the service boundary", async () => {
  const dispatchQueue = createRecordingDispatchQueue();
  const service = new MemoryCaseService({ dispatchQueue: dispatchQueue.adapter });
  const created = await service.createCase({
    patientAlias: "adapter-claim",
    studyUid: "1.2.3.adapter.claim",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  const firstClaim = await service.claimNextDispatch({
    workerId: "worker-a",
    stage: "inference",
    leaseSeconds: 1,
  });

  const reclaimed = await service.claimNextDispatch({
    workerId: "worker-b",
    stage: "inference",
    leaseSeconds: 120,
    now: new Date(Date.now() + 5_000).toISOString(),
  });

  assert.equal(firstClaim?.caseId, created.caseId);
  assert.equal(firstClaim?.workerId, "worker-a");
  assert.equal(dispatchQueue.claimCalls.length, 2);
  assert.equal(reclaimed?.caseId, created.caseId);
  assert.equal(reclaimed?.workerId, "worker-b");
  assert.equal(
    dispatchQueue.enqueued.filter((job) => job.caseId === created.caseId && job.stage === "inference").length,
    2,
  );
});

test("delivery dispatch failures schedule bounded retries and eventually dead-letter the case", async () => {
  const dispatchQueue = createRecordingDispatchQueue();
  const service = new MemoryCaseService({ dispatchQueue: dispatchQueue.adapter });
  const created = await service.createCase({
    patientAlias: "delivery-dlq",
    studyUid: "1.2.3.delivery.dlq",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  await service.completeInference(created.caseId, {
    qcDisposition: "pass",
    findings: ["No acute finding."],
    measurements: [{ label: "brain_volume_ml", value: 1120 }],
    artifacts: ["artifact://qc", "artifact://report"],
    generatedSummary: "DLQ verification draft.",
  });
  await service.reviewCase(created.caseId, {
    reviewerId: "clinician-dlq",
  });
  await service.finalizeCase(created.caseId, {
    clinicianId: "clinician-dlq",
  });

  const firstClaim = await service.claimNextDispatch({
    workerId: "worker-delivery-1",
    stage: "delivery",
    leaseSeconds: 120,
  });

  assert.equal(firstClaim?.attempt, 1);
  assert.equal(firstClaim?.attemptId, "delivery-1");
  assert.equal(firstClaim?.retryTier, "standard");
  assert.equal(firstClaim?.maxAttempts, 3);

  await service.recordDispatchFailure(created.caseId, {
    leaseId: firstClaim?.leaseId as string,
    stage: "delivery",
    failureClass: "transient",
    failureCode: "SMTP_TIMEOUT",
    now: "2026-03-26T10:00:00.000Z",
  });

  const tooEarly = await service.claimNextDispatch({
    workerId: "worker-delivery-early",
    stage: "delivery",
    leaseSeconds: 120,
    now: "2026-03-26T10:00:05.000Z",
  });

  assert.equal(tooEarly, null);

  const secondClaim = await service.claimNextDispatch({
    workerId: "worker-delivery-2",
    stage: "delivery",
    leaseSeconds: 120,
    now: "2026-03-26T10:00:31.000Z",
  });

  assert.equal(secondClaim?.attempt, 2);
  assert.equal(secondClaim?.attemptId, "delivery-2");

  await service.recordDispatchFailure(created.caseId, {
    leaseId: secondClaim?.leaseId as string,
    stage: "delivery",
    failureClass: "transient",
    failureCode: "SMTP_TIMEOUT",
    now: "2026-03-26T10:01:00.000Z",
  });

  const thirdClaim = await service.claimNextDispatch({
    workerId: "worker-delivery-3",
    stage: "delivery",
    leaseSeconds: 120,
    now: "2026-03-26T10:03:01.000Z",
  });

  assert.equal(thirdClaim?.attempt, 3);
  assert.equal(thirdClaim?.attemptId, "delivery-3");

  const deadLettered = await service.recordDispatchFailure(created.caseId, {
    leaseId: thirdClaim?.leaseId as string,
    stage: "delivery",
    failureClass: "transient",
    failureCode: "SMTP_TIMEOUT",
    now: "2026-03-26T10:04:00.000Z",
  });

  assert.equal(deadLettered.status, "DELIVERY_FAILED");
  assert.equal(
    deadLettered.workflowQueue.filter((entry) => entry.stage === "delivery" && entry.deadLetteredAt !== null).length,
    1,
  );

  const summary = await service.getOperationsSummary();

  assert.equal(summary.queueHealth.deadLetter, 1);
  assert.equal(summary.queueHealth.retry, 0);
  assert.equal(summary.queueHealth.inFlight, 0);
  assert.equal(summary.workerHealth.activeWorkers, 0);

  await assert.rejects(
    async () => {
      await service.retryDelivery(created.caseId);
    },
    /DELIVERY_DEAD_LETTERED|dead-lettered/,
  );
});

test("renewing a dispatch lease persists heartbeat time and delays expiry-based reclaim", async () => {
  const service = new MemoryCaseService();
  const created = await service.createCase({
    patientAlias: "lease-heartbeat",
    studyUid: "1.2.3.lease.heartbeat",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  const claimed = await service.claimNextDispatch({
    workerId: "worker-heartbeat",
    stage: "inference",
    leaseSeconds: 30,
  });

  const heartbeatAt = new Date(Date.parse(claimed?.claimedAt as string) + 20_000).toISOString();

  const renewed = await service.renewDispatchLease(created.caseId, {
    leaseId: claimed?.leaseId as string,
    stage: "inference",
    workerId: "worker-heartbeat",
    leaseSeconds: 120,
    now: heartbeatAt,
  });

  assert.equal(renewed.lastHeartbeatAt, heartbeatAt);
  assert.equal(renewed.claimExpiresAt, new Date(Date.parse(heartbeatAt) + 120_000).toISOString());

  const tooEarly = await service.claimNextDispatch({
    workerId: "worker-second",
    stage: "inference",
    leaseSeconds: 60,
    now: new Date(Date.parse(heartbeatAt) + 40_000).toISOString(),
  });

  assert.equal(tooEarly, null);

  const reclaimed = await service.claimNextDispatch({
    workerId: "worker-second",
    stage: "inference",
    leaseSeconds: 60,
    now: new Date(Date.parse(renewed.claimExpiresAt) + 1_000).toISOString(),
  });

  assert.equal(reclaimed?.workerId, "worker-second");
  const reloaded = await service.getCase(created.caseId);
  const activeClaim = reloaded.workflowQueue.find((entry) => entry.stage === "inference" && entry.status === "claimed");

  assert.equal(activeClaim?.lastHeartbeatAt, reclaimed?.claimedAt);
});

test("expired dispatch lease cannot be renewed", async () => {
  const service = new MemoryCaseService();
  const created = await service.createCase({
    patientAlias: "lease-expired-renew",
    studyUid: "1.2.3.lease.expired.renew",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  const claimed = await service.claimNextDispatch({
    workerId: "worker-expired-renew",
    stage: "inference",
    leaseSeconds: 30,
  });

  await assert.rejects(
    async () => {
      await service.renewDispatchLease(created.caseId, {
        leaseId: claimed?.leaseId as string,
        stage: "inference",
        workerId: "worker-expired-renew",
        leaseSeconds: 60,
        now: new Date(Date.parse(claimed?.claimExpiresAt as string) + 1_000).toISOString(),
      });
    },
    /DISPATCH_LEASE_EXPIRED|lease is expired/,
  );
});

test("expired lease-bound inference callback is rejected", async () => {
  const service = new MemoryCaseService();
  const created = await service.createCase({
    patientAlias: "lease-expired-callback",
    studyUid: "1.2.3.lease.expired.callback",
    sequenceInventory: ["T1w", "FLAIR"],
  });

  const claimed = await service.claimNextDispatch({
    workerId: "worker-expired-callback",
    stage: "inference",
    leaseSeconds: 1,
  });

  await waitUntilAfter(claimed?.claimExpiresAt as string);

  await assert.rejects(
    async () => {
      await service.completeInference(created.caseId, {
        leaseId: claimed?.leaseId as string,
        workerId: "worker-expired-callback",
        qcDisposition: "pass",
        findings: ["No acute finding."],
        measurements: [{ label: "brain_volume_ml", value: 1118 }],
        artifacts: ["artifact://report-preview"],
      });
    },
    /DISPATCH_LEASE_EXPIRED|lease is expired/,
  );
});

test("delivery dispatch claims expose report and structural artifact context", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const service = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await service.createCase({
      patientAlias: "dispatch-delivery",
      studyUid: "1.2.3.dispatch.delivery",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await service.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["No acute finding."],
      measurements: [{ label: "brain_volume_ml", value: 1115 }],
      artifacts: ["artifact://overlay-preview", "artifact://report-preview"],
      generatedSummary: "Dispatch delivery contract test.",
    });
    await service.reviewCase(created.caseId, {
      reviewerId: "clinician-dispatch",
    });
    await service.finalizeCase(created.caseId, {
      clinicianId: "clinician-dispatch",
    });

    const claimed = await service.claimNextDispatch({
      workerId: "worker-delivery-a",
      stage: "delivery",
      leaseSeconds: 120,
    });

    assert.equal(claimed?.caseId, created.caseId);
    assert.equal(claimed?.stage, "delivery");
    assert.equal(claimed?.report?.reviewStatus, "finalized");
    assert.equal(claimed?.report?.versionPins.finalizedReleaseVersion, 1);
    assert.equal(Array.isArray(claimed?.artifactManifest), true);
    assert.equal(claimed?.artifactManifest.length, 2);
    assert.equal(claimed?.structuralRun?.packageId, "brain-structural-fastsurfer");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("study context, qc artifact, and findings payload survive service restart", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const expectedArtifactUris = [
    pathToFileURL(resolve(".mri-data/artifacts/qc-summary")).href,
    pathToFileURL(resolve(".mri-data/artifacts/overlay-preview")).href,
  ];

  try {
    const first = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await first.createCase({
      patientAlias: "persisted-worker-artifacts",
      studyUid: "1.2.3.persisted.worker.artifacts",
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "memory complaints",
    });

    await first.completeInference(created.caseId, {
      qcDisposition: "warn",
      findings: ["Mild chronic microvascular change."],
      measurements: [{ label: "hippocampal_z_score", value: -1.2 }],
      artifacts: ["artifact://qc-summary", "artifact://overlay-preview"],
      issues: ["Minor motion artifact."],
      generatedSummary: "Worker artifacts persistence verification.",
    });

    const second = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const reloaded = await second.getCase(created.caseId);

    assert.equal(reloaded.workerArtifacts.studyContext.studyUid, created.studyUid);
    assert.deepEqual(reloaded.workerArtifacts.studyContext.sequenceInventory, ["T1w", "FLAIR"]);
    assert.equal(reloaded.workerArtifacts.studyContext.workflowFamily, "brain-structural");
    assert.equal(reloaded.workerArtifacts.workflowPackage?.packageId, "brain-structural-fastsurfer");
    assert.equal(reloaded.workerArtifacts.workflowPackage?.packageVersion, "0.1.0");
    assert.equal(reloaded.workerArtifacts.workflowPackage?.computeProfile, "light-gpu");
    assert.equal(reloaded.workerArtifacts.qcSummary?.disposition, "warn");
    assert.deepEqual(
      reloaded.workerArtifacts.qcSummary?.artifactRefs.map((artifact) => artifact.uri),
      expectedArtifactUris,
    );
    assert.equal(reloaded.workerArtifacts.findingsPayload?.summary, "Worker artifacts persistence verification.");
    assert.deepEqual(reloaded.workerArtifacts.findingsPayload?.findings, ["Mild chronic microvascular change."]);
    assert.deepEqual(reloaded.workerArtifacts.findingsPayload?.measurements, [{ label: "hippocampal_z_score", value: -1.2 }]);
    assert.equal(reloaded.workerArtifacts.structuralExecution?.packageId, "brain-structural-fastsurfer");
    assert.equal(reloaded.workerArtifacts.structuralExecution?.packageVersion, "0.1.0");
    assert.equal(reloaded.workerArtifacts.structuralExecution?.status, "succeeded");
    assert.equal(reloaded.workerArtifacts.structuralExecution?.branchId, "structural");
    assert.equal(reloaded.workerArtifacts.structuralExecution?.resourceClass, "light-gpu");
    assert.deepEqual(reloaded.workerArtifacts.structuralExecution?.artifactIds, [
      "artifact-1",
      "artifact-2",
    ]);
    assert.equal(reloaded.workerArtifacts.artifactManifest.length, 2);
    assert.deepEqual(
      reloaded.workerArtifacts.artifactManifest.map((artifact) => artifact.artifactId),
      ["artifact-1", "artifact-2"],
    );
    assert.deepEqual(
      reloaded.workerArtifacts.artifactManifest.map((artifact) => artifact.artifactType),
      ["qc-summary", "overlay-preview"],
    );
    assert.equal(
      reloaded.workerArtifacts.artifactManifest.every(
        (artifact) => artifact.producedByPackageId === "brain-structural-fastsurfer" && artifact.workflowFamily === "brain-structural",
      ),
      true,
    );
    assert.equal(reloaded.workerArtifacts.structuralRun?.packageId, "brain-structural-fastsurfer");
    assert.equal(reloaded.workerArtifacts.structuralRun?.packageVersion, "0.1.0");
    assert.equal(reloaded.workerArtifacts.structuralRun?.status, "succeeded");
    assert.equal(
      reloaded.workerArtifacts.structuralRun?.artifacts.some((artifact) => artifact.artifactType === "qc-summary"),
      true,
    );
    assert.equal(
      reloaded.workerArtifacts.structuralRun?.artifacts.some((artifact) => artifact.artifactType === "overlay-preview"),
      true,
    );
    assert.equal(reloaded.report?.provenance.workflowVersion, "brain-structural-fastsurfer@0.1.0");
    assert.equal(reloaded.evidenceCards.some((card) => card.cardType === "branch-execution"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("corrupt snapshot content fails fast during service startup", () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    writeFileSync(caseStoreFile, '{"version":"0.1.0","revision":"bad"}', "utf8");

    assert.throws(
      () => {
        new MemoryCaseService({ snapshotFilePath: caseStoreFile });
      },
      /Invalid case snapshot format/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createCase is idempotent for the same study and rejects conflicting duplicates", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const service = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const first = await service.createCase({
      patientAlias: "idempotent-case",
      studyUid: "1.2.3.same-study",
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "headache",
    });

    const replay = await service.createCase({
      patientAlias: "idempotent-case",
      studyUid: "1.2.3.same-study",
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "headache",
    });

    assert.equal(replay.caseId, first.caseId);
    assert.equal((await service.listCases()).length, 1);

    await assert.rejects(
      async () => {
        await service.createCase({
          patientAlias: "different-patient",
          studyUid: "1.2.3.same-study",
          sequenceInventory: ["T1w", "FLAIR"],
          indication: "headache",
        });
      },
      /already exists with conflicting payload/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("blocked planning path does not require artifacts that cannot be produced", () => {
  const plan = createPlanEnvelope({
    caseId: "blocked-case",
    studyUid: "1.2.3.blocked",
    indication: null,
    sequenceInventory: ["FLAIR"],
    source: "internal-ingest",
    isEligible: false,
  });

  assert.equal(plan.packageResolution.selectedPackage, null);
  assert.deepEqual(plan.requiredArtifacts, []);
  assert.equal(plan.branches.every((branch) => branch.status === "blocked"), true);
});

test("existing case mutations roll back when snapshot save fails on a stale writer", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const seed = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await seed.createCase({
      patientAlias: "rollback-existing",
      studyUid: "1.2.3.rollback.existing",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const writerA = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const writerB = new MemoryCaseService({ snapshotFilePath: caseStoreFile });

    await writerA.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["No acute finding."],
      measurements: [{ label: "brain_volume_ml", value: 1110 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Writer A accepted the inference callback.",
    });

    await assert.rejects(
      async () => {
        await writerB.completeInference(created.caseId, {
          qcDisposition: "pass",
          findings: ["Competing stale result."],
          measurements: [{ label: "brain_volume_ml", value: 999 }],
          artifacts: ["artifact://stale"],
          generatedSummary: "Writer B should roll back this stale mutation.",
        });
      },
      /Concurrent case store modification detected/,
    );

    const staleView = await writerB.getCase(created.caseId);
    assert.equal(staleView.status, "SUBMITTED");
    assert.equal(staleView.report, null);
    assert.equal(staleView.lastInferenceFingerprint, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persisted submitted case without active inference queue is rejected as invariant drift", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const seed = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await seed.createCase({
      patientAlias: "drift-submitted",
      studyUid: "1.2.3.drift.submitted",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const snapshot = JSON.parse(readFileSync(caseStoreFile, "utf8")) as {
      version: string;
      revision: number;
      cases: Array<Record<string, unknown>>;
      workflowJobs?: Array<Record<string, unknown>>;
    };
    snapshot.cases[0].workflowQueue = [];
    if (Array.isArray(snapshot.workflowJobs) && snapshot.workflowJobs[0]) {
      snapshot.workflowJobs[0].jobs = [];
    }
    writeFileSync(caseStoreFile, JSON.stringify(snapshot), "utf8");

    const reloaded = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    await assert.rejects(
      async () => {
        await reloaded.getCase(created.caseId);
      },
      /Invariant violation/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persisted delivery-pending case without delivery queue is rejected as invariant drift", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const seed = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await seed.createCase({
      patientAlias: "drift-delivery",
      studyUid: "1.2.3.drift.delivery",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await seed.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["No acute finding."],
      measurements: [{ label: "brain_volume_ml", value: 1105 }],
      artifacts: ["artifact://report-preview"],
      generatedSummary: "Invariant drift setup.",
    });
    await seed.reviewCase(created.caseId, {
      reviewerId: "clinician-drift",
    });
    await seed.finalizeCase(created.caseId, {
      clinicianId: "clinician-drift",
    });

    const snapshot = JSON.parse(readFileSync(caseStoreFile, "utf8")) as {
      version: string;
      revision: number;
      cases: Array<Record<string, unknown>>;
      workflowJobs?: Array<Record<string, unknown>>;
    };
    snapshot.cases[0].workflowQueue = [];
    if (Array.isArray(snapshot.workflowJobs) && snapshot.workflowJobs[0]) {
      snapshot.workflowJobs[0].jobs = [];
    }
    writeFileSync(caseStoreFile, JSON.stringify(snapshot), "utf8");

    const reloaded = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    await assert.rejects(
      async () => {
        await reloaded.getOperationsSummary();
      },
      /Invariant violation/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("post-finalize inference rerun cannot replace a pinned release version", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const service = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = await service.createCase({
      patientAlias: "pinned-release",
      studyUid: "1.2.3.pinned.release",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await service.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["No acute finding."],
      measurements: [{ label: "brain_volume_ml", value: 1116 }],
      artifacts: ["artifact://report-preview"],
      generatedSummary: "Initial draft version.",
    });
    await service.reviewCase(created.caseId, {
      reviewerId: "clinician-pin",
      comments: "Pinned reviewed release.",
    });
    await service.finalizeCase(created.caseId, {
      clinicianId: "clinician-pin",
      finalSummary: "Pinned finalized release.",
    });

    await assert.rejects(
      async () => {
        await service.completeInference(created.caseId, {
          qcDisposition: "warn",
          findings: ["Conflicting later machine rerun."],
          measurements: [{ label: "brain_volume_ml", value: 999 }],
          artifacts: ["artifact://conflict"],
          generatedSummary: "Should not replace finalized release.",
        });
      },
      /Finalized release is pinned/,
    );

    const reloaded = await service.getCase(created.caseId);
    assert.equal(reloaded.report?.processingSummary, "Pinned finalized release.");
    assert.deepEqual(reloaded.report?.versionPins, {
      machineDraftVersion: 1,
      reviewedReleaseVersion: 1,
      finalizedReleaseVersion: 1,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});