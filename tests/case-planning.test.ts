import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CaseRecord, InferenceJobRecord, ReportPayload } from "../src/case-contracts";
import {
  ALLOWED_TRANSITIONS,
  createDefaultStructuralExecutionContext,
  createEvidenceCards,
  createPlanEnvelope,
  createStructuralExecutionEnvelope,
} from "../src/case-planning";
import { createPendingQcSummary, createStudyContextRecord } from "../src/case-imaging";

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

function buildReport(reviewStatus: ReportPayload["reviewStatus"] = "draft"): ReportPayload {
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
      computeMode: "metadata-fallback",
      fallbackCode: "missing-volume-input",
      fallbackDetail: "Synthetic fixture",
    }),
    uncertaintySummary: "Human review required.",
    issues: [],
    artifacts: [],
    provenance: {
      workflowVersion: "0.1.0",
      plannerVersion: "wave1-memory-api",
      generatedAt: "2026-04-12T10:05:00.000Z",
    },
    reviewStatus,
    disclaimerProfile: "RUO_CLINICIAN_REVIEW_REQUIRED",
  };
}

function buildCaseRecord(options?: {
  status?: CaseRecord["status"];
  sequenceInventory?: string[];
  qcDisposition?: CaseRecord["qcSummary"]["disposition"];
  qcSummary?: string | null;
  structuralExecution?: CaseRecord["structuralExecution"];
  report?: CaseRecord["report"];
}): CaseRecord {
  const sequenceInventory = options?.sequenceInventory ?? ["T1w"];
  const studyContext = buildStudyContext();
  const planEnvelope = createPlanEnvelope({
    caseId: "case-1",
    studyUid: "study-1",
    indication: "Headache",
    sequenceInventory,
    studyContext,
    qcDisposition: options?.qcDisposition === "pending" ? "pending" : "pass",
    source: "public-api",
    isEligible: sequenceInventory.includes("T1w"),
  });

  return {
    caseId: "case-1",
    patientAlias: "PAT-001",
    tenantId: "tenant-1",
    assignedReviewerId: "reviewer-1",
    studyUid: "study-1",
    workflowFamily: "brain-structural",
    status: options?.status ?? "SUBMITTED",
    createdAt: "2026-04-12T10:00:00.000Z",
    updatedAt: "2026-04-12T10:10:00.000Z",
    indication: "Headache",
    sequenceInventory,
    studyContext,
    qcSummary: {
      ...createPendingQcSummary(),
      disposition: options?.qcDisposition ?? "pending",
      summary: options?.qcSummary ?? null,
    },
    history: [{ from: null, to: options?.status ?? "SUBMITTED", reason: "Created", at: "2026-04-12T10:00:00.000Z" }],
    operationLog: [],
    planEnvelope,
    evidenceCards: [],
    structuralExecution: options?.structuralExecution ?? null,
    artifactManifest: [],
    report: options?.report ?? null,
    lastInferenceFingerprint: null,
    review: {
      reviewerId: "reviewer-1",
      reviewerRole: "radiologist",
      comments: null,
      reviewedAt: null,
    },
  };
}

describe("createPlanEnvelope", () => {
  it("selects the structural package for an eligible T1w study", () => {
    const plan = createPlanEnvelope({
      caseId: "case-1",
      studyUid: "study-1",
      indication: "Headache",
      sequenceInventory: ["T1w"],
      studyContext: buildStudyContext(),
      qcDisposition: "pending",
      source: "public-api",
      isEligible: true,
    });

    assert.equal(plan.packageResolution.selectedPackage, "brain-structural-fastsurfer");
    assert.equal(plan.routingDecision.confidence, 0.94);
    assert.equal(plan.downgradeState, null);
    assert.equal(plan.provenance.source, "public-api");
    assert.equal(plan.planSchemaVersion, "0.1.0");
  });

  it("blocks the structural package when T1w is missing", () => {
    const plan = createPlanEnvelope({
      caseId: "case-2",
      studyUid: "study-2",
      indication: null,
      sequenceInventory: ["FLAIR"],
      qcDisposition: "pending",
      source: "internal-ingest",
      isEligible: false,
    });

    assert.equal(plan.packageResolution.selectedPackage, null);
    assert.equal(plan.routingDecision.confidence, 0.51);
    assert.ok(plan.downgradeState);
    assert.ok(plan.packageResolution.blockedPackages.includes("brain-structural-fastsurfer"));
    assert.equal(plan.provenance.source, "internal-ingest");
  });

  it("preserves provided study context values", () => {
    const studyContext = buildStudyContext();
    const plan = createPlanEnvelope({
      caseId: "case-3",
      studyUid: "study-3",
      indication: "Memory loss",
      sequenceInventory: ["T1w", "FLAIR"],
      studyContext,
      qcDisposition: "pending",
      source: "public-api",
      isEligible: true,
    });

    assert.equal(plan.studyContext.dicomStudy.studyInstanceUid, studyContext.dicomStudyInstanceUid);
    assert.equal(plan.studyContext.dicomStudy.seriesCount, 1);
    assert.deepEqual(plan.studyContext.metadataSummary, ["series:1"]);
  });
});

describe("createEvidenceCards", () => {
  it("marks awaiting review cases as high review priority", () => {
    const record = buildCaseRecord({ status: "AWAITING_REVIEW", report: buildReport("draft") });
    const cards = createEvidenceCards(record);
    const reviewCard = cards.find((card) => card.cardType === "review-status");

    assert.ok(reviewCard);
    assert.equal(reviewCard.severity, "high-review-priority");
    assert.equal(reviewCard.status, "review-required");
  });

  it("marks finalized cases as informational", () => {
    const record = buildCaseRecord({ status: "FINALIZED", report: buildReport("finalized") });
    const cards = createEvidenceCards(record);
    const reviewCard = cards.find((card) => card.cardType === "review-status");

    assert.ok(reviewCard);
    assert.equal(reviewCard.severity, "info");
    assert.equal(reviewCard.status, "good");
  });

  it("blocks QC card when the case is rejected", () => {
    const record = buildCaseRecord({
      status: "QC_REJECTED",
      sequenceInventory: ["T1w"],
      qcDisposition: "reject",
      qcSummary: "Motion artifact too severe",
    });
    const cards = createEvidenceCards(record);
    const qcCard = cards.find((card) => card.cardType === "qc");

    assert.ok(qcCard);
    assert.equal(qcCard.severity, "blocked");
    assert.equal(qcCard.status, "blocked");
  });

  it("shows good sequence coverage when T1w is present", () => {
    const record = buildCaseRecord({ sequenceInventory: ["T1w", "FLAIR"] });
    const cards = createEvidenceCards(record);
    const sequenceCard = cards.find((card) => card.cardType === "sequence-coverage");

    assert.ok(sequenceCard);
    assert.equal(sequenceCard.status, "good");
    assert.match(sequenceCard.summary, /T1w present/);
  });

  it("shows blocked sequence coverage when T1w is missing", () => {
    const record = buildCaseRecord({ sequenceInventory: ["FLAIR"] });
    const cards = createEvidenceCards(record);
    const sequenceCard = cards.find((card) => card.cardType === "sequence-coverage");

    assert.ok(sequenceCard);
    assert.equal(sequenceCard.status, "blocked");
    assert.match(sequenceCard.summary, /Missing required sequences: T1w/);
  });

  it("adds an execution card when structural execution exists", () => {
    const record = buildCaseRecord({ report: buildReport("reviewed") });
    const inferenceJob: InferenceJobRecord = {
      jobId: "job-1",
      caseId: record.caseId,
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
    record.structuralExecution = createStructuralExecutionEnvelope({
      caseRecord: record,
      inferenceJob,
      executionStatus: "completed",
      executionContext: createDefaultStructuralExecutionContext({
        computeMode: "voxel-backed",
        sourceSeriesInstanceUid: "series-1",
      }),
      artifactIds: ["artifact-1"],
    });

    const cards = createEvidenceCards(record);
    const executionCard = cards.find((card) => card.cardType === "execution");

    assert.ok(executionCard);
    assert.equal(executionCard.status, "good");
    assert.equal(executionCard.severity, "info");
  });
});

describe("ALLOWED_TRANSITIONS", () => {
  it("allows INGESTING -> SUBMITTED and QC_REJECTED", () => {
    assert.deepEqual(ALLOWED_TRANSITIONS.INGESTING, ["SUBMITTED", "QC_REJECTED"]);
  });

  it("allows FINALIZED -> DELIVERY_PENDING only", () => {
    assert.deepEqual(ALLOWED_TRANSITIONS.FINALIZED, ["DELIVERY_PENDING"]);
  });

  it("marks DELIVERED as terminal", () => {
    assert.deepEqual(ALLOWED_TRANSITIONS.DELIVERED, []);
  });
});
