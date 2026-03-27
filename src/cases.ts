import { randomUUID } from "node:crypto";
import {
  ALLOWED_TRANSITIONS,
  createDraftReport,
  createEvidenceCards,
  createPlanEnvelope,
} from "./case-planning";
import { missingRequiredSequences, nowIso } from "./case-common";
import {
  createCaseRepository,
  type CaseRepository,
  type CaseStoreMode,
} from "./case-repository";
import type { PostgresPoolFactory } from "./case-postgres-repository";
import {
  createPendingQcSummary,
  createQcSummaryRecord,
  createStudyContextRecord,
  type QcSummaryInput,
  type QcSummaryRecord,
  type StudyContextInput,
  type StudyContextRecord,
} from "./case-imaging";
import type { DerivedArtifactDescriptor } from "./case-artifacts";

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
export type DeliveryJobStatus = "queued" | "claimed" | "delivered" | "failed";
export type InferenceJobStatus = "queued" | "claimed" | "completed" | "failed";

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
  studyContext?: StudyContextInput;
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
  qcSummary?: QcSummaryInput;
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

export interface DeliveryJobRecord {
  jobId: string;
  caseId: string;
  status: DeliveryJobStatus;
  attemptCount: number;
  enqueuedAt: string;
  availableAt: string;
  updatedAt: string;
  workerId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface InferenceJobRecord {
  jobId: string;
  caseId: string;
  status: InferenceJobStatus;
  attemptCount: number;
  enqueuedAt: string;
  availableAt: string;
  updatedAt: string;
  workerId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
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
    qcDisposition: QcDisposition | "pending";
    metadataSummary: string[];
    dicomStudy: {
      studyInstanceUid: string;
      accessionNumber: string | null;
      studyDate: string | null;
      sourceArchive: string | null;
      dicomWebBaseUrl: string | null;
      seriesCount: number;
    };
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
  derivedArtifacts: DerivedArtifactDescriptor[];
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
  studyContext: StudyContextRecord;
  qcSummary: QcSummaryRecord;
  history: CaseHistoryEntry[];
  operationLog: OperationLogEntry[];
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
  caseStoreFilePath?: string;
  snapshotFilePath?: string;
  storageMode?: CaseStoreMode;
  caseStoreDatabaseUrl?: string;
  caseStoreSchema?: string;
  postgresPoolFactory?: PostgresPoolFactory;
  repository?: CaseRepository;
}

export interface PersistedCaseSnapshot {
  version: "0.1.0";
  revision: number;
  cases: CaseRecord[];
  deliveryJobs?: DeliveryJobRecord[];
  inferenceJobs?: InferenceJobRecord[];
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

function createDeliveryJobRecord(caseId: string): DeliveryJobRecord {
  const createdAt = nowIso();

  return {
    jobId: randomUUID(),
    caseId,
    status: "queued",
    attemptCount: 0,
    enqueuedAt: createdAt,
    availableAt: createdAt,
    updatedAt: createdAt,
    workerId: null,
    claimedAt: null,
    completedAt: null,
    lastError: null,
  };
}

function createInferenceJobRecord(caseId: string): InferenceJobRecord {
  const createdAt = nowIso();

  return {
    jobId: randomUUID(),
    caseId,
    status: "queued",
    attemptCount: 0,
    enqueuedAt: createdAt,
    availableAt: createdAt,
    updatedAt: createdAt,
    workerId: null,
    claimedAt: null,
    completedAt: null,
    lastError: null,
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

function isConcurrentStoreModificationError(error: unknown) {
  return error instanceof Error && error.message.includes("Concurrent case store modification detected");
}

export class MemoryCaseService {
  private readonly repository: CaseRepository;

  constructor(private readonly options: MemoryCaseServiceOptions = {}) {
    if (options.repository) {
      this.repository = options.repository;
      return;
    }

    const storageMode =
      options.storageMode ??
      (options.caseStoreDatabaseUrl ? "postgres" : options.caseStoreFilePath || options.snapshotFilePath ? "sqlite" : "snapshot");

    this.repository = createCaseRepository({
      caseStoreFilePath: options.caseStoreFilePath ?? options.snapshotFilePath,
      storageMode,
      databaseUrl: options.caseStoreDatabaseUrl,
      schema: options.caseStoreSchema,
      postgresPoolFactory: options.postgresPoolFactory,
    });
  }

  async listCases() {
    return this.repository.list();
  }

  async getCase(caseId: string) {
    return cloneCase(await this.requireCase(caseId));
  }

  async listDeliveryJobs() {
    return this.repository.listDeliveryJobs();
  }

  async listInferenceJobs() {
    return this.repository.listInferenceJobs();
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
    this.repository.setInferenceJob(createInferenceJobRecord(record.caseId));
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
    initial.evidenceCards = createEvidenceCards(initial);
    if (nextStatus === "SUBMITTED") {
      this.repository.setInferenceJob(createInferenceJobRecord(initial.caseId));
    }
    await this.persistNewCase(initial);

    return cloneCase(initial);
  }

  async completeInference(caseId: string, input: InferenceCallbackInput) {
    const record = await this.requireCase(caseId);
    const normalizedInput = this.normalizeInferenceInput(input);
    const fingerprint = createInferenceFingerprint(normalizedInput);

    return this.persistExistingCase(record, async () => {
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
        record.qcSummary = createQcSummaryRecord({
          disposition: normalizedInput.qcDisposition,
          checkedAt: nowIso(),
          issues: normalizedInput.issues,
          qcSummary: normalizedInput.qcSummary,
        });
        record.planEnvelope.studyContext.qcDisposition = record.qcSummary.disposition;
        record.lastInferenceFingerprint = fingerprint;
        this.transition(record, "QC_REJECTED", "QC gate rejected the study");
        this.appendOperation(record, {
          caseId: record.caseId,
          operationType: "inference-rejected",
          actorType: "integration",
          source: "internal-inference",
          outcome: "blocked",
          detail: "Inference callback marked the study as QC rejected.",
        });
        this.completeInferenceJob(await this.findLatestActiveInferenceJob(record.caseId), record.caseId);
        record.evidenceCards = createEvidenceCards(record);
        return cloneCase(record);
      }

      record.qcSummary = createQcSummaryRecord({
        disposition: normalizedInput.qcDisposition,
        checkedAt: nowIso(),
        issues: normalizedInput.issues,
        qcSummary: normalizedInput.qcSummary,
      });
      record.planEnvelope.studyContext.qcDisposition = record.qcSummary.disposition;
      record.lastInferenceFingerprint = fingerprint;
      record.report = createDraftReport(record, normalizedInput);
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
      this.completeInferenceJob(await this.findLatestActiveInferenceJob(record.caseId), record.caseId);
      record.evidenceCards = createEvidenceCards(record);

      return cloneCase(record);
    });
  }

  async reviewCase(caseId: string, input: ReviewCaseInput) {
    const record = await this.requireCase(caseId);
    return this.persistExistingCase(record, async () => {
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
    return this.persistExistingCase(record, async () => {
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

      const deliveryJob = createDeliveryJobRecord(record.caseId);
      this.repository.setDeliveryJob(deliveryJob);

      if (deliveryOutcome === "failed") {
        this.updateDeliveryJob(deliveryJob, {
          status: "failed",
          attemptCount: 1,
          workerId: "simulated-finalize",
          claimedAt: deliveryJob.updatedAt,
          completedAt: deliveryJob.updatedAt,
          lastError: "Simulated outbound delivery failure recorded at finalize time.",
        });
        this.transition(record, "DELIVERY_FAILED", "Outbound delivery failed");
        this.appendOperation(record, {
          caseId: record.caseId,
          operationType: "delivery-failed",
          actorType: "system",
          source: "public-finalize",
          outcome: "failed",
          detail: "Simulated outbound delivery failure recorded at finalize time.",
        });
      } else if (deliveryOutcome === "delivered") {
        this.updateDeliveryJob(deliveryJob, {
          status: "delivered",
          attemptCount: 1,
          workerId: "simulated-finalize",
          claimedAt: deliveryJob.updatedAt,
          completedAt: deliveryJob.updatedAt,
        });
        this.transition(record, "DELIVERED", "Outbound delivery succeeded");
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
    return this.persistExistingCase(record, async () => {
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
      this.repository.setDeliveryJob(createDeliveryJobRecord(record.caseId));
      record.evidenceCards = createEvidenceCards(record);
      return cloneCase(record);
    });
  }

  async claimNextInferenceJob(workerId?: string) {
    const worker = typeof workerId === "string" && workerId.trim().length > 0 ? workerId.trim() : "inference-worker";
    const claimNextAvailableJob = async () => {
      const nextJob = await this.findNextClaimableInferenceJob();

      if (!nextJob) {
        return null;
      }

      return this.persistQueueMutation(async () => {
        const claimedAt = nowIso();
        const claimedJob: InferenceJobRecord = {
          ...nextJob,
          status: "claimed",
          attemptCount: nextJob.attemptCount + 1,
          workerId: worker,
          claimedAt,
          updatedAt: claimedAt,
        };
        this.repository.setInferenceJob(claimedJob);
        return cloneCase(claimedJob);
      });
    };

    try {
      return await claimNextAvailableJob();
    } catch (error) {
      if (isConcurrentStoreModificationError(error)) {
        await this.repository.reload();
        return await claimNextAvailableJob();
      }

      throw error;
    }
  }

  async requeueExpiredInferenceJobs(maxClaimAgeMs: number) {
    if (!Number.isFinite(maxClaimAgeMs) || maxClaimAgeMs < 0) {
      throw new WorkflowError(400, "maxClaimAgeMs must be a non-negative number", "INVALID_INPUT");
    }

    const requeueExpiredJobs = async () => {
      const expiredJobs = await this.findExpiredClaimedInferenceJobs(maxClaimAgeMs);

      if (expiredJobs.length === 0) {
        return [] as InferenceJobRecord[];
      }

      return this.persistQueueMutation(async () => {
        const requeuedAt = nowIso();
        const requeuedJobs = expiredJobs.map((job) => {
          const requeuedJob: InferenceJobRecord = {
            ...job,
            status: "queued",
            availableAt: requeuedAt,
            updatedAt: requeuedAt,
            workerId: null,
            claimedAt: null,
            completedAt: null,
            lastError: "Inference job claim expired and was requeued.",
          };
          this.repository.setInferenceJob(requeuedJob);
          return cloneCase(requeuedJob);
        });

        return requeuedJobs;
      });
    };

    try {
      return await requeueExpiredJobs();
    } catch (error) {
      if (isConcurrentStoreModificationError(error)) {
        await this.repository.reload();
        return await requeueExpiredJobs();
      }

      throw error;
    }
  }

  async claimNextDeliveryJob(workerId?: string) {
    const worker = typeof workerId === "string" && workerId.trim().length > 0 ? workerId.trim() : "delivery-worker";
    const claimNextAvailableJob = async () => {
      const nextJob = await this.findNextClaimableDeliveryJob();

      if (!nextJob) {
        return null;
      }

      return this.persistQueueMutation(async () => {
        const claimedAt = nowIso();
        const claimedJob: DeliveryJobRecord = {
          ...nextJob,
          status: "claimed",
          attemptCount: nextJob.attemptCount + 1,
          workerId: worker,
          claimedAt,
          updatedAt: claimedAt,
        };
        this.repository.setDeliveryJob(claimedJob);
        return cloneCase(claimedJob);
      });
    };

    try {
      return await claimNextAvailableJob();
    } catch (error) {
      if (isConcurrentStoreModificationError(error)) {
        await this.repository.reload();
        return await claimNextAvailableJob();
      }

      throw error;
    }
  }

  async completeDelivery(caseId: string, input: DeliveryCallbackInput) {
    const record = await this.requireCase(caseId);
    return this.persistExistingCase(record, async () => {
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

      const activeJob = await this.findLatestActiveDeliveryJob(caseId);
      if (!activeJob) {
        throw new WorkflowError(
          409,
          "No active delivery job exists for this case",
          "DELIVERY_JOB_NOT_ACTIVE",
        );
      }

      const completedAt = nowIso();
      this.repository.setDeliveryJob({
        ...activeJob,
        status: input.deliveryStatus,
        attemptCount: activeJob.attemptCount > 0 ? activeJob.attemptCount : 1,
        updatedAt: completedAt,
        claimedAt: activeJob.claimedAt ?? completedAt,
        completedAt,
        workerId: activeJob.workerId ?? "delivery-callback",
        lastError: input.deliveryStatus === "failed" ? input.detail?.trim() ?? "Delivery callback reported failure." : null,
      });

      if (input.deliveryStatus === "delivered") {
        this.transition(
          record,
          "DELIVERED",
          input.detail?.trim().length
            ? `Outbound delivery succeeded: ${input.detail.trim()}`
            : "Outbound delivery succeeded",
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
    const caseRecords = await this.repository.values();
    const operations = caseRecords
      .flatMap((caseRecord) => caseRecord.operationLog.map((entry) => cloneCase(entry)))
      .sort((left, right) => right.at.localeCompare(left.at));
    const deliveryJobs = await this.repository.listDeliveryJobs();
    const inferenceJobs = await this.repository.listInferenceJobs();
    const deliveryJobsByStatus = {
      queued: deliveryJobs.filter((job) => job.status === "queued").length,
      claimed: deliveryJobs.filter((job) => job.status === "claimed").length,
      delivered: deliveryJobs.filter((job) => job.status === "delivered").length,
      failed: deliveryJobs.filter((job) => job.status === "failed").length,
    };
    const inferenceJobsByStatus = {
      queued: inferenceJobs.filter((job) => job.status === "queued").length,
      claimed: inferenceJobs.filter((job) => job.status === "claimed").length,
      completed: inferenceJobs.filter((job) => job.status === "completed").length,
      failed: inferenceJobs.filter((job) => job.status === "failed").length,
    };

    for (const caseRecord of caseRecords) {
      byStatus[caseRecord.status] += 1;
    }

    return {
      totalCases: await this.repository.size(),
      byStatus,
      reviewRequiredCount: byStatus.AWAITING_REVIEW,
      deliveryFailures: byStatus.DELIVERY_FAILED,
      deliveryQueue: {
        totalJobs: deliveryJobs.length,
        byStatus: deliveryJobsByStatus,
        recentJobs: deliveryJobs.slice(0, 20),
      },
      inferenceQueue: {
        totalJobs: inferenceJobs.length,
        byStatus: inferenceJobsByStatus,
        recentJobs: inferenceJobs.slice(0, 20),
      },
      recentOperations: operations.slice(0, 20),
      retryHistory: operations.filter((entry) => entry.operationType === "delivery-retry-requested"),
    };
  }

  async close() {
    await this.repository.close();
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
      studyContext: input.studyContext,
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
      qcSummary: input.qcSummary,
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
    const studyContext = createStudyContextRecord({
      fallbackStudyUid: input.studyUid,
      receivedAt: createdAt,
      source,
      studyContext: input.studyContext,
    });
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
      studyContext,
      qcSummary: createPendingQcSummary(),
      history: [
        {
          from: null,
          to: initialStatus,
          reason,
          at: createdAt,
        },
      ],
      operationLog: [],
      planEnvelope: createPlanEnvelope({
        caseId,
        studyUid: input.studyUid,
        indication: input.indication,
        sequenceInventory: input.sequenceInventory,
        studyContext,
        qcDisposition: "pending",
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
    this.appendOperation(record, {
      caseId,
      operationType: source === "public-api" ? "case-created" : "ingest-received",
      actorType: source === "public-api" ? "system" : "integration",
      source,
      outcome: "accepted",
      detail: reason,
    });
    record.evidenceCards = createEvidenceCards(record);
    return record;
  }

  private async requireCase(caseId: string) {
    const caseRecord = await this.repository.get(caseId);
    if (!caseRecord) {
      throw new WorkflowError(404, `Case ${caseId} not found`, "CASE_NOT_FOUND");
    }
    return caseRecord;
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

    return existing;
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

  private updateDeliveryJob(deliveryJob: DeliveryJobRecord, patch: Partial<DeliveryJobRecord>) {
    const updatedAt = nowIso();
    this.repository.setDeliveryJob({
      ...deliveryJob,
      ...patch,
      updatedAt,
    });
  }

  private completeInferenceJob(activeJob: InferenceJobRecord | null, caseId: string) {
    const completedAt = nowIso();

    this.repository.setInferenceJob({
      ...(activeJob ?? createInferenceJobRecord(caseId)),
      caseId,
      status: "completed",
      attemptCount: activeJob && activeJob.attemptCount > 0 ? activeJob.attemptCount : 1,
      updatedAt: completedAt,
      workerId: activeJob?.workerId ?? "inference-callback",
      claimedAt: activeJob?.claimedAt ?? completedAt,
      completedAt,
      lastError: null,
    });
  }

  private async findLatestActiveDeliveryJob(caseId: string) {
    return (await this.repository
      .listDeliveryJobs())
      .filter((job) => job.caseId === caseId && (job.status === "queued" || job.status === "claimed"))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.enqueuedAt.localeCompare(left.enqueuedAt))[0] ?? null;
  }

  private async findLatestActiveInferenceJob(caseId: string) {
    return (await this.repository
      .listInferenceJobs())
      .filter((job) => job.caseId === caseId && (job.status === "queued" || job.status === "claimed"))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.enqueuedAt.localeCompare(left.enqueuedAt))[0] ?? null;
  }

  private async findNextClaimableDeliveryJob() {
    const claimableAt = nowIso();

    return (await this.repository
      .listDeliveryJobs())
      .filter((job) => job.status === "queued" && job.availableAt.localeCompare(claimableAt) <= 0)
      .sort(
        (left, right) =>
          left.availableAt.localeCompare(right.availableAt) || left.enqueuedAt.localeCompare(right.enqueuedAt),
      )[0] ?? null;
  }

  private async findNextClaimableInferenceJob() {
    const claimableAt = nowIso();

    return (await this.repository
      .listInferenceJobs())
      .filter((job) => job.status === "queued" && job.availableAt.localeCompare(claimableAt) <= 0)
      .sort(
        (left, right) =>
          left.availableAt.localeCompare(right.availableAt) || left.enqueuedAt.localeCompare(right.enqueuedAt),
      )[0] ?? null;
  }

  private async findExpiredClaimedInferenceJobs(maxClaimAgeMs: number) {
    const cutoff = Date.now() - maxClaimAgeMs;

    return (await this.repository.listInferenceJobs())
      .filter((job) => {
        if (job.status !== "claimed" || !job.claimedAt) {
          return false;
        }

        const claimedAtMs = Date.parse(job.claimedAt);
        return Number.isFinite(claimedAtMs) && claimedAtMs <= cutoff;
      })
      .sort((left, right) => left.claimedAt!.localeCompare(right.claimedAt!));
  }

  private async persistNewCase(caseRecord: CaseRecord) {
    const previousDeliveryJobs = (await this.repository.listDeliveryJobs()).map((deliveryJob) => cloneCase(deliveryJob));
    const previousInferenceJobs = (await this.repository.listInferenceJobs()).map((inferenceJob) => cloneCase(inferenceJob));
    this.repository.set(caseRecord);

    try {
      await this.saveSnapshot();
    } catch (error) {
      this.repository.delete(caseRecord.caseId);
      this.repository.replaceDeliveryJobs(previousDeliveryJobs);
      this.repository.replaceInferenceJobs(previousInferenceJobs);
      throw error;
    }
  }

  private async persistExistingCase<T>(caseRecord: CaseRecord, mutate: () => Promise<T> | T) {
    const previous = cloneCase(caseRecord);
    const previousDeliveryJobs = (await this.repository.listDeliveryJobs()).map((deliveryJob) => cloneCase(deliveryJob));
    const previousInferenceJobs = (await this.repository.listInferenceJobs()).map((inferenceJob) => cloneCase(inferenceJob));

    try {
      const result = await mutate();
      this.repository.set(caseRecord);
      await this.saveSnapshot();
      return result;
    } catch (error) {
      this.repository.set(previous);
      this.repository.replaceDeliveryJobs(previousDeliveryJobs);
      this.repository.replaceInferenceJobs(previousInferenceJobs);
      throw error;
    }
  }

  private async persistQueueMutation<T>(mutate: () => Promise<T> | T) {
    const previousDeliveryJobs = (await this.repository.listDeliveryJobs()).map((deliveryJob) => cloneCase(deliveryJob));
    const previousInferenceJobs = (await this.repository.listInferenceJobs()).map((inferenceJob) => cloneCase(inferenceJob));

    try {
      const result = await mutate();
      await this.saveSnapshot();
      return result;
    } catch (error) {
      this.repository.replaceDeliveryJobs(previousDeliveryJobs);
      this.repository.replaceInferenceJobs(previousInferenceJobs);
      throw error;
    }
  }

  private async saveSnapshot() {
    await this.repository.save();
  }
}