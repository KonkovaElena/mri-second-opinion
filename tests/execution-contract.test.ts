import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { presentInferenceExecutionContract } from "../src/case-presentation";
import { MemoryCaseService } from "../src/cases";

function createStorePath() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-execution-contract-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.sqlite"),
  };
}

test("worker-facing execution contract stays aligned with persisted case truth", async () => {
  const { tempDir, caseStoreFile } = createStorePath();
  const service = new MemoryCaseService({
    snapshotFilePath: caseStoreFile,
    storageMode: "snapshot",
  });

  try {
    const created = await service.createCase({
      patientAlias: "worker-contract-case",
      studyUid: "1.2.840.113619.execution.contract",
      indication: "Follow-up structural review",
      sequenceInventory: ["T1w", "FLAIR"],
      studyContext: {
        studyInstanceUid: "2.25.execution.contract",
        sourceArchive: "orthanc-demo",
        dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.execution.contract",
        series: [
          {
            seriesInstanceUid: "2.25.execution.contract.1",
            sequenceLabel: "T1w",
            instanceCount: 176,
            volumeDownloadUrl: "https://fixtures.example.test/t1w-volume.nii",
          },
          {
            seriesInstanceUid: "2.25.execution.contract.2",
            sequenceLabel: "FLAIR",
            instanceCount: 164,
          },
        ],
      },
    });

    const claimed = await service.claimNextInferenceJob("worker-contract-test");
    assert.notEqual(claimed, null);

    const reloaded = await service.getCase(created.caseId);
    const contract = presentInferenceExecutionContract({
      caseRecord: reloaded,
      inferenceJob: claimed,
    });

    assert.deepEqual(contract.claim, {
      jobId: claimed.jobId,
      caseId: created.caseId,
      workerId: "worker-contract-test",
      claimedAt: claimed.claimedAt,
      attemptCount: 1,
      status: "claimed",
    });
    assert.equal(contract.workflowFamily, "brain-structural");
    assert.equal(contract.selectedPackage, reloaded.planEnvelope.packageResolution.selectedPackage);
    assert.equal(contract.packageManifest?.packageId, contract.selectedPackage);
    assert.deepEqual(contract.packageManifest?.requiredSequences, ["T1w"]);

    assert.deepEqual(contract.caseContext, {
      studyUid: created.studyUid,
      indication: "Follow-up structural review",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    assert.equal(contract.studyContext.studyInstanceUid, "2.25.execution.contract");
    assert.equal(contract.studyContext.sourceArchive, "orthanc-demo");
    assert.equal(
      contract.studyContext.dicomWebBaseUrl,
      "https://dicom.example.test/studies/2.25.execution.contract",
    );
    assert.equal(contract.studyContext.series.length, 2);
    assert.equal(contract.studyContext.series[0]?.sequenceLabel, "T1w");
    assert.equal(
      contract.studyContext.series[0]?.volumeDownloadUrl,
      "https://fixtures.example.test/t1w-volume.nii",
    );
    assert.equal(contract.studyContext.series[1]?.instanceCount, 164);

    assert.deepEqual(contract.requiredArtifacts, reloaded.planEnvelope.requiredArtifacts);
    assert.deepEqual(
      contract.persistenceTargets.map((target) => target.artifactType),
      reloaded.planEnvelope.requiredArtifacts,
    );
    assert.deepEqual(
      contract.persistenceTargets.map((target) => target.label),
      ["QC summary", "Metrics payload", "Viewer overlay preview", "Report preview"],
    );
    assert.equal(
      contract.persistenceTargets.every((target) => target.plannedStorageUri.startsWith("object-store://case-artifacts/")),
      true,
    );
    assert.equal(contract.dispatchProfile.resourceClass, reloaded.planEnvelope.dispatchProfile.resourceClass);
    assert.equal(contract.dispatchProfile.retryTier, reloaded.planEnvelope.dispatchProfile.retryTier);
  } finally {
    await service.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});