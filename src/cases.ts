import { createHash, randomUUID } from "node:crypto";
import {
  ALLOWED_TRANSITIONS,
  createStructuralExecutionEnvelope,
  createArtifactManifest,
  createDraftReport,
  createEvidenceCards,
  createPlanEnvelope,
} from "./case-planning";
import { missingRequiredSequences, nowIso, type DispatchFailureClass, getRetryBackoffSeconds } from "./case-common";
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
} from "./case-imaging";
import {
  getDefaultArtifactStoreRoot,
  persistArtifactPayloads,
  readPersistedArtifact,
} from "./case-artifact-storage";
import {
  CASE_STATUSES,
  WorkflowError,
  type CaseRecord,
  type CaseStatus,
  type CreateCaseInput,
  type DeliveryCallbackInput,
  type DeliveryJobRecord,
  type FinalizeCaseInput,
  type InferenceCallbackInput,
  type InferenceJobRecord,
  type OperationLogEntry,
  type PersistedCaseSnapshot,
  type ReportPayload,
  type ReviewCaseInput,
  type StructuralExecutionContext,
} from "./case-contracts";

export * from "./case-contracts";
export interface MemoryCaseServiceOptions {
  caseStoreFilePath?: string;
  snapshotFilePath?: string;
  storageMode?: CaseStoreMode;
  caseStoreDatabaseUrl?: string;
  caseStoreSchema?: string;
  postgresPoolFactory?: PostgresPoolFactory;
  repository?: CaseRepository;
  artifactStoreRoot?: string;
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

function normalizeNullableString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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
    failureClass: null,
    leaseId: null,
    leaseExpiresAt: null,
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
  const sortedFindings = [...input.findings].sort();
  const sortedArtifacts = [...input.artifacts].sort();
  const sortedMeasurements = normalizeMeasurementSet(input.measurements)
    .sort((a, b) => a.label.localeCompare(b.label) || a.value - b.value);
  const sortedPayloads = (input.artifactPayloads ?? []).map((artifactPayload) => ({
    artifactRef: artifactPayload.artifactRef,
    contentType: artifactPayload.contentType,
    contentDigest: createHash("sha256").update(artifactPayload.contentBase64).digest("hex"),
  })).sort((a, b) => a.artifactRef.localeCompare(b.artifactRef));
  const sortedIssues = [...(input.issues ?? [])].sort();

  return JSON.stringify({
    qcDisposition: input.qcDisposition,
    findings: sortedFindings,
    measurements: sortedMeasurements,
    artifacts: sortedArtifacts,
    executionContext: input.executionContext ?? null,
    artifactPayloads: sortedPayloads,
    issues: sortedIssues,
    generatedSummary: input.generatedSummary ?? null,
  });
}

function isConcurrentStoreModificationError(error: unknown) {
  return error instanceof Error && error.message.includes("Concurrent case store modification detected");
}

export class MemoryCaseService {
  private readonly repository: CaseRepository;
  private readonly artifactStoreRoot: string;

  constructor(private readonly options: MemoryCaseServiceOptions = {}) {
    this.artifactStoreRoot =
      options.artifactStoreRoot ??
      getDefaultArtifactStoreRoot(options.caseStoreFilePath ?? options.snapshotFilePath);

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
    const activeInferenceJob = await this.findLatestActiveInferenceJob(record.caseId);
    const completedAt = nowIso();

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
        record.structuralExecution = createStructuralExecutionEnvelope({
          caseRecord: record,
          inferenceJob: activeInferenceJob,
          executionStatus: "qc-rejected",
          completedAt,
          executionContext: normalizedInput.executionContext,
          artifactIds: [],
        });
        record.qcSummary = createQcSummaryRecord({
          disposition: normalizedInput.qcDisposition,
          checkedAt: nowIso(),
          issues: normalizedInput.issues,
          qcSummary: normalizedInput.qcSummary,
        });
        record.artifactManifest = [];
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
        this.completeInferenceJob(activeInferenceJob, record.caseId);
        record.evidenceCards = createEvidenceCards(record);
        return cloneCase(record);
      }

      record.structuralExecution = createStructuralExecutionEnvelope({
        caseRecord: record,
        inferenceJob: activeInferenceJob,
        executionStatus: "completed",
        completedAt,
        executionContext: normalizedInput.executionContext,
        artifactIds: [],
      });
      record.qcSummary = createQcSummaryRecord({
        disposition: normalizedInput.qcDisposition,
        checkedAt: nowIso(),
        issues: normalizedInput.issues,
        qcSummary: normalizedInput.qcSummary,
      });
      const persistedArtifactPayloads = persistArtifactPayloads({
        artifactStoreRoot: this.artifactStoreRoot,
        caseId: record.caseId,
        artifactPayloads: normalizedInput.artifactPayloads ?? [],
      });
      record.artifactManifest = createArtifactManifest(
        record,
        normalizedInput,
        completedAt,
        persistedArtifactPayloads,
      );
      if (record.structuralExecution) {
        record.structuralExecution.artifactIds = record.artifactManifest.map((artifact) => artifact.artifactId);
      }
      record.planEnvelope.studyContext.qcDisposition = record.qcSummary.disposition;
      record.lastInferenceFingerprint = fingerprint;
      record.report = createDraftReport(record, normalizedInput, completedAt);
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
      this.completeInferenceJob(activeInferenceJob, record.caseId);
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
        const leaseId = randomUUID();
        const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const claimedJob: InferenceJobRecord = {
          ...nextJob,
          status: "claimed",
          attemptCount: nextJob.attemptCount + 1,
          workerId: worker,
          claimedAt,
          updatedAt: claimedAt,
          leaseId,
          leaseExpiresAt,
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

  async renewLease(leaseId: string, extensionMs = 5 * 60 * 1000) {
    const renewInferenceLease = this.repository.renewInferenceLease?.bind(this.repository);

    if (renewInferenceLease) {
      const result = await renewInferenceLease(leaseId, extensionMs);

      if (result.status === "missing") {
        throw new WorkflowError(404, "No active lease found for the given leaseId", "LEASE_NOT_FOUND");
      }

      if (result.status === "expired") {
        throw new WorkflowError(409, "Lease has already expired", "LEASE_EXPIRED");
      }

      return result.job!;
    }

    const inferenceJobs = await this.repository.listInferenceJobs();
    const job = inferenceJobs.find((j) => j.leaseId === leaseId && j.status === "claimed");

    if (!job) {
      throw new WorkflowError(404, "No active lease found for the given leaseId", "LEASE_NOT_FOUND");
    }

    if (job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() < Date.now()) {
      throw new WorkflowError(409, "Lease has already expired", "LEASE_EXPIRED");
    }

    return this.persistQueueMutation(async () => {
      const now = nowIso();
      const newExpiry = new Date(Date.now() + extensionMs).toISOString();
      const updated: InferenceJobRecord = {
        ...job,
        leaseExpiresAt: newExpiry,
        updatedAt: now,
      };
      this.repository.setInferenceJob(updated);
      return cloneCase(updated);
    });
  }

  async failInferenceJob(input: {
    caseId: string;
    leaseId: string;
    failureClass: DispatchFailureClass;
    errorCode: string;
    detail?: string;
  }) {
    const errorMessage = input.detail
      ? `${input.errorCode}: ${input.detail}`
      : input.errorCode;
    const failClaimedInferenceJob = this.repository.failClaimedInferenceJob?.bind(this.repository);

    if (failClaimedInferenceJob) {
      const result = await failClaimedInferenceJob({
        caseId: input.caseId,
        leaseId: input.leaseId,
        failureClass: input.failureClass,
        errorMessage,
      });

      if (result.status === "missing") {
        throw new WorkflowError(404, "No active claimed job found for the given caseId/leaseId", "JOB_NOT_FOUND");
      }

      return {
        failureClass: input.failureClass,
        requeued: result.requeued,
        jobId: result.job!.jobId,
      };
    }

    const inferenceJobs = await this.repository.listInferenceJobs();
    const job = inferenceJobs.find(
      (j) => j.leaseId === input.leaseId && j.caseId === input.caseId && j.status === "claimed",
    );

    if (!job) {
      throw new WorkflowError(404, "No active claimed job found for the given caseId/leaseId", "JOB_NOT_FOUND");
    }

    const now = nowIso();

    if (input.failureClass === "transient") {
      const backoffSeconds = getRetryBackoffSeconds("standard", job.attemptCount);
      const availableAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

      return this.persistQueueMutation(async () => {
        const requeued: InferenceJobRecord = {
          ...job,
          status: "queued",
          availableAt,
          updatedAt: now,
          workerId: null,
          claimedAt: null,
          lastError: errorMessage,
          failureClass: "transient",
          leaseId: null,
          leaseExpiresAt: null,
        };
        this.repository.setInferenceJob(requeued);
        return { failureClass: "transient" as const, requeued: true, jobId: job.jobId };
      });
    }

    // terminal — mark as permanently failed
    return this.persistQueueMutation(async () => {
      const failed: InferenceJobRecord = {
        ...job,
        status: "failed",
        updatedAt: now,
        completedAt: now,
        lastError: errorMessage,
        failureClass: "terminal",
        leaseId: null,
        leaseExpiresAt: null,
      };
      this.repository.setInferenceJob(failed);
      return { failureClass: "terminal" as const, requeued: false, jobId: job.jobId };
    });
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
            leaseId: null,
            leaseExpiresAt: null,
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

    return JSON.parse(
      JSON.stringify({
        ...record.report,
        derivedArtifacts: record.artifactManifest,
      }),
    ) as ReportPayload;
  }

  async getFinalizedReport(caseId: string) {
    const record = await this.requireCase(caseId);

    if (!record.report) {
      throw new WorkflowError(404, "Finalized report is not available for this case", "REPORT_NOT_READY");
    }

    if (record.report.reviewStatus !== "finalized") {
      throw new WorkflowError(404, "Finalized report is not available for this case", "REPORT_NOT_FINALIZED");
    }

    return JSON.parse(
      JSON.stringify({
        ...record.report,
        derivedArtifacts: record.artifactManifest,
      }),
    ) as ReportPayload;
  }

  async getArtifact(caseId: string, artifactId: string) {
    const record = await this.requireCase(caseId);
    const artifact = record.artifactManifest.find((entry) => entry.artifactId === artifactId);

    if (!artifact) {
      throw new WorkflowError(404, "Artifact is not available for this case", "ARTIFACT_NOT_FOUND");
    }

    const persistedArtifact = readPersistedArtifact(artifact.storageUri);

    if (!persistedArtifact) {
      throw new WorkflowError(404, "Artifact content is not available for this case", "ARTIFACT_NOT_AVAILABLE");
    }

    return {
      artifact: cloneCase(artifact),
      content: persistedArtifact.content,
    };
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

    const artifacts = input.artifacts.map((value) => String(value));
    const artifactPayloads = Array.isArray(input.artifactPayloads)
      ? input.artifactPayloads.map((artifactPayload) => ({
          artifactRef: assertNonEmptyString(artifactPayload.artifactRef, "artifactPayload.artifactRef"),
          contentType: assertNonEmptyString(artifactPayload.contentType, "artifactPayload.contentType"),
          contentBase64: assertNonEmptyString(artifactPayload.contentBase64, "artifactPayload.contentBase64"),
        }))
      : [];
    const artifactRefs = new Set(artifacts);

    if (new Set(artifactPayloads.map((artifactPayload) => artifactPayload.artifactRef)).size !== artifactPayloads.length) {
      throw new WorkflowError(400, "artifactPayloads must not contain duplicate artifactRef values", "INVALID_INPUT");
    }

    for (const artifactPayload of artifactPayloads) {
      if (!artifactRefs.has(artifactPayload.artifactRef)) {
        throw new WorkflowError(
          400,
          "artifactPayloads entries must reference values present in artifacts",
          "INVALID_INPUT",
        );
      }
    }

    const computeMode = input.executionContext?.computeMode === "voxel-backed" ? "voxel-backed" : "metadata-fallback";
    const fallbackCode = input.executionContext?.fallbackCode;

    if (
      fallbackCode !== undefined &&
      fallbackCode !== null &&
      fallbackCode !== "missing-volume-input" &&
      fallbackCode !== "volume-download-failed" &&
      fallbackCode !== "volume-parse-failed"
    ) {
      throw new WorkflowError(400, "executionContext.fallbackCode is invalid", "INVALID_INPUT");
    }

    const normalizedExecutionContext: StructuralExecutionContext = {
      computeMode,
      fallbackCode: computeMode === "metadata-fallback" ? fallbackCode ?? null : null,
      fallbackDetail: computeMode === "metadata-fallback" ? normalizeNullableString(input.executionContext?.fallbackDetail) : null,
      sourceSeriesInstanceUid: normalizeNullableString(input.executionContext?.sourceSeriesInstanceUid),
    };

    return {
      qcDisposition: input.qcDisposition,
      findings: input.findings.map((value) => String(value)),
      measurements: input.measurements.map((measurement) => ({
        label: assertNonEmptyString(measurement.label, "measurement.label"),
        value: measurement.value,
        unit: measurement.unit,
      })),
      artifacts,
      artifactPayloads: artifactPayloads.length > 0 ? artifactPayloads : undefined,
      executionContext: normalizedExecutionContext,
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
      structuralExecution: null,
      artifactManifest: [],
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
      failureClass: null,
      leaseId: null,
      leaseExpiresAt: null,
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