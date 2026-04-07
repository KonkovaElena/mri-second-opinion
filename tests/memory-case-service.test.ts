import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { MemoryCaseService } from "../src/cases";
import { createPlanEnvelope } from "../src/case-planning";

function createStorePath() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-case-service-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.sqlite"),
  };
}

test("stale snapshot revision rejects concurrent writers", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const writerA = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const writerB = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    services.push(writerA, writerB);

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
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("operation transcript and retry history survive service restart", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const first = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    services.push(first);
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
      deliveryOutcome: "failed",
    });
    await first.retryDelivery(finalized.caseId);

    const second = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    services.push(second);
    const reloaded = await second.getCase(created.caseId);
    const summary = await second.getOperationsSummary();

    assert.equal(reloaded.status, "DELIVERY_PENDING");
    assert.equal(reloaded.operationLog.some((entry) => entry.operationType === "case-created"), true);
    assert.equal(reloaded.operationLog.some((entry) => entry.operationType === "delivery-retry-requested"), true);
    assert.equal(summary.retryHistory.length, 1);
    assert.equal(summary.retryHistory[0].caseId, created.caseId);
    assert.equal(summary.recentOperations.some((entry) => entry.caseId === created.caseId && entry.operationType === "delivery-retry-requested"), true);
  } finally {
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("delivery queue survives snapshot-mode restart and can be claimed", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const first = new MemoryCaseService({
      snapshotFilePath: caseStoreFile,
      storageMode: "snapshot",
    });
    services.push(first);

    const created = await first.createCase({
      patientAlias: "snapshot-queue",
      studyUid: "1.2.3.snapshot.queue",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await first.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["Queue restart verification."],
      measurements: [{ label: "brain_volume_ml", value: 1095 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Snapshot queue draft.",
    });
    await first.reviewCase(created.caseId, {
      reviewerId: "snapshot-reviewer",
      comments: "Snapshot queue reviewed.",
    });
    await first.finalizeCase(created.caseId);

    const second = new MemoryCaseService({
      snapshotFilePath: caseStoreFile,
      storageMode: "snapshot",
    });
    services.push(second);

    const jobs = await second.listDeliveryJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].caseId, created.caseId);
    assert.equal(jobs[0].status, "queued");

    const claimed = await second.claimNextDeliveryJob("snapshot-worker");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.caseId, created.caseId);
    assert.equal(claimed?.status, "claimed");
    assert.equal(claimed?.attemptCount, 1);
  } finally {
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inference queue survives snapshot-mode restart and can be claimed", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const first = new MemoryCaseService({
      snapshotFilePath: caseStoreFile,
      storageMode: "snapshot",
    });
    services.push(first);

    const created = await first.createCase({
      patientAlias: "snapshot-inference-queue",
      studyUid: "1.2.3.snapshot.inference.queue",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const second = new MemoryCaseService({
      snapshotFilePath: caseStoreFile,
      storageMode: "snapshot",
    });
    services.push(second);

    const jobs = await second.listInferenceJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].caseId, created.caseId);
    assert.equal(jobs[0].status, "queued");

    const claimed = await second.claimNextInferenceJob("snapshot-inference-worker");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.caseId, created.caseId);
    assert.equal(claimed?.status, "claimed");
    assert.equal(claimed?.attemptCount, 1);
  } finally {
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("structural execution contract and artifact provenance survive snapshot restart", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const first = new MemoryCaseService({
      snapshotFilePath: caseStoreFile,
      storageMode: "snapshot",
    });
    services.push(first);

    const created = await first.createCase({
      patientAlias: "snapshot-execution-contract",
      studyUid: "1.2.3.snapshot.execution.contract",
      sequenceInventory: ["T1w", "FLAIR"],
      studyContext: {
        studyInstanceUid: "2.25.snapshot.execution.contract",
        sourceArchive: "orthanc-demo",
        dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.snapshot.execution.contract",
        series: [
          {
            seriesInstanceUid: "2.25.snapshot.execution.contract.1",
            sequenceLabel: "T1w",
          },
        ],
      },
    });

    const claimed = await first.claimNextInferenceJob("snapshot-contract-worker");
    assert.notEqual(claimed, null);

    await first.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["Execution contract persistence verification."],
      measurements: [{ label: "brain_volume_ml", value: 1112 }],
      artifacts: ["artifact://overlay-preview", "artifact://qc-summary"],
      generatedSummary: "Execution contract draft.",
    });

    const second = new MemoryCaseService({
      snapshotFilePath: caseStoreFile,
      storageMode: "snapshot",
    });
    services.push(second);

    const reloaded = await second.getCase(created.caseId);

    assert.notEqual(reloaded.structuralExecution, null);
    assert.equal(reloaded.structuralExecution?.packageId, "brain-structural-fastsurfer");
    assert.equal(reloaded.structuralExecution?.packageVersion, "0.1.0");
    assert.equal(reloaded.structuralExecution?.manifestSchemaVersion, "0.1.0");
    assert.equal(reloaded.structuralExecution?.executionStatus, "completed");
    assert.equal(reloaded.structuralExecution?.resourceClass, "light-gpu");
    assert.equal(reloaded.structuralExecution?.callbackSource, "internal-inference");
    assert.equal(reloaded.structuralExecution?.dispatchedAt, claimed?.claimedAt ?? null);
    assert.equal(reloaded.structuralExecution?.artifactIds.length, 2);
    assert.deepEqual(
      reloaded.structuralExecution?.artifactIds,
      reloaded.artifactManifest.map((artifact) => artifact.artifactId),
    );

    assert.equal(reloaded.artifactManifest.length, 2);
    assert.equal(reloaded.artifactManifest[0].producingPackageId, "brain-structural-fastsurfer");
    assert.equal(reloaded.artifactManifest[0].producingPackageVersion, "0.1.0");
    assert.equal(reloaded.artifactManifest[0].workflowFamily, "brain-structural");
    assert.deepEqual(reloaded.artifactManifest[0].exportCompatibilityTags, ["internal-json", "rendered-report"]);
    assert.equal(reloaded.report?.provenance.workflowVersion, "brain-structural-fastsurfer@0.1.0");
  } finally {
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("expired claimed inference jobs are requeued in snapshot mode", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const first = new MemoryCaseService({
      snapshotFilePath: caseStoreFile,
      storageMode: "snapshot",
    });
    services.push(first);

    const created = await first.createCase({
      patientAlias: "snapshot-inference-requeue",
      studyUid: "1.2.3.snapshot.inference.requeue",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const claimed = await first.claimNextInferenceJob("stale-inference-worker");
    assert.notEqual(claimed, null);

    const requeued = await first.requeueExpiredInferenceJobs(0);
    assert.equal(requeued.length, 1);
    assert.equal(requeued[0].caseId, created.caseId);
    assert.equal(requeued[0].status, "queued");
    assert.equal(requeued[0].workerId, null);
    assert.equal(requeued[0].claimedAt, null);
    assert.match(requeued[0].lastError ?? "", /claim expired/i);

    const second = new MemoryCaseService({
      snapshotFilePath: caseStoreFile,
      storageMode: "snapshot",
    });
    services.push(second);

    const jobs = await second.listInferenceJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "queued");
    assert.equal(jobs[0].workerId, null);

    const reclaimed = await second.claimNextInferenceJob("fresh-inference-worker");
    assert.notEqual(reclaimed, null);
    assert.equal(reclaimed?.status, "claimed");
    assert.equal(reclaimed?.workerId, "fresh-inference-worker");
    assert.equal(reclaimed?.attemptCount, 2);
  } finally {
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("active claimed inference leases are not requeued by claim age alone", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const service = new MemoryCaseService({
      snapshotFilePath: caseStoreFile,
      storageMode: "snapshot",
    });
    services.push(service);

    await service.createCase({
      patientAlias: "snapshot-inference-active-lease",
      studyUid: "1.2.3.snapshot.inference.active.lease",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const claimed = await service.claimNextInferenceJob("active-lease-worker");
    assert.notEqual(claimed, null);
    assert.equal(claimed?.status, "claimed");
    assert.equal(typeof claimed?.leaseExpiresAt, "string");

    await new Promise((resolve) => setTimeout(resolve, 10));

    const requeued = await service.requeueExpiredInferenceJobs(1);
    assert.equal(requeued.length, 0);

    const jobs = await service.listInferenceJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].jobId, claimed?.jobId);
    assert.equal(jobs[0].status, "claimed");
    assert.equal(jobs[0].workerId, "active-lease-worker");
  } finally {
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("stale sqlite delivery claim reloads instead of surfacing a store conflict", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const seed = new MemoryCaseService({
      caseStoreFilePath: caseStoreFile,
      storageMode: "sqlite",
    });
    services.push(seed);

    const created = await seed.createCase({
      patientAlias: "sqlite-queue-concurrency",
      studyUid: "1.2.3.sqlite.queue.concurrency",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await seed.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["Queue concurrency verification."],
      measurements: [{ label: "brain_volume_ml", value: 1104 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "SQLite queue concurrency draft.",
    });
    await seed.reviewCase(created.caseId, {
      reviewerId: "sqlite-reviewer",
      comments: "SQLite queue concurrency reviewed.",
    });
    await seed.finalizeCase(created.caseId);

    const workerA = new MemoryCaseService({
      caseStoreFilePath: caseStoreFile,
      storageMode: "sqlite",
    });
    const workerB = new MemoryCaseService({
      caseStoreFilePath: caseStoreFile,
      storageMode: "sqlite",
    });
    services.push(workerA, workerB);

    const firstClaim = await workerA.claimNextDeliveryJob("worker-a");
    assert.notEqual(firstClaim, null);
    assert.equal(firstClaim?.caseId, created.caseId);
    assert.equal(firstClaim?.status, "claimed");

    const secondClaim = await workerB.claimNextDeliveryJob("worker-b");
    assert.equal(secondClaim, null);

    const refreshedJobs = await workerB.listDeliveryJobs();
    assert.equal(refreshedJobs.length, 1);
    assert.equal(refreshedJobs[0].status, "claimed");
    assert.equal(refreshedJobs[0].workerId, "worker-a");
  } finally {
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("delivery claim skips queued sqlite jobs until availableAt is reached", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const seed = new MemoryCaseService({
      caseStoreFilePath: caseStoreFile,
      storageMode: "sqlite",
    });
    services.push(seed);

    const created = await seed.createCase({
      patientAlias: "sqlite-queue-scheduled",
      studyUid: "1.2.3.sqlite.queue.scheduled",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await seed.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["Scheduled queue verification."],
      measurements: [{ label: "brain_volume_ml", value: 1106 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "SQLite queue scheduling draft.",
    });
    await seed.reviewCase(created.caseId, {
      reviewerId: "sqlite-scheduler",
      comments: "SQLite queue scheduling reviewed.",
    });
    await seed.finalizeCase(created.caseId);
    await seed.close();
    services.length = 0;

    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    const database = new DatabaseSync(caseStoreFile);
    try {
      database.prepare("UPDATE delivery_jobs SET available_at = ?, updated_at = ? WHERE case_id = ?").run(
        scheduledAt,
        scheduledAt,
        created.caseId,
      );
    } finally {
      database.close();
    }

    const worker = new MemoryCaseService({
      caseStoreFilePath: caseStoreFile,
      storageMode: "sqlite",
    });
    services.push(worker);

    const claim = await worker.claimNextDeliveryJob("scheduled-worker");
    assert.equal(claim, null);

    const jobs = await worker.listDeliveryJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "queued");
    assert.equal(jobs[0].availableAt, scheduledAt);
  } finally {
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("corrupt legacy snapshot content fails fast during service startup", () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    writeFileSync(caseStoreFile, '{"version":"0.1.0","revision":"bad"}', "utf8");

    assert.throws(
      () => {
        new MemoryCaseService({
          snapshotFilePath: caseStoreFile,
          storageMode: "snapshot",
        });
      },
      /Invalid case snapshot format/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createCase is idempotent for the same study and rejects conflicting duplicates", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const service = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    services.push(service);
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
    for (const service of services) {
      await service.close();
    }
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
  const services: MemoryCaseService[] = [];

  try {
    const seed = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    services.push(seed);
    const created = await seed.createCase({
      patientAlias: "rollback-existing",
      studyUid: "1.2.3.rollback.existing",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const writerA = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const writerB = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    services.push(writerA, writerB);

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
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("legacy sqlite report payloads backfill derivedArtifacts on restart", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const services: MemoryCaseService[] = [];

  try {
    const first = new MemoryCaseService({
      caseStoreFilePath: caseStoreFile,
      storageMode: "sqlite",
    });
    services.push(first);

    const created = await first.createCase({
      patientAlias: "legacy-report-shape",
      studyUid: "1.2.3.legacy.sqlite",
      sequenceInventory: ["T1w", "FLAIR"],
      studyContext: {
        studyInstanceUid: "2.25.legacy.sqlite",
        sourceArchive: "orthanc-demo",
        dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.legacy.sqlite",
        series: [
          {
            seriesInstanceUid: "2.25.legacy.sqlite.1",
            sequenceLabel: "T1w",
          },
        ],
      },
    });

    await first.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["Legacy payload compatibility check."],
      measurements: [{ label: "brain_volume_ml", value: 1102 }],
      artifacts: ["artifact://overlay-preview", "artifact://qc-summary"],
      generatedSummary: "Legacy payload compatibility draft.",
    });
    await first.close();
    services.length = 0;

    const database = new DatabaseSync(caseStoreFile);
    try {
      const row = database
        .prepare("SELECT payload_json FROM case_records WHERE case_id = ?")
        .get(created.caseId) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as {
        report: Record<string, unknown>;
        structuralExecution?: Record<string, unknown>;
      };
      delete payload.report.derivedArtifacts;
      delete payload.structuralExecution;
      database
        .prepare("UPDATE case_records SET payload_json = ? WHERE case_id = ?")
        .run(JSON.stringify(payload), created.caseId);
    } finally {
      database.close();
    }

    const second = new MemoryCaseService({
      caseStoreFilePath: caseStoreFile,
      storageMode: "sqlite",
    });
    services.push(second);

    const report = await second.getReport(created.caseId);
    const reloaded = await second.getCase(created.caseId);
    assert.equal(report.derivedArtifacts.length, 2);
    assert.equal(report.derivedArtifacts[0].artifactType, "overlay-preview");
    assert.equal(report.derivedArtifacts[0].viewerReady, true);
    assert.notEqual(reloaded.structuralExecution, null);
    assert.equal(reloaded.structuralExecution?.packageId, "brain-structural-fastsurfer");
    assert.equal(reloaded.structuralExecution?.executionStatus, "completed");
  } finally {
    for (const service of services) {
      await service.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});