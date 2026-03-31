import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeArtifactReference,
  createDerivedArtifactDescriptors,
  createPlannedArtifactPersistenceTargets,
} from "../src/case-artifacts";

const studyContext = {
  studyInstanceUid: "2.25.case-artifacts.1",
  dicomStudyInstanceUid: "2.25.case-artifacts.1",
  accessionNumber: "ACC-CASE-ARTIFACTS-001",
  studyDate: "2026-03-28",
  sourceArchive: "orthanc-demo",
  dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.case-artifacts.1",
  metadataSummary: [],
  series: [
    {
      seriesInstanceUid: "2.25.case-artifacts.1.1",
      seriesDescription: "Sag T1 MPRAGE",
      modality: "MR",
      sequenceLabel: "T1w",
      instanceCount: 176,
    },
  ],
  receivedAt: "2026-03-28T12:00:00.000Z",
  source: "public-api" as const,
};

test("canonicalizeArtifactReference preserves logical artifact URIs", () => {
  assert.equal(canonicalizeArtifactReference("artifact://overlay-preview"), "artifact://overlay-preview");
  assert.equal(canonicalizeArtifactReference("object-store://case-artifacts/case-1/qc-summary.json"), "object-store://case-artifacts/case-1/qc-summary.json");
});

test("canonicalizeArtifactReference converts Windows absolute paths into canonical file URLs", () => {
  assert.equal(
    canonicalizeArtifactReference("C:\\worker\\cases\\case-1\\overlay-preview.png"),
    "file:///C:/worker/cases/case-1/overlay-preview.png",
  );
});

test("canonicalizeArtifactReference converts POSIX absolute paths into canonical file URLs", () => {
  assert.equal(
    canonicalizeArtifactReference("/var/tmp/mri/case-1/qc-summary.json"),
    "file:///var/tmp/mri/case-1/qc-summary.json",
  );
});

test("derived artifact descriptors persist canonical file URLs instead of host literals", () => {
  const descriptors = createDerivedArtifactDescriptors({
    caseId: "case-artifacts-1",
    studyUid: "2.25.case-artifacts.1",
    artifactRefs: ["C:\\worker\\cases\\case-1\\overlay-preview.png"],
    studyContext,
    generatedAt: "2026-03-28T12:00:00.000Z",
  });

  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].artifactType, "overlay-preview");
  assert.equal(descriptors[0].storageUri, "file:///C:/worker/cases/case-1/overlay-preview.png");
});

test("planned persistence targets stay on canonical object-store URIs", () => {
  const targets = createPlannedArtifactPersistenceTargets({
    caseId: "case-artifacts-1",
    artifactTypes: ["qc-summary", "overlay-preview"],
  });

  assert.equal(targets.length, 2);
  assert.equal(targets[0].plannedStorageUri, "object-store://case-artifacts/case-artifacts-1/qc-summary.json");
  assert.equal(targets[1].plannedStorageUri, "object-store://case-artifacts/case-artifacts-1/overlay-preview.png");
});

test("object-store artifact descriptors expose stable API retrieval URLs", () => {
  const descriptors = createDerivedArtifactDescriptors({
    caseId: "case-artifacts-1",
    studyUid: "2.25.case-artifacts.1",
    artifactRefs: ["object-store://case-artifacts/case-artifacts-1/qc-summary.json"],
    studyContext,
    generatedAt: "2026-03-31T12:00:00.000Z",
  });

  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].storageUri, "object-store://case-artifacts/case-artifacts-1/qc-summary.json");
  assert.equal(descriptors[0].retrievalUrl, "/api/cases/case-artifacts-1/artifacts/case-artifacts-1-artifact-1");
});