import { randomUUID } from "node:crypto";
import {
  ALLOWED_TRANSITIONS,
  createDraftReport,
  createEvidenceCards,
  createPlanEnvelope,
} from "./case-planning";
import { missingRequiredSequences, nowIso } from "./case-common";
import { type CaseRepository, SnapshotCaseRepository } from "./case-repository";

export const CASE_STATUSES = [
  "INGESTING",
  "QC_REJECTED",
  "SUBMITTED",
  "AWAITING_REVIEW",
  "REVIEWED",
  "FINALIZED",
  "DELIVERY_PENDING",
  "DELIVERED",
  "DELIVERY_FAILED",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];
export type QcDisposition = "pass" | "warn" | "reject";
export type WorkflowFamily = "brain-structural";
export type EvidenceSeverity = "info" | "warn" | "high-review-priority" | "blocked";
export type EvidenceStatus = "good" | "warn" | "blocked" | "review-required";
export type BranchStatus =
  | "planned"
  | "blocked"
  | "optional"
  | "downgraded"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "omitted";
export type DeliveryOutcome = "pending" | "failed" | "delivered";
export type WorkflowQueueStage = "inference" | "delivery";
export type WorkflowQueueStatus = "queued" | "completed" | "failed";

export class WorkflowError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export interface CreateCaseInput {
  patientAlias: string;
  studyUid: string;
  sequenceInventory: string[];
  indication?: string;
}

export interface ReviewCaseInput {
  reviewerId: string;
  reviewerRole?: string;
  comments?: string;
  finalImpression?: string;
}

export interface FinalizeCaseInput {
  finalSummary?: string;
  deliveryOutcome?: DeliveryOutcome;
}

export interface DeliveryCallbackInput {
  deliveryStatus: Exclude<DeliveryOutcome, "pending">;
  detail?: string;
}

export interface InferenceCallbackInput {
  qcDisposition: QcDisposition;
  findings: string[];
  measurements: Array<{ label: string; value: number; unit?: string }>;
  artifacts: string[];
  issues?: string[];
  generatedSummary?: string;
}

export interface CaseHistoryEntry {
  from: CaseStatus | null;
  to: CaseStatus;
  reason: string;
  at: string;
}

export interface OperationLogEntry {
  operationId: string;
  caseId: string;
  operationType: string;
  actorType: "system" | "clinician" | "integration";
  source:
    | "public-api"
    | "internal-ingest"
    | "internal-inference"
    | "public-review"
    | "public-finalize"
    | "internal-delivery"
    | "system";
  outcome: "accepted" | "completed" | "blocked" | "replayed" | "failed";
  detail: string;
  at: string;
}

export interface WorkflowQueueEntry {
  queueEntryId: string;
  caseId: string;
  stage: WorkflowQueueStage;
  status: WorkflowQueueStatus;
  attempt: number;
  enqueuedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  detail: string;
  sourceOperation: string;
}

export interface StudyContextArtifact {
  studyUid: string;
  workflowFamily: WorkflowFamily;
  sequenceInventory: string[];
  indication: string | null;
  selectedPackage: string | null;
  requiredArtifacts: string[];
  createdAt: string;
  source: "public-api" | "internal-ingest";
}

export interface QcSummaryArtifact {
  disposition: QcDisposition;
  summary: string;
  issues: string[];
  artifactRefs: string[];
  generatedAt: string;
}

export interface FindingsPayloadArtifact {
  summary: string;
  findings: string[];
  measurements: Array<{ label: string; value: number; unit?: string }>;
  generatedAt: string;
  workflowVersion: string;
}

export type StructuralArtifactType =
  | "qc-summary"
  | "overlay-preview"
  | "metrics-json"
  | "report-preview"
  | "derived-artifact";

export interface StructuralDerivedArtifact {
  artifactType: StructuralArtifactType;
  storageRef: string;
  generatedAt: string;
  workflowVersion: string;
}

export interface StructuralRunArtifact {
  packageId: string;
  packageVersion: string;
  status: "succeeded" | "blocked";
  artifacts: StructuralDerivedArtifact[];
  completedAt: string;
}

export interface WorkerArtifacts {
  studyContext: StudyContextArtifact;
  qcSummary: QcSummaryArtifact | null;
  findingsPayload: FindingsPayloadArtifact | null;
  structuralRun: StructuralRunArtifact | null;
}

export interface EvidenceCard {
  cardType: string;
  cardVersion: string;
  caseId: string;
  headline: string;
  severity: EvidenceSeverity;
  status: EvidenceStatus;
  summary: string;
  supportingRefs: string[];
  recommendedAction: string | null;
}

export interface PolicyGateRecord {
  gateId: string;
  gateClass: string;
  outcome: "allow" | "warn" | "block" | "require-override";
  target: string;
  rationale: string;
  evidenceRefs: string[];
  timestamp: string;
}

export interface DowngradeRecord {
  downgradeCode: string;
  fromState: string;
  toState: string;
  rationale: string;
  visibleToOperator: boolean;
  outputLimitations: string[];
}

export interface WorkflowBranch {
  branchId: string;
  role: string;
  status: BranchStatus;
  requiredOutputs: string[];
}

export interface PlanEnvelope {
  planSchemaVersion: string;
  caseRef: {
    caseId: string;
    studyUid: string;
  };
  studyContext: {
    workflowCandidates: WorkflowFamily[];
    sequenceInventory: string[];
    indication: string | null;
  };
  routingDecision: {
    workflowFamily: WorkflowFamily;
    confidence: number;
    decisionBasis: string[];
    operatorOverride: string | null;
  };
  packageResolution: {
    eligiblePackages: string[];
    blockedPackages: string[];
    selectedPackage: string | null;
  };
  branches: WorkflowBranch[];
  policyGateResults: PolicyGateRecord[];
  downgradeState: DowngradeRecord | null;
  dispatchProfile: {
    resourceClass: string;
    retryTier: string;
  };
  requiredArtifacts: string[];
  provenance: {
    plannerVersion: string;
    createdAt: string;
    source: "public-api" | "internal-ingest";
  };
}

export interface ReportPayload {
  reportSchemaVersion: string;
  caseId: string;
  studyRef: { studyUid: string };
  workflowFamily: WorkflowFamily;
  processingSummary: string;
  qcDisposition: QcDisposition | "pending";
  sequenceCoverage: {
    available: string[];
    missingRequired: string[];
  };
  findings: string[];
  measurements: Array<{ label: string; value: number; unit?: string }>;
  uncertaintySummary: string;
  issues: string[];
  artifacts: string[];
  provenance: {
    workflowVersion: string;
    plannerVersion: string;
    generatedAt: string;
  };
  reviewStatus: "draft" | "reviewed" | "finalized";
  disclaimerProfile: "RUO_CLINICIAN_REVIEW_REQUIRED";
  finalImpression?: string;
}

export interface CaseRecord {
  caseId: string;
  patientAlias: string;
  studyUid: string;
  workflowFamily: WorkflowFamily;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  indication: string | null;
  sequenceInventory: string[];
  history: CaseHistoryEntry[];
  operationLog: OperationLogEntry[];
  workflowQueue: WorkflowQueueEntry[];
  workerArtifacts: WorkerArtifacts;
  planEnvelope: PlanEnvelope;
  evidenceCards: EvidenceCard[];
  report: ReportPayload | null;
  lastInferenceFingerprint: string | null;
  review: {
    reviewerId: string;
    reviewerRole: string | null;
    comments: string | null;
    reviewedAt: string | null;
  };
}

export interface MemoryCaseServiceOptions {
  snapshotFilePath?: string;
  repository?: CaseRepository;
}

export interface PersistedCaseSnapshot {
  version: "0.1.0";
  revision: number;
  cases: CaseRecord[];
}

function normalizeSequenceInventory(sequenceInventory: string[]) {
  return Array.from(
    new Set(
      sequenceInventory
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function assertNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkflowError(400, `${fieldName} is required`, "INVALID_INPUT");
  }

  return value.trim();
}

function assertStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value)) {
    throw new WorkflowError(400, `${fieldName} must be an array`, "INVALID_INPUT");
  }

  const normalized = normalizeSequenceInventory(value);

  if (normalized.length === 0) {
    throw new WorkflowError(400, `${fieldName} must not be empty`, "INVALID_INPUT");
  }

  return normalized;
}

function cloneCase<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createOperationLogEntry(input: Omit<OperationLogEntry, "operationId" | "at">): OperationLogEntry {
  return {
    operationId: randomUUID(),
    at: nowIso(),
    ...input,
  };
}

function normalizeWorkflowQueueEntry(entry: WorkflowQueueEntry): WorkflowQueueEntry {
  return {
    ...entry,
    resolvedAt: entry.resolvedAt ?? null,
  };
}

function buildStudyContextArtifact(caseRecord: Pick<
  CaseRecord,
  "studyUid" | "workflowFamily" | "sequenceInventory" | "indication" | "planEnvelope"
>): StudyContextArtifact {
  return {
    studyUid: caseRecord.studyUid,
    workflowFamily: caseRecord.workflowFamily,
    sequenceInventory: [...caseRecord.sequenceInventory],
    indication: caseRecord.indication,
    selectedPackage: caseRecord.planEnvelope.packageResolution.selectedPackage,
    requiredArtifacts: [...caseRecord.planEnvelope.requiredArtifacts],
    createdAt: caseRecord.planEnvelope.provenance.createdAt,
    source: caseRecord.planEnvelope.provenance.source,
  };
}

function buildQcSummaryFromReport(report: ReportPayload | null): QcSummaryArtifact | null {
  if (!report || report.qcDisposition === "pending") {
    return null;
  }

  return {
    disposition: report.qcDisposition,
    summary: report.processingSummary,
    issues: [...report.issues],
    artifactRefs: [...report.artifacts],
    generatedAt: report.provenance.generatedAt,
  };
}

function buildFindingsPayloadFromReport(report: ReportPayload | null): FindingsPayloadArtifact | null {
  if (!report) {
    return null;
  }

  return {
    summary: report.processingSummary,
    findings: [...report.findings],
    measurements: report.measurements.map((measurement) => ({ ...measurement })),
    generatedAt: report.provenance.generatedAt,
    workflowVersion: report.provenance.workflowVersion,
  };
}

function inferStructuralArtifactType(storageRef: string): StructuralArtifactType {
  const normalized = storageRef.toLowerCase();

  if (normalized.includes("overlay")) {
    return "overlay-preview";
  }
  if (normalized.includes("qc-summary") || normalized.endsWith("://qc") || normalized.includes("/qc")) {
    return "qc-summary";
  }
  if (normalized.includes("metrics")) {
    return "metrics-json";
  }
  if (normalized.includes("report")) {
    return "report-preview";
  }

  return "derived-artifact";
}

function buildStructuralRunFromReport(caseRecord: CaseRecord): StructuralRunArtifact | null {
  if (!caseRecord.report) {
    return null;
  }

  const workflowVersion = caseRecord.report.provenance.workflowVersion;
  const [packageId, packageVersion = "0.1.0"] = workflowVersion.split("@");
  const storageRefs = Array.from(new Set(caseRecord.report.artifacts));

  return {
    packageId: packageId || caseRecord.planEnvelope.packageResolution.selectedPackage || "brain-structural-fastsurfer",
    packageVersion,
    status: "succeeded",
    artifacts: storageRefs.map((storageRef) => ({
      artifactType: inferStructuralArtifactType(storageRef),
      storageRef,
      generatedAt: caseRecord.report!.provenance.generatedAt,
      workflowVersion,
    })),
    completedAt: caseRecord.report.provenance.generatedAt,
  };
}

function normalizeWorkerArtifacts(caseRecord: CaseRecord): WorkerArtifacts {
  const persisted = caseRecord.workerArtifacts;
  return {
    studyContext: persisted?.studyContext
      ? {
          ...buildStudyContextArtifact(caseRecord),
          ...persisted.studyContext,
          sequenceInventory: Array.isArray(persisted.studyContext.sequenceInventory)
            ? [...persisted.studyContext.sequenceInventory]
            : [...caseRecord.sequenceInventory],
          requiredArtifacts: Array.isArray(persisted.studyContext.requiredArtifacts)
            ? [...persisted.studyContext.requiredArtifacts]
            : [...caseRecord.planEnvelope.requiredArtifacts],
        }
      : buildStudyContextArtifact(caseRecord),
    qcSummary: persisted?.qcSummary
      ? {
          ...persisted.qcSummary,
          issues: [...persisted.qcSummary.issues],
          artifactRefs: [...persisted.qcSummary.artifactRefs],
        }
      : buildQcSummaryFromReport(caseRecord.report),
    findingsPayload: persisted?.findingsPayload
      ? {
          ...persisted.findingsPayload,
          findings: [...persisted.findingsPayload.findings],
          measurements: persisted.findingsPayload.measurements.map((measurement) => ({ ...measurement })),
        }
      : buildFindingsPayloadFromReport(caseRecord.report),
    structuralRun: persisted?.structuralRun
      ? {
          ...persisted.structuralRun,
          artifacts: persisted.structuralRun.artifacts.map((artifact) => ({ ...artifact })),
        }
      : buildStructuralRunFromReport(caseRecord),
  };
}

function normalizeCaseRecordShape(caseRecord: CaseRecord): CaseRecord {
  return {
    ...caseRecord,
    workflowQueue: Array.isArray(caseRecord.workflowQueue)
      ? caseRecord.workflowQueue.map(normalizeWorkflowQueueEntry)
      : [],
    workerArtifacts: normalizeWorkerArtifacts(caseRecord),
  };
}

function normalizeMeasurementSet(
  measurements: Array<{ label: string; value: number; unit?: string }>,
) {
  return measurements.map((measurement) => ({
    label: measurement.label,
    value: measurement.value,
    unit: measurement.unit ?? null,
  }));
}

function createInferenceFingerprint(input: InferenceCallbackInput) {
  return JSON.stringify({
    qcDisposition: input.qcDisposition,
    findings: input.findings,
    measurements: normalizeMeasurementSet(input.measurements),
    artifacts: input.artifacts,
    issues: input.issues ?? [],
    generatedSummary: input.generatedSummary ?? null,
  });
}

export class MemoryCaseService {
  private readonly repository: CaseRepository;

  constructor(private readonly options: MemoryCaseServiceOptions = {}) {
    this.repository = options.repository ?? new SnapshotCaseRepository(options);
  }

  async listCases() {
    const cases = await this.repository.list();
    return cases.map(normalizeCaseRecordShape);
  }

  async getCase(caseId: string) {
    return cloneCase(await this.requireCase(caseId));
  }

  async createCase(input: CreateCaseInput) {
    const normalized = this.normalizeCreateInput(input);
    const existing = await this.findMatchingExistingCase(normalized);

    if (existing) {
      return cloneCase(existing);
    }

    if (missingRequiredSequences(normalized.sequenceInventory).length > 0) {
      throw new WorkflowError(
        422,
        "T1w is required for public case creation in the neuro structural MVP slice",
        "MISSING_REQUIRED_SEQUENCE",
      );
    }

    const record = this.buildCaseRecord(normalized, "public-api", "SUBMITTED", "Public case created");
    await this.persistNewCase(record);
    return cloneCase(record);
  }

  async ingestCase(input: CreateCaseInput) {
    const normalized = this.normalizeCreateInput(input);
    const existing = await this.findMatchingExistingCase(normalized);

    if (existing) {
      return cloneCase(existing);
    }

    const initial = this.buildCaseRecord(normalized, "internal-ingest", "INGESTING", "Internal ingest received");

    const nextStatus: CaseStatus =
      missingRequiredSequences(normalized.sequenceInventory).length > 0
        ? "QC_REJECTED"
        : "SUBMITTED";
    const nextReason =
      nextStatus === "SUBMITTED"
        ? "Intake accepted for neuro structural workflow"
        : "Rejected because required T1w sequence is missing";
    this.transition(initial, nextStatus, nextReason);
    this.appendOperation(initial, {
      caseId: initial.caseId,
      operationType: nextStatus === "SUBMITTED" ? "ingest-accepted" : "ingest-rejected",
      actorType: "integration",
      source: "internal-ingest",
      outcome: nextStatus === "SUBMITTED" ? "accepted" : "blocked",
      detail: nextReason,
    });
    if (nextStatus === "SUBMITTED") {
      this.enqueueQueueEntry(initial, "inference", "ingest-accepted", "Case queued for inference.");
    }
    initial.evidenceCards = createEvidenceCards(initial);
    await this.persistNewCase(initial);

    return cloneCase(initial);
  }

  async completeInference(caseId: string, input: InferenceCallbackInput) {
    const record = await this.requireCase(caseId);
    const normalizedInput = this.normalizeInferenceInput(input);
    const fingerprint = createInferenceFingerprint(normalizedInput);

    return this.persistExistingCase(record, async (record) => {
      if (record.status !== "SUBMITTED") {
        if (record.lastInferenceFingerprint === fingerprint) {
          this.appendOperation(record, {
            caseId: record.caseId,
            operationType: "inference-replayed",
            actorType: "integration",
            source: "internal-inference",
            outcome: "replayed",
            detail: "Duplicate inference callback ignored because draft output already exists.",
          });
          return cloneCase(record);
        }

        if (record.lastInferenceFingerprint) {
          throw new WorkflowError(
            409,
            "Inference callback conflicts with already accepted output for this case",
            "INFERENCE_CONFLICT",
          );
        }

        this.assertStatus(record, ["SUBMITTED"]);
      }

      if (normalizedInput.qcDisposition === "reject") {
        record.lastInferenceFingerprint = fingerprint;
        record.workerArtifacts.qcSummary = {
          disposition: normalizedInput.qcDisposition,
          summary: normalizedInput.generatedSummary ?? "QC gate rejected the study.",
          issues: [...(normalizedInput.issues ?? [])],
          artifactRefs: [...normalizedInput.artifacts],
          generatedAt: nowIso(),
        };
        record.workerArtifacts.findingsPayload = null;
        record.workerArtifacts.structuralRun = null;
        this.resolveLatestQueueEntry(record, "inference", "completed", "Inference completed with QC rejection.");
        this.transition(record, "QC_REJECTED", "QC gate rejected the study");
        this.appendOperation(record, {
          caseId: record.caseId,
          operationType: "inference-rejected",
          actorType: "integration",
          source: "internal-inference",
          outcome: "blocked",
          detail: "Inference callback marked the study as QC rejected.",
        });
        record.evidenceCards = createEvidenceCards(record);
        return cloneCase(record);
      }

      record.lastInferenceFingerprint = fingerprint;
      record.report = createDraftReport(record, normalizedInput);
      record.workerArtifacts.qcSummary = buildQcSummaryFromReport(record.report);
      record.workerArtifacts.findingsPayload = buildFindingsPayloadFromReport(record.report);
      record.workerArtifacts.structuralRun = buildStructuralRunFromReport(record);
      this.resolveLatestQueueEntry(record, "inference", "completed", "Inference completed and draft prepared.");
      record.planEnvelope.branches = record.planEnvelope.branches.map((branch) => ({
        ...branch,
        status: branch.status === "blocked" ? branch.status : "succeeded",
      }));
      this.transition(record, "AWAITING_REVIEW", "Inference completed and draft prepared");
      this.appendOperation(record, {
        caseId: record.caseId,
        operationType: "inference-completed",
        actorType: "integration",
        source: "internal-inference",
        outcome: "completed",
        detail: `Draft report prepared with QC ${normalizedInput.qcDisposition}.`,
      });
      record.evidenceCards = createEvidenceCards(record);

      return cloneCase(record);
    });
  }

  async reviewCase(caseId: string, input: ReviewCaseInput) {
    const record = await this.requireCase(caseId);
    return this.persistExistingCase(record, async (record) => {
      this.assertStatus(record, ["AWAITING_REVIEW"]);

      const normalized = {
        reviewerId: assertNonEmptyString(input.reviewerId, "reviewerId"),
        reviewerRole:
          typeof input.reviewerRole === "string" && input.reviewerRole.trim().length > 0
            ? input.reviewerRole.trim()
            : null,
        comments:
          typeof input.comments === "string" && input.comments.trim().length > 0
            ? input.comments.trim()
            : null,
        finalImpression:
          typeof input.finalImpression === "string" && input.finalImpression.trim().length > 0
            ? input.finalImpression.trim()
            : null,
      };

      if (!record.report) {
        throw new WorkflowError(409, "Report draft is not available", "REPORT_NOT_READY");
      }

      record.review = {
        reviewerId: normalized.reviewerId,
        reviewerRole: normalized.reviewerRole,
        comments: normalized.comments,
        reviewedAt: nowIso(),
      };
      record.report.reviewStatus = "reviewed";
      if (normalized.finalImpression) {
        record.report.finalImpression = normalized.finalImpression;
      }
      if (normalized.comments) {
        record.report.issues = Array.from(new Set([...record.report.issues, normalized.comments]));
      }

      this.transition(record, "REVIEWED", "Clinician review completed");
      this.appendOperation(record, {
        caseId: record.caseId,
        operationType: "clinician-reviewed",
        actorType: "clinician",
        source: "public-review",
        outcome: "completed",
        detail: `Reviewed by ${normalized.reviewerId}.`,
      });
      record.evidenceCards = createEvidenceCards(record);

      return cloneCase(record);
    });
  }

  async finalizeCase(caseId: string, input: FinalizeCaseInput = {}) {
    const record = await this.requireCase(caseId);
    return this.persistExistingCase(record, async (record) => {
      this.assertStatus(record, ["REVIEWED"]);

      if (!record.report) {
        throw new WorkflowError(409, "Report draft is not available", "REPORT_NOT_READY");
      }

      if (typeof input.finalSummary === "string" && input.finalSummary.trim().length > 0) {
        record.report.processingSummary = input.finalSummary.trim();
      }
      record.report.reviewStatus = "finalized";

      const deliveryOutcome = input.deliveryOutcome ?? "pending";

      this.transition(record, "FINALIZED", "Final clinical summary locked");
      this.appendOperation(record, {
        caseId: record.caseId,
        operationType: "case-finalized",
        actorType: "clinician",
        source: "public-finalize",
        outcome: "completed",
        detail: "Final review state locked for release.",
      });
      this.transition(record, "DELIVERY_PENDING", "Report queued for outbound delivery");
      this.appendOperation(record, {
        caseId: record.caseId,
        operationType: "delivery-queued",
        actorType: "system",
        source: "public-finalize",
        outcome: "accepted",
        detail: "Report queued for outbound delivery.",
      });
      this.enqueueQueueEntry(record, "delivery", "delivery-queued", "Report queued for outbound delivery.");

      if (deliveryOutcome === "failed") {
        this.transition(record, "DELIVERY_FAILED", "Outbound delivery failed");
        this.resolveLatestQueueEntry(record, "delivery", "failed", "Simulated outbound delivery failure recorded at finalize time.");
        this.appendOperation(record, {
          caseId: record.caseId,
          operationType: "delivery-failed",
          actorType: "system",
          source: "public-finalize",
          outcome: "failed",
          detail: "Simulated outbound delivery failure recorded at finalize time.",
        });
      } else if (deliveryOutcome === "delivered") {
        this.transition(record, "DELIVERED", "Outbound delivery succeeded");
        this.resolveLatestQueueEntry(record, "delivery", "completed", "Simulated outbound delivery success recorded at finalize time.");
        this.appendOperation(record, {
          caseId: record.caseId,
          operationType: "delivery-succeeded",
          actorType: "system",
          source: "public-finalize",
          outcome: "completed",
          detail: "Simulated outbound delivery success recorded at finalize time.",
        });
      }

      record.evidenceCards = createEvidenceCards(record);

      return cloneCase(record);
    });
  }

  async retryDelivery(caseId: string) {
    const record = await this.requireCase(caseId);
    return this.persistExistingCase(record, async (record) => {
      this.assertStatus(record, ["DELIVERY_FAILED"]);
      this.transition(record, "DELIVERY_PENDING", "Delivery retry requested");
      this.appendOperation(record, {
        caseId: record.caseId,
        operationType: "delivery-retry-requested",
        actorType: "system",
        source: "public-api",
        outcome: "accepted",
        detail: "Delivery retry requested from public API.",
      });
      this.enqueueQueueEntry(record, "delivery", "delivery-retry-requested", "Delivery retry requested from public API.");
      record.evidenceCards = createEvidenceCards(record);
      return cloneCase(record);
    });
  }

  async completeDelivery(caseId: string, input: DeliveryCallbackInput) {
    const record = await this.requireCase(caseId);
    return this.persistExistingCase(record, async (record) => {
      if (record.status === "DELIVERED" && input.deliveryStatus === "delivered") {
        this.appendOperation(record, {
          caseId: record.caseId,
          operationType: "delivery-replayed",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "replayed",
          detail: input.detail?.trim().length
            ? input.detail.trim()
            : "Duplicate delivery success callback acknowledged.",
        });
        return cloneCase(record);
      }

      if (record.status === "DELIVERY_FAILED" && input.deliveryStatus === "failed") {
        this.appendOperation(record, {
          caseId: record.caseId,
          operationType: "delivery-replayed",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "replayed",
          detail: input.detail?.trim().length
            ? input.detail.trim()
            : "Duplicate delivery failure callback acknowledged.",
        });
        return cloneCase(record);
      }

      this.assertStatus(record, ["DELIVERY_PENDING"]);

      if (input.deliveryStatus === "delivered") {
        this.transition(
          record,
          "DELIVERED",
          input.detail?.trim().length
            ? `Outbound delivery succeeded: ${input.detail.trim()}`
            : "Outbound delivery succeeded",
        );
        this.resolveLatestQueueEntry(
          record,
          "delivery",
          "completed",
          input.detail?.trim().length ? input.detail.trim() : "Delivery callback confirmed success.",
        );
        this.appendOperation(record, {
          caseId: record.caseId,
          operationType: "delivery-succeeded",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "completed",
          detail: input.detail?.trim().length
            ? input.detail.trim()
            : "Delivery callback confirmed success.",
        });
      } else {
        this.transition(
          record,
          "DELIVERY_FAILED",
          input.detail?.trim().length
            ? `Outbound delivery failed: ${input.detail.trim()}`
            : "Outbound delivery failed",
        );
        this.resolveLatestQueueEntry(
          record,
          "delivery",
          "failed",
          input.detail?.trim().length ? input.detail.trim() : "Delivery callback reported failure.",
        );
        this.appendOperation(record, {
          caseId: record.caseId,
          operationType: "delivery-failed",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "failed",
          detail: input.detail?.trim().length
            ? input.detail.trim()
            : "Delivery callback reported failure.",
        });
      }

      record.evidenceCards = createEvidenceCards(record);
      return cloneCase(record);
    });
  }

  async getReport(caseId: string) {
    const record = await this.requireCase(caseId);

    if (!record.report) {
      throw new WorkflowError(404, "Report is not available for this case", "REPORT_NOT_READY");
    }

    return JSON.parse(JSON.stringify(record.report)) as ReportPayload;
  }

  async getOperationsSummary() {
    const byStatus = Object.fromEntries(CASE_STATUSES.map((status) => [status, 0])) as Record<CaseStatus, number>;
    const cases = await this.repository.list();
    const operations = cases
      .flatMap((caseRecord) => caseRecord.operationLog.map((entry) => cloneCase(entry)))
      .sort((left, right) => right.at.localeCompare(left.at));
    const queueEntries = cases
      .flatMap((caseRecord) => normalizeCaseRecordShape(caseRecord).workflowQueue.map((entry) => cloneCase(entry)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const activeQueue = queueEntries.filter((entry) => entry.status === "queued");

    for (const caseRecord of cases) {
      byStatus[caseRecord.status] += 1;
    }

    return {
      totalCases: cases.length,
      byStatus,
      reviewRequiredCount: byStatus.AWAITING_REVIEW,
      deliveryFailures: byStatus.DELIVERY_FAILED,
      recentOperations: operations.slice(0, 20),
      retryHistory: operations.filter((entry) => entry.operationType === "delivery-retry-requested"),
      queue: {
        totalActive: activeQueue.length,
        byStage: {
          inference: activeQueue.filter((entry) => entry.stage === "inference").length,
          delivery: activeQueue.filter((entry) => entry.stage === "delivery").length,
        },
        active: activeQueue,
        recent: queueEntries.slice(0, 20),
      },
    };
  }

  private normalizeCreateInput(input: CreateCaseInput) {
    const patientAlias = assertNonEmptyString(input.patientAlias, "patientAlias");
    const studyUid = assertNonEmptyString(input.studyUid, "studyUid");
    const sequenceInventory = assertStringArray(input.sequenceInventory, "sequenceInventory");
    const indication =
      typeof input.indication === "string" && input.indication.trim().length > 0
        ? input.indication.trim()
        : null;

    return {
      patientAlias,
      studyUid,
      sequenceInventory,
      indication,
    };
  }

  private normalizeInferenceInput(input: InferenceCallbackInput): InferenceCallbackInput {
    if (input.qcDisposition !== "pass" && input.qcDisposition !== "warn" && input.qcDisposition !== "reject") {
      throw new WorkflowError(400, "qcDisposition must be pass, warn, or reject", "INVALID_INPUT");
    }

    if (!Array.isArray(input.findings) || !Array.isArray(input.measurements) || !Array.isArray(input.artifacts)) {
      throw new WorkflowError(400, "findings, measurements, and artifacts are required arrays", "INVALID_INPUT");
    }

    return {
      qcDisposition: input.qcDisposition,
      findings: input.findings.map((value) => String(value)),
      measurements: input.measurements.map((measurement) => ({
        label: assertNonEmptyString(measurement.label, "measurement.label"),
        value: measurement.value,
        unit: measurement.unit,
      })),
      artifacts: input.artifacts.map((value) => String(value)),
      issues: Array.isArray(input.issues) ? input.issues.map((value) => String(value)) : [],
      generatedSummary: input.generatedSummary,
    };
  }

  private buildCaseRecord(
    input: ReturnType<MemoryCaseService["normalizeCreateInput"]>,
    source: "public-api" | "internal-ingest",
    initialStatus: CaseStatus,
    reason: string,
  ): CaseRecord {
    const caseId = randomUUID();
    const createdAt = nowIso();
    const isEligible = missingRequiredSequences(input.sequenceInventory).length === 0;
    const record: CaseRecord = {
      caseId,
      patientAlias: input.patientAlias,
      studyUid: input.studyUid,
      workflowFamily: "brain-structural",
      status: initialStatus,
      createdAt,
      updatedAt: createdAt,
      indication: input.indication,
      sequenceInventory: input.sequenceInventory,
      history: [
        {
          from: null,
          to: initialStatus,
          reason,
          at: createdAt,
        },
      ],
      operationLog: [],
      workflowQueue: [],
      workerArtifacts: {
        studyContext: {
          studyUid: input.studyUid,
          workflowFamily: "brain-structural",
          sequenceInventory: [...input.sequenceInventory],
          indication: input.indication,
          selectedPackage: null,
          requiredArtifacts: [],
          createdAt,
          source,
        },
        qcSummary: null,
        findingsPayload: null,
        structuralRun: null,
      },
      planEnvelope: createPlanEnvelope({
        caseId,
        studyUid: input.studyUid,
        indication: input.indication,
        sequenceInventory: input.sequenceInventory,
        source,
        isEligible,
      }),
      evidenceCards: [],
      report: null,
      lastInferenceFingerprint: null,
      review: {
        reviewerId: "",
        reviewerRole: null,
        comments: null,
        reviewedAt: null,
      },
    };
    record.workerArtifacts.studyContext = buildStudyContextArtifact(record);
    this.appendOperation(record, {
      caseId,
      operationType: source === "public-api" ? "case-created" : "ingest-received",
      actorType: source === "public-api" ? "system" : "integration",
      source,
      outcome: "accepted",
      detail: reason,
    });
    if (initialStatus === "SUBMITTED") {
      this.enqueueQueueEntry(
        record,
        "inference",
        source === "public-api" ? "case-created" : "ingest-accepted",
        "Case queued for inference.",
      );
    }
    record.evidenceCards = createEvidenceCards(record);
    return record;
  }

  private async requireCase(caseId: string) {
    const caseRecord = await this.repository.get(caseId);
    if (!caseRecord) {
      throw new WorkflowError(404, `Case ${caseId} not found`, "CASE_NOT_FOUND");
    }
    return normalizeCaseRecordShape(caseRecord);
  }

  private async findMatchingExistingCase(input: ReturnType<MemoryCaseService["normalizeCreateInput"]>) {
    const existing = await this.repository.findByStudyUid(input.studyUid);

    if (!existing) {
      return null;
    }

    const matchesPayload =
      existing.patientAlias === input.patientAlias &&
      existing.indication === input.indication &&
      JSON.stringify(existing.sequenceInventory) === JSON.stringify(input.sequenceInventory);

    if (!matchesPayload) {
      throw new WorkflowError(
        409,
        `Study ${input.studyUid} already exists with conflicting payload`,
        "DUPLICATE_STUDY_UID",
      );
    }

    return normalizeCaseRecordShape(existing);
  }

  private assertStatus(caseRecord: CaseRecord, expected: readonly CaseStatus[]) {
    if (!expected.includes(caseRecord.status)) {
      throw new WorkflowError(
        409,
        `Case ${caseRecord.caseId} is in ${caseRecord.status} and cannot perform this action`,
        "INVALID_TRANSITION",
      );
    }
  }

  private transition(caseRecord: CaseRecord, nextStatus: CaseStatus, reason: string) {
    const allowed = ALLOWED_TRANSITIONS[caseRecord.status];
    if (!allowed.includes(nextStatus)) {
      throw new WorkflowError(
        409,
        `Transition ${caseRecord.status} -> ${nextStatus} is not allowed`,
        "INVALID_TRANSITION",
      );
    }

    const updatedAt = nowIso();
    caseRecord.history.push({
      from: caseRecord.status,
      to: nextStatus,
      reason,
      at: updatedAt,
    });
    caseRecord.status = nextStatus;
    caseRecord.updatedAt = updatedAt;
  }

  private appendOperation(caseRecord: CaseRecord, entry: Omit<OperationLogEntry, "operationId" | "at">) {
    caseRecord.operationLog.push(createOperationLogEntry(entry));
  }

  private enqueueQueueEntry(
    caseRecord: CaseRecord,
    stage: WorkflowQueueStage,
    sourceOperation: string,
    detail: string,
  ) {
    const timestamp = nowIso();
    const attempt = caseRecord.workflowQueue.filter((entry) => entry.stage === stage).length + 1;
    caseRecord.workflowQueue.push({
      queueEntryId: randomUUID(),
      caseId: caseRecord.caseId,
      stage,
      status: "queued",
      attempt,
      enqueuedAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      detail,
      sourceOperation,
    });
  }

  private resolveLatestQueueEntry(
    caseRecord: CaseRecord,
    stage: WorkflowQueueStage,
    status: Exclude<WorkflowQueueStatus, "queued">,
    detail: string,
  ) {
    for (let index = caseRecord.workflowQueue.length - 1; index >= 0; index -= 1) {
      const entry = caseRecord.workflowQueue[index];
      if (entry.stage !== stage || entry.status !== "queued") {
        continue;
      }

      const timestamp = nowIso();
      entry.status = status;
      entry.updatedAt = timestamp;
      entry.resolvedAt = timestamp;
      entry.detail = detail;
      return;
    }
  }

  private async persistNewCase(caseRecord: CaseRecord) {
    await this.repository.upsert(caseRecord);
  }

  private async persistExistingCase<T>(caseRecord: CaseRecord, mutate: (workingCopy: CaseRecord) => Promise<T>) {
    const workingCopy = cloneCase(caseRecord);

    const result = await mutate(workingCopy);
    await this.repository.upsert(workingCopy);
    return result;
  }
}