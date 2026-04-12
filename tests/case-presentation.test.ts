import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CaseRecord, DeliveryJobRecord, InferenceJobRecord, ReportPayload } from "../src/case-contracts";
import { createDefaultStructuralExecutionContext, createPlanEnvelope, createStructuralExecutionEnvelope } from "../src/case-planning";
import {
  presentCaseDetail,
  presentCaseListItem,
  presentDeliveryJob,
  presentInferenceExecutionContract,
  presentInferenceJob,
  presentReport,
} from "../src/case-presentation";
import { createPendingQcSummary, createStudyContextRecord } from "../src/case-imaging";
import type { DerivedArtifactDescriptor } from "../src/case-artifacts";

function buildStudyContext() {
  return createStudyContextRecord({
    fallbackStudyUid: "study-1",
    receivedAt: "2026-04-12T10:00:00.000Z",
    source: "public-api",
    studyContext: {
      studyInstanceUid: "study-1",
      dicomWebBaseUrl: "https://archive.example/dicom-web",
      metadataSummary: ["series:1"],
      series: [
        {
          seriesInstanceUid: "series-1",
          seriesDescription: "T1 MPRAGE",
          modality: "MR",
          sequenceLabel: "T1w",
          instanceCount: 120,
          volumeDownloadUrl: "https://archive.example/dicom-web/studies/study-1/series/series-1",
        },
      ],
    },
  });
}

function buildArtifact(overrides?: Partial<DerivedArtifactDescriptor>): DerivedArtifactDescriptor {
  return {
    artifactId: "artifact-1",
    artifactType: "overlay-preview",
    label: "Overlay Preview",
    storageUri: "file:///tmp/case-1/overlay.png",
    retrievalUrl: null,
    mimeType: "image/png",
    contentSha256: "sha256-1",
    byteSize: 512,
    producingPackageId: "brain-structural-fastsurfer",
    producingPackageVersion: "0.1.0",
    workflowFamily: "brain-structural",
    exportCompatibilityTags: ["internal-json"],
    archiveLocator: {
      sourceArchive: "orthanc",
      studyInstanceUid: "study-1",
      accessionNumber: null,
      seriesInstanceUids: ["series-1"],
      dicomWebBaseUrl: "https://archive.example/dicom-web",
    },
    viewerReady: true,
    viewerDescriptor: {
      viewerMode: "dicom-overlay",
      studyInstanceUid: "study-1",
      primarySeriesInstanceUid: "series-1",
      dicomWebBaseUrl: "https://archive.example/dicom-web",
    },
    generatedAt: "2026-04-12T10:05:00.000Z",
    ...overrides,
  };
}

function buildReport(derivedArtifacts?: DerivedArtifactDescriptor[]): ReportPayload {
  return {
    reportSchemaVersion: "0.1.0",
    caseId: "case-1",
    studyRef: { studyUid: "study-1" },
    workflowFamily: "brain-structural",
    processingSummary: "Draft summary",
    qcDisposition: "pass",
    sequenceCoverage: {
      available: ["T1w"],
      missingRequired: [],
    },
    findings: ["No acute intracranial abnormality."],
    measurements: [{ label: "Hippocampal volume", value: 3210, unit: "mm3" }],
    executionContext: createDefaultStructuralExecutionContext({
      computeMode: "voxel-backed",
      sourceSeriesInstanceUid: "series-1",
    }),
    uncertaintySummary: "Human review required.",
    issues: [],
    artifacts: (derivedArtifacts ?? []).map((artifact) => artifact.storageUri),
    derivedArtifacts,
    provenance: {
      workflowVersion: "0.1.0",
      plannerVersion: "wave1-memory-api",
      generatedAt: "2026-04-12T10:05:00.000Z",
    },
    reviewStatus: "reviewed",
    disclaimerProfile: "RUO_CLINICIAN_REVIEW_REQUIRED",
  };
}

function buildInferenceJob(): InferenceJobRecord {
  return {
    jobId: "job-1",
    caseId: "case-1",
    status: "claimed",
    attemptCount: 1,
    enqueuedAt: "2026-04-12T10:01:00.000Z",
    availableAt: "2026-04-12T10:01:00.000Z",
    updatedAt: "2026-04-12T10:02:00.000Z",
    workerId: "worker-1",
    claimedAt: "2026-04-12T10:02:00.000Z",
    completedAt: null,
    lastError: null,
    failureClass: null,
    leaseId: "lease-1",
    leaseExpiresAt: "2026-04-12T10:07:00.000Z",
  };
}

function buildCaseRecord(options?: {
  status?: CaseRecord["status"];
  report?: CaseRecord["report"];
  artifactManifest?: CaseRecord["artifactManifest"];
}): CaseRecord {
  const studyContext = buildStudyContext();
  const planEnvelope = createPlanEnvelope({
    caseId: "case-1",
    studyUid: "study-1",
    indication: "Headache",
    sequenceInventory: ["T1w", "FLAIR"],
    studyContext,
    qcDisposition: "pass",
    source: "public-api",
    isEligible: true,
  });

  const record: CaseRecord = {
    caseId: "case-1",
    patientAlias: "PAT-001",
    tenantId: "tenant-1",
    assignedReviewerId: "reviewer-1",
    studyUid: "study-1",
    workflowFamily: "brain-structural",
    status: options?.status ?? "AWAITING_REVIEW",
    createdAt: "2026-04-12T10:00:00.000Z",
    updatedAt: "2026-04-12T10:10:00.000Z",
    indication: "Headache",
    sequenceInventory: ["T1w", "FLAIR"],
    studyContext,
    qcSummary: {
      ...createPendingQcSummary(),
      disposition: "pass",
      summary: "QC passed",
      checkedAt: "2026-04-12T10:04:00.000Z",
      source: "internal-inference",
    },
    history: [{ from: null, to: options?.status ?? "AWAITING_REVIEW", reason: "Created", at: "2026-04-12T10:00:00.000Z" }],
    operationLog: [],
    planEnvelope,
    evidenceCards: [],
    structuralExecution: null,
    artifactManifest: options?.artifactManifest ?? [],
    report: options?.report ?? null,
    lastInferenceFingerprint: null,
    review: {
      reviewerId: "reviewer-1",
      reviewerRole: "radiologist",
      comments: null,
      reviewedAt: null,
    },
  };

  record.structuralExecution = createStructuralExecutionEnvelope({
    caseRecord: record,
    inferenceJob: buildInferenceJob(),
    executionStatus: "completed",
    executionContext: createDefaultStructuralExecutionContext({
      computeMode: "voxel-backed",
      sourceSeriesInstanceUid: "series-1",
    }),
    artifactIds: (record.artifactManifest ?? []).map((artifact) => artifact.artifactId),
  });

  return record;
}

describe("presentCaseListItem", () => {
  it("returns the expected summary fields", () => {
    const record = buildCaseRecord({ report: buildReport() });
    const presented = presentCaseListItem(record);

    assert.equal(presented.caseId, "case-1");
    assert.equal(presented.patientAlias, "PAT-001");
    assert.equal(presented.studyUid, "study-1");
    assert.equal(presented.status, "AWAITING_REVIEW");
    assert.equal(presented.qcDisposition, "pass");
  });

  it("defaults reviewStatus to not-ready when report is absent", () => {
    const record = buildCaseRecord({ report: null });
    const presented = presentCaseListItem(record);

    assert.equal(presented.reviewStatus, "not-ready");
  });

  it("prefers structural execution package over plan selection", () => {
    const record = buildCaseRecord({ report: buildReport() });
    assert.ok(record.structuralExecution);
    const presented = presentCaseListItem(record);

    assert.equal(presented.selectedPackage, record.structuralExecution?.packageId);
  });
});

describe("presentCaseDetail", () => {
  it("includes artifact manifest viewer and archive URLs", () => {
    const artifact = buildArtifact();
    const record = buildCaseRecord({ artifactManifest: [artifact], report: buildReport([artifact]) });
    const presented = presentCaseDetail(record);

    assert.equal(presented.artifactManifest.length, 1);
    assert.equal(presented.artifactManifest[0].viewerPath, "/workbench?caseId=case-1&panel=viewer&artifactId=artifact-1");
    assert.equal(presented.artifactManifest[0].archiveStudyUrl, "https://archive.example/dicom-web");
  });

  it("includes plan summary series count", () => {
    const record = buildCaseRecord({ report: buildReport() });
    const presented = presentCaseDetail(record);

    assert.equal(presented.planSummary.seriesCount, 1);
    assert.equal(presented.planSummary.selectedPackage, "brain-structural-fastsurfer");
  });

  it("sets reportSummary to null when report is absent", () => {
    const record = buildCaseRecord({ report: null });
    const presented = presentCaseDetail(record);

    assert.equal(presented.reportSummary, null);
  });
});

describe("presentReport", () => {
  it("includes disclaimer profile and derived artifact viewer paths", () => {
    const artifact = buildArtifact();
    const report = buildReport([artifact]);
    const presented = presentReport(report);

    assert.equal(presented.disclaimerProfile, "RUO_CLINICIAN_REVIEW_REQUIRED");
    assert.equal(presented.artifacts.length, 1);
    assert.equal(presented.artifacts[0].viewerPath, "/workbench?caseId=case-1&panel=viewer&artifactId=artifact-1");
  });

  it("normalizes missing final impression to null", () => {
    const report = buildReport();
    const presented = presentReport(report);

    assert.equal(presented.finalImpression, null);
  });
});

describe("delivery and inference job presenters", () => {
  it("maps delivery job fields", () => {
    const job: DeliveryJobRecord = {
      jobId: "delivery-1",
      caseId: "case-1",
      status: "queued",
      attemptCount: 2,
      enqueuedAt: "2026-04-12T10:00:00.000Z",
      availableAt: "2026-04-12T10:00:00.000Z",
      updatedAt: "2026-04-12T10:00:00.000Z",
      workerId: null,
      claimedAt: null,
      completedAt: null,
      lastError: null,
    };

    const presented = presentDeliveryJob(job);
    assert.equal(presented.jobId, "delivery-1");
    assert.equal(presented.attemptCount, 2);
    assert.equal(presented.lastError, null);
  });

  it("maps inference job fields including failure class", () => {
    const job = { ...buildInferenceJob(), failureClass: "transient" as const };
    const presented = presentInferenceJob(job);

    assert.equal(presented.jobId, "job-1");
    assert.equal(presented.failureClass, "transient");
  });
});

describe("presentInferenceExecutionContract", () => {
  it("includes claim details, package manifest, and persistence targets", () => {
    const artifact = buildArtifact();
    const record = buildCaseRecord({ artifactManifest: [artifact], report: buildReport([artifact]) });
    const inferenceJob = buildInferenceJob();

    const contract = presentInferenceExecutionContract({
      caseRecord: record,
      inferenceJob,
    });

    assert.equal(contract.claim.jobId, "job-1");
    assert.equal(contract.workflowFamily, "brain-structural");
    assert.equal(contract.selectedPackage, "brain-structural-fastsurfer");
    assert.equal(contract.packageManifest?.packageId, "brain-structural-fastsurfer");
    assert.equal(contract.persistenceTargets.length, record.planEnvelope.requiredArtifacts.length);
    assert.deepEqual(contract.caseContext.sequenceInventory, ["T1w", "FLAIR"]);
  });
});
