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

test("stale snapshot revision rejects concurrent writers", () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const writerA = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const writerB = new MemoryCaseService({ snapshotFilePath: caseStoreFile });

    writerA.createCase({
      patientAlias: "concurrency-a",
      studyUid: "1.2.3.concurrent.a",
      sequenceInventory: ["T1w"],
    });

    assert.throws(
      () => {
        writerB.createCase({
          patientAlias: "concurrency-b",
          studyUid: "1.2.3.concurrent.b",
          sequenceInventory: ["T1w"],
        });
      },
      /Concurrent case store modification detected/,
    );

    assert.equal(writerB.listCases().length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("operation transcript and retry history survive service restart", () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const first = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = first.createCase({
      patientAlias: "persisted-ops",
      studyUid: "1.2.3.persisted.ops",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const inferred = first.completeInference(created.caseId, {
      qcDisposition: "warn",
      findings: ["Stable chronic change."],
      measurements: [{ label: "brain_volume_ml", value: 1098 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Draft created for persistence verification.",
    });
    const reviewed = first.reviewCase(inferred.caseId, {
      reviewerId: "clinician-persist",
      comments: "Manual review completed.",
    });
    const finalized = first.finalizeCase(reviewed.caseId, {
      deliveryOutcome: "failed",
    });
    first.retryDelivery(finalized.caseId);

    const second = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const reloaded = second.getCase(created.caseId);
    const summary = second.getOperationsSummary();

    assert.equal(reloaded.status, "DELIVERY_PENDING");
    assert.equal(reloaded.operationLog.some((entry) => entry.operationType === "case-created"), true);
    assert.equal(reloaded.operationLog.some((entry) => entry.operationType === "delivery-retry-requested"), true);
    assert.equal(summary.retryHistory.length, 1);
    assert.equal(summary.retryHistory[0].caseId, created.caseId);
    assert.equal(summary.recentOperations.some((entry) => entry.caseId === created.caseId && entry.operationType === "delivery-retry-requested"), true);
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

test("createCase is idempotent for the same study and rejects conflicting duplicates", () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const service = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const first = service.createCase({
      patientAlias: "idempotent-case",
      studyUid: "1.2.3.same-study",
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "headache",
    });

    const replay = service.createCase({
      patientAlias: "idempotent-case",
      studyUid: "1.2.3.same-study",
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "headache",
    });

    assert.equal(replay.caseId, first.caseId);
    assert.equal(service.listCases().length, 1);

    assert.throws(
      () => {
        service.createCase({
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

test("existing case mutations roll back when snapshot save fails on a stale writer", () => {
  const { tempDir, caseStoreFile } = createStorePath();

  try {
    const seed = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const created = seed.createCase({
      patientAlias: "rollback-existing",
      studyUid: "1.2.3.rollback.existing",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    const writerA = new MemoryCaseService({ snapshotFilePath: caseStoreFile });
    const writerB = new MemoryCaseService({ snapshotFilePath: caseStoreFile });

    writerA.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["No acute finding."],
      measurements: [{ label: "brain_volume_ml", value: 1110 }],
      artifacts: ["artifact://qc", "artifact://report"],
      generatedSummary: "Writer A accepted the inference callback.",
    });

    assert.throws(
      () => {
        writerB.completeInference(created.caseId, {
          qcDisposition: "pass",
          findings: ["Competing stale result."],
          measurements: [{ label: "brain_volume_ml", value: 999 }],
          artifacts: ["artifact://stale"],
          generatedSummary: "Writer B should roll back this stale mutation.",
        });
      },
      /Concurrent case store modification detected/,
    );

    const staleView = writerB.getCase(created.caseId);
    assert.equal(staleView.status, "SUBMITTED");
    assert.equal(staleView.report, null);
    assert.equal(staleView.lastInferenceFingerprint, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});