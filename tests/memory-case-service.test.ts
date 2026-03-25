import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryCaseService } from "../src/cases";
import { createPlanEnvelope } from "../src/case-planning";

function createStorePath() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-case-service-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.json"),
  };
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
      deliveryOutcome: "failed",
    });
    await first.retryDelivery(finalized.caseId);

    const second = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const reloaded = await second.getCase(created.caseId);
    const summary = await second.getOperationsSummary();

    assert.equal(reloaded.status, "DELIVERY_PENDING");
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
    await first.finalizeCase(deliveryPending.caseId);

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

test("study context, qc artifact, and findings payload survive service restart", async () => {
  const { tempDir, caseStoreFile } = createStorePath();

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
    assert.equal(reloaded.workerArtifacts.qcSummary?.disposition, "warn");
    assert.deepEqual(reloaded.workerArtifacts.qcSummary?.artifactRefs, ["artifact://qc-summary", "artifact://overlay-preview"]);
    assert.equal(reloaded.workerArtifacts.findingsPayload?.summary, "Worker artifacts persistence verification.");
    assert.deepEqual(reloaded.workerArtifacts.findingsPayload?.findings, ["Mild chronic microvascular change."]);
    assert.deepEqual(reloaded.workerArtifacts.findingsPayload?.measurements, [{ label: "hippocampal_z_score", value: -1.2 }]);
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