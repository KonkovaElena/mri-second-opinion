import { randomUUID } from "node:crypto";
import {
  ALLOWED_TRANSITIONS,
  createDraftReport,
  createEvidenceCards,
  createPlanEnvelope,
} from "./case-planning";
import {
  buildWorkflowAttemptId,
  getRetryBackoffSeconds,
  getRetryPolicy,
  missingRequiredSequences,
  nextMachineDraftVersion,
  nowIso,
  pinFinalizedReleaseVersion,
  pinReviewedReleaseVersion,
  type DispatchFailureClass,
  type ReportVersionPins,
  type WorkflowRetryTier,
} from "./case-common";
import { createArtifactReference, createDefaultArtifactStoreConfig, type ArtifactStoreConfig } from "./artifact-store";
import { type CaseRepository, SnapshotCaseRepository } from "./case-repository";
import { createLocalDispatchQueueAdapter, type DispatchQueueAdapter, type DispatchQueueJob } from "./dispatch-queue";
import type { CaseSummaryProjection } from "./case-projections";
import { getWorkflowPackageManifest, type WorkflowPackageManifest } from "./workflow-packages";

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
export type WorkflowQueueStatus = "queued" | "claimed" | "completed" | "failed";

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
  correlationId?: string;
}

export interface ReviewCaseInput {
  reviewerId: string;
  reviewerRole?: string;
  comments?: string;
  finalImpression?: string;
  correlationId?: string;
}

export interface FinalizeCaseInput {
  clinicianId: string;
  finalSummary?: string;
  deliveryOutcome?: DeliveryOutcome;
  correlationId?: string;
}

export interface DeliveryCallbackInput {
  deliveryStatus: Exclude<DeliveryOutcome, "pending">;
  detail?: string;
  leaseId?: string;
  workerId?: string;
  correlationId?: string;
}

export interface InferenceCallbackInput {
  qcDisposition: QcDisposition;
  findings: string[];
  measurements: Array<{ label: string; value: number; unit?: string }>;
  artifacts: string[];
  issues?: string[];
  generatedSummary?: string;
  leaseId?: string;
  workerId?: string;
  correlationId?: string;
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
  correlationId?: string;
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

export interface JournalStateSnapshot {
  status: CaseStatus;
  queueSummary: Array<{ stage: WorkflowQueueStage; status: WorkflowQueueStatus }>;
  hasReport: boolean;
  reportReviewStatus: string | null;
  reviewerId: string | null;
  finalizedBy: string | null;
}

export interface TransitionJournalEntry {
  journalId: string;
  caseId: string;
  sequence: number;
  transitionType: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
  actor: "system" | "clinician" | "integration";
  source: string;
  detail: string;
  timestamp: string;
  stateSnapshot: JournalStateSnapshot | null;
}

export interface WorkflowQueueEntry {
  queueEntryId: string;
  caseId: string;
  stage: WorkflowQueueStage;
  status: WorkflowQueueStatus;
  attempt: number;
  attemptId: string;
  enqueuedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  leaseId: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  lastHeartbeatAt: string | null;
  claimExpiresAt: string | null;
  retryTier: WorkflowRetryTier;
  maxAttempts: number;
  retryEligibleAt: string;
  failureClass: DispatchFailureClass | null;
  failureCode: string | null;
  deadLetteredAt: string | null;
  detail: string;
  sourceOperation: string;
}

export interface ClaimNextDispatchInput {
  workerId: string;
  stage: WorkflowQueueStage;
  leaseSeconds?: number;
  now?: string;
  correlationId?: string;
}

export interface DispatchClaim {
  leaseId: string;
  workerId: string;
  caseId: string;
  stage: WorkflowQueueStage;
  attempt: number;
  attemptId: string;
  resourceClass: string;
  retryTier: WorkflowRetryTier;
  maxAttempts: number;
  claimedAt: string;
  lastHeartbeatAt: string | null;
  claimExpiresAt: string;
  planEnvelope?: PlanEnvelope;
  studyContext?: StudyContextArtifact;
  workflowPackage?: WorkflowPackageManifest | null;
  requiredArtifacts?: string[];
  report?: ReportPayload | null;
  artifactManifest?: ArtifactManifestEntry[];
  structuralRun?: StructuralRunArtifact | null;
}

export interface ArtifactReference {
  artifactId: string;
  uri: string;
  checksum: string | null;
  mediaType: string;
  sizeBytes: number | null;
  producer: string;
  attemptId: string;
}

export interface RecordDispatchFailureInput {
  leaseId: string;
  stage: "delivery";
  failureClass: DispatchFailureClass;
  failureCode: string;
  detail?: string;
  now?: string;
}

export interface RenewDispatchLeaseInput {
  leaseId: string;
  stage: WorkflowQueueStage;
  workerId: string;
  leaseSeconds?: number;
  now?: string;
  correlationId?: string;
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
  artifactRefs: ArtifactReference[];
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
  artifact: ArtifactReference;
  generatedAt: string;
  workflowVersion: string;
}

export interface ArtifactManifestEntry {
  artifactId: string;
  artifactType: StructuralArtifactType;
  artifact: ArtifactReference;
  producedByPackageId: string;
  producedByPackageVersion: string;
  workflowFamily: WorkflowFamily;
  exportCompatibility: string[];
  generatedAt: string;
}

export interface StructuralExecutionEnvelope {
  executionSchemaVersion: "0.1.0";
  manifestVersion: string;
  branchId: string;
  packageId: string;
  packageVersion: string;
  status: "planned" | "blocked" | "succeeded";
  resourceClass: string;
  dispatchSource: "public-api" | "internal-ingest" | "internal-inference";
  dispatchedAt: string;
  completedAt: string | null;
  artifactIds: string[];
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
  workflowPackage: WorkflowPackageManifest | null;
  qcSummary: QcSummaryArtifact | null;
  findingsPayload: FindingsPayloadArtifact | null;
  structuralExecution: StructuralExecutionEnvelope | null;
  artifactManifest: ArtifactManifestEntry[];
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
  artifacts: ArtifactReference[];
  provenance: {
    workflowVersion: string;
    plannerVersion: string;
    generatedAt: string;
  };
  versionPins: ReportVersionPins;
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
  transitionJournal: TransitionJournalEntry[];
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
  finalizedBy: string | null;
}

export interface MemoryCaseServiceOptions {
  snapshotFilePath?: string;
  repository?: CaseRepository;
  artifactStore?: ArtifactStoreConfig;
  dispatchQueue?: DispatchQueueAdapter;
}

type ReportReviewStatus = ReportPayload["reviewStatus"] | null;

interface CaseStateInvariantRule {
  requiresReport: boolean;
  allowedReportStatuses: readonly ReportReviewStatus[];
  requiredActiveQueueStages: readonly WorkflowQueueStage[];
  allowsReviewerIdentity: boolean;
  allowsFinalizedBy: boolean;
}

const CASE_STATE_INVARIANT_RULES: Record<CaseStatus, CaseStateInvariantRule> = {
  INGESTING: {
    requiresReport: false,
    allowedReportStatuses: [null],
    requiredActiveQueueStages: [],
    allowsReviewerIdentity: false,
    allowsFinalizedBy: false,
  },
  QC_REJECTED: {
    requiresReport: false,
    allowedReportStatuses: [null],
    requiredActiveQueueStages: [],
    allowsReviewerIdentity: false,
    allowsFinalizedBy: false,
  },
  SUBMITTED: {
    requiresReport: false,
    allowedReportStatuses: [null],
    requiredActiveQueueStages: ["inference"],
    allowsReviewerIdentity: false,
    allowsFinalizedBy: false,
  },
  AWAITING_REVIEW: {
    requiresReport: true,
    allowedReportStatuses: ["draft"],
    requiredActiveQueueStages: [],
    allowsReviewerIdentity: false,
    allowsFinalizedBy: false,
  },
  REVIEWED: {
    requiresReport: true,
    allowedReportStatuses: ["reviewed"],
    requiredActiveQueueStages: [],
    allowsReviewerIdentity: true,
    allowsFinalizedBy: false,
  },
  FINALIZED: {
    requiresReport: true,
    allowedReportStatuses: ["finalized"],
    requiredActiveQueueStages: [],
    allowsReviewerIdentity: true,
    allowsFinalizedBy: true,
  },
  DELIVERY_PENDING: {
    requiresReport: true,
    allowedReportStatuses: ["finalized"],
    requiredActiveQueueStages: ["delivery"],
    allowsReviewerIdentity: true,
    allowsFinalizedBy: true,
  },
  DELIVERED: {
    requiresReport: true,
    allowedReportStatuses: ["finalized"],
    requiredActiveQueueStages: [],
    allowsReviewerIdentity: true,
    allowsFinalizedBy: true,
  },
  DELIVERY_FAILED: {
    requiresReport: true,
    allowedReportStatuses: ["finalized"],
    requiredActiveQueueStages: [],
    allowsReviewerIdentity: true,
    allowsFinalizedBy: true,
  },
};

export interface PersistedCaseSnapshot {
  version: "0.1.0" | "0.2.0";
  revision: number;
  cases: CaseRecord[];
  caseSummaries?: CaseSummaryProjection[];
  workflowJobs?: import("./case-projections").WorkflowJobProjection[];
  artifactReferences?: import("./case-projections").ArtifactReferenceProjection[];
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

function normalizeCorrelationId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeWorkflowQueueEntry(entry: WorkflowQueueEntry): WorkflowQueueEntry {
  const retryTier = entry.retryTier ?? "standard";
  const retryPolicy = getRetryPolicy(retryTier);

  return {
    ...entry,
    attemptId: entry.attemptId ?? buildWorkflowAttemptId(entry.stage, entry.attempt),
    resolvedAt: entry.resolvedAt ?? null,
    leaseId: entry.leaseId ?? null,
    claimedBy: entry.claimedBy ?? null,
    claimedAt: entry.claimedAt ?? null,
    lastHeartbeatAt: entry.lastHeartbeatAt ?? null,
    claimExpiresAt: entry.claimExpiresAt ?? null,
    retryTier,
    maxAttempts: entry.maxAttempts ?? retryPolicy.maxAttempts,
    retryEligibleAt: entry.retryEligibleAt ?? entry.enqueuedAt,
    failureClass: entry.failureClass ?? null,
    failureCode: entry.failureCode ?? null,
    deadLetteredAt: entry.deadLetteredAt ?? null,
  };
}

function addLeaseSeconds(timestamp: string, leaseSeconds: number) {
  return new Date(Date.parse(timestamp) + leaseSeconds * 1_000).toISOString();
}

function formatInvariantStages(stages: readonly WorkflowQueueStage[]) {
  return stages.length > 0 ? stages.join(", ") : "none";
}

function assertCaseStateInvariant(caseRecord: CaseRecord) {
  const rule = CASE_STATE_INVARIANT_RULES[caseRecord.status];
  const reportStatus = caseRecord.report?.reviewStatus ?? null;
  const activeQueueStages = caseRecord.workflowQueue
    .filter((entry) => entry.status === "queued" || entry.status === "claimed")
    .map((entry) => entry.stage)
    .sort();
  const requiredStages = [...rule.requiredActiveQueueStages].sort();
  const reviewerId = caseRecord.review.reviewerId.trim();
  const finalizedBy = (caseRecord.finalizedBy ?? "").trim();

  if (Boolean(caseRecord.report) !== rule.requiresReport) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseRecord.caseId}: status ${caseRecord.status} ${rule.requiresReport ? "requires" : "forbids"} a report`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (!rule.allowedReportStatuses.includes(reportStatus)) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseRecord.caseId}: status ${caseRecord.status} requires report reviewStatus in [${rule.allowedReportStatuses.map((value) => value ?? "null").join(", ")}], found ${reportStatus ?? "null"}`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (JSON.stringify(activeQueueStages) !== JSON.stringify(requiredStages)) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseRecord.caseId}: status ${caseRecord.status} requires active queue stages [${formatInvariantStages(requiredStages)}], found [${formatInvariantStages(activeQueueStages)}]`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (rule.allowsReviewerIdentity && reviewerId.length === 0) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseRecord.caseId}: status ${caseRecord.status} requires reviewer identity`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (!rule.allowsReviewerIdentity && reviewerId.length > 0) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseRecord.caseId}: status ${caseRecord.status} forbids reviewer identity before review completes`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (rule.allowsFinalizedBy && finalizedBy.length === 0) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseRecord.caseId}: status ${caseRecord.status} requires finalizedBy`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (!rule.allowsFinalizedBy && finalizedBy.length > 0) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseRecord.caseId}: status ${caseRecord.status} forbids finalizedBy before finalize completes`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }
}

function assertCaseSummaryProjectionInvariant(
  caseSummary: CaseSummaryProjection,
  workflowQueue: WorkflowQueueEntry[],
) {
  const rule = CASE_STATE_INVARIANT_RULES[caseSummary.status];
  const reportStatus = caseSummary.report?.reviewStatus ?? null;
  const activeQueueStages = workflowQueue
    .filter((entry) => entry.status === "queued" || entry.status === "claimed")
    .map((entry) => entry.stage)
    .sort();
  const requiredStages = [...rule.requiredActiveQueueStages].sort();
  const reviewerId = caseSummary.review.reviewerId.trim();
  const finalizedBy = (caseSummary.finalizedBy ?? "").trim();

  if (Boolean(caseSummary.report) !== rule.requiresReport) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseSummary.caseId}: summary status ${caseSummary.status} ${rule.requiresReport ? "requires" : "forbids"} a report projection`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (!rule.allowedReportStatuses.includes(reportStatus)) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseSummary.caseId}: summary status ${caseSummary.status} requires report reviewStatus in [${rule.allowedReportStatuses.map((value) => value ?? "null").join(", ")}], found ${reportStatus ?? "null"}`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (JSON.stringify(activeQueueStages) !== JSON.stringify(requiredStages)) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseSummary.caseId}: summary status ${caseSummary.status} requires active queue stages [${formatInvariantStages(requiredStages)}], found [${formatInvariantStages(activeQueueStages)}]`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (rule.allowsReviewerIdentity && reviewerId.length === 0) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseSummary.caseId}: summary status ${caseSummary.status} requires reviewer identity`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (!rule.allowsReviewerIdentity && reviewerId.length > 0) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseSummary.caseId}: summary status ${caseSummary.status} forbids reviewer identity before review completes`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (rule.allowsFinalizedBy && finalizedBy.length === 0) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseSummary.caseId}: summary status ${caseSummary.status} requires finalizedBy`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }

  if (!rule.allowsFinalizedBy && finalizedBy.length > 0) {
    throw new WorkflowError(
      500,
      `Invariant violation for case ${caseSummary.caseId}: summary status ${caseSummary.status} forbids finalizedBy before finalize completes`,
      "STATE_QUEUE_INVARIANT_VIOLATION",
    );
  }
}

function isClaimExpired(entry: WorkflowQueueEntry, now: string) {
  if (entry.status !== "claimed" || !entry.claimExpiresAt) {
    return false;
  }

  const expiresAt = Date.parse(entry.claimExpiresAt);
  const current = Date.parse(now);

  if (Number.isNaN(expiresAt) || Number.isNaN(current)) {
    return false;
  }

  return expiresAt <= current;
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

function normalizeReportVersionPins(report: ReportPayload): ReportVersionPins {
  const machineDraftVersion = report.versionPins?.machineDraftVersion ?? 1;
  const reviewedReleaseVersion = report.versionPins?.reviewedReleaseVersion
    ?? (report.reviewStatus === "reviewed" || report.reviewStatus === "finalized" ? machineDraftVersion : null);
  const finalizedReleaseVersion = report.versionPins?.finalizedReleaseVersion
    ?? (report.reviewStatus === "finalized" ? reviewedReleaseVersion ?? machineDraftVersion : null);

  return {
    machineDraftVersion,
    reviewedReleaseVersion,
    finalizedReleaseVersion,
  };
}

function normalizeReportPayload(report: ReportPayload): ReportPayload {
  return {
    ...report,
    studyRef: { ...report.studyRef },
    sequenceCoverage: {
      available: [...report.sequenceCoverage.available],
      missingRequired: [...report.sequenceCoverage.missingRequired],
    },
    findings: [...report.findings],
    measurements: report.measurements.map((measurement) => ({ ...measurement })),
    issues: [...report.issues],
    artifacts: report.artifacts.map((artifact) => ({ ...artifact })),
    provenance: { ...report.provenance },
    versionPins: normalizeReportVersionPins(report),
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
    artifactRefs: report.artifacts.map((artifact) => ({ ...artifact })),
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

function buildArtifactManifest(
  manifest: WorkflowPackageManifest,
  artifacts: ArtifactReference[],
  generatedAt: string,
): ArtifactManifestEntry[] {
  return artifacts.map((artifact, index) => ({
    artifactId: artifact.artifactId || `artifact-${index + 1}`,
    artifactType: inferStructuralArtifactType(artifact.uri),
    artifact: { ...artifact },
    producedByPackageId: manifest.packageId,
    producedByPackageVersion: manifest.packageVersion,
    workflowFamily: manifest.workflowFamily,
    exportCompatibility: [...manifest.outputContracts.exportCompatibility],
    generatedAt,
  }));
}

function buildStructuralExecutionEnvelope(input: {
  manifest: WorkflowPackageManifest;
  artifactManifest: ArtifactManifestEntry[];
  dispatchedAt: string;
  completedAt: string | null;
  status: StructuralExecutionEnvelope["status"];
  resourceClass: string;
  dispatchSource: StructuralExecutionEnvelope["dispatchSource"];
}): StructuralExecutionEnvelope {
  return {
    executionSchemaVersion: "0.1.0",
    manifestVersion: input.manifest.manifestSchemaVersion,
    branchId: "structural",
    packageId: input.manifest.packageId,
    packageVersion: input.manifest.packageVersion,
    status: input.status,
    resourceClass: input.resourceClass,
    dispatchSource: input.dispatchSource,
    dispatchedAt: input.dispatchedAt,
    completedAt: input.completedAt,
    artifactIds: input.artifactManifest.map((artifact) => artifact.artifactId),
  };
}

function buildStructuralRunFromExecution(
  execution: StructuralExecutionEnvelope | null,
  artifactManifest: ArtifactManifestEntry[],
): StructuralRunArtifact | null {
  if (!execution) {
    return null;
  }

  return {
    packageId: execution.packageId,
    packageVersion: execution.packageVersion,
    status: execution.status === "blocked" ? "blocked" : "succeeded",
    artifacts: artifactManifest.map((artifact) => ({
      artifactType: artifact.artifactType,
      artifact: { ...artifact.artifact },
      generatedAt: artifact.generatedAt,
      workflowVersion: `${artifact.producedByPackageId}@${artifact.producedByPackageVersion}`,
    })),
    completedAt: execution.completedAt ?? execution.dispatchedAt,
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
  return {
    packageId: packageId || caseRecord.planEnvelope.packageResolution.selectedPackage || "brain-structural-fastsurfer",
    packageVersion,
    status: "succeeded",
    artifacts: caseRecord.report.artifacts.map((artifact) => ({
      artifactType: inferStructuralArtifactType(artifact.uri),
      artifact: { ...artifact },
      generatedAt: caseRecord.report!.provenance.generatedAt,
      workflowVersion,
    })),
    completedAt: caseRecord.report.provenance.generatedAt,
  };
}

function buildWorkflowPackageFromCase(caseRecord: CaseRecord): WorkflowPackageManifest | null {
  return getWorkflowPackageManifest(caseRecord.planEnvelope.packageResolution.selectedPackage);
}

function buildArtifactAttemptId(caseRecord: CaseRecord, stage: WorkflowQueueStage) {
  const latestAttempt = caseRecord.workflowQueue
    .filter((entry) => entry.stage === stage)
    .sort((left, right) => right.attempt - left.attempt)[0];

  return latestAttempt?.attemptId ?? buildWorkflowAttemptId(stage, 1);
}

function buildArtifactReferences(
  storageRefs: string[],
  artifactStore: ArtifactStoreConfig,
  producer: string,
  attemptId: string,
): ArtifactReference[] {
  return Array.from(new Set(storageRefs)).map((storageRef, index) => {
    const artifactType = inferStructuralArtifactType(storageRef);

    return createArtifactReference({
      artifactId: `artifact-${index + 1}`,
      artifactType,
      storageRef,
      producer,
      attemptId,
      artifactStore,
    });
  });
}

function normalizeWorkerArtifacts(caseRecord: CaseRecord): WorkerArtifacts {
  const persisted = caseRecord.workerArtifacts;
  const workflowPackage = persisted?.workflowPackage
    ? {
        ...persisted.workflowPackage,
        requiredSequences: [...persisted.workflowPackage.requiredSequences],
        optionalSequences: [...persisted.workflowPackage.optionalSequences],
        outputContracts: {
          ...persisted.workflowPackage.outputContracts,
          findings: [...persisted.workflowPackage.outputContracts.findings],
          artifacts: [...persisted.workflowPackage.outputContracts.artifacts],
          exportCompatibility: [...persisted.workflowPackage.outputContracts.exportCompatibility],
        },
        knownFailureModes: [...persisted.workflowPackage.knownFailureModes],
        operatorWarnings: [...persisted.workflowPackage.operatorWarnings],
      }
    : buildWorkflowPackageFromCase(caseRecord);
  const artifactManifest = persisted?.artifactManifest
    ? persisted.artifactManifest.map((artifact) => ({
        ...artifact,
        artifact: { ...artifact.artifact },
        exportCompatibility: [...artifact.exportCompatibility],
      }))
    : workflowPackage && caseRecord.report
      ? buildArtifactManifest(workflowPackage, caseRecord.report.artifacts, caseRecord.report.provenance.generatedAt)
      : [];
  const structuralExecution = persisted?.structuralExecution
    ? {
        ...persisted.structuralExecution,
        artifactIds: [...persisted.structuralExecution.artifactIds],
      }
    : workflowPackage && caseRecord.report
      ? buildStructuralExecutionEnvelope({
          manifest: workflowPackage,
          artifactManifest,
          dispatchedAt: caseRecord.planEnvelope.provenance.createdAt,
          completedAt: caseRecord.report.provenance.generatedAt,
          status: "succeeded",
          resourceClass: caseRecord.planEnvelope.dispatchProfile.resourceClass,
          dispatchSource: "internal-inference",
        })
      : null;
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
    workflowPackage,
    qcSummary: persisted?.qcSummary
      ? {
          ...persisted.qcSummary,
          issues: [...persisted.qcSummary.issues],
          artifactRefs: persisted.qcSummary.artifactRefs.map((artifact) => ({ ...artifact })),
        }
      : buildQcSummaryFromReport(caseRecord.report),
    findingsPayload: persisted?.findingsPayload
      ? {
          ...persisted.findingsPayload,
          findings: [...persisted.findingsPayload.findings],
          measurements: persisted.findingsPayload.measurements.map((measurement) => ({ ...measurement })),
        }
      : buildFindingsPayloadFromReport(caseRecord.report),
    structuralExecution,
    artifactManifest,
    structuralRun: persisted?.structuralRun
      ? {
          ...persisted.structuralRun,
          artifacts: persisted.structuralRun.artifacts.map((artifact) => ({
            ...artifact,
            artifact: { ...artifact.artifact },
          })),
        }
      : buildStructuralRunFromExecution(structuralExecution, artifactManifest) ?? buildStructuralRunFromReport(caseRecord),
  };
}

function normalizeCaseRecordShape(caseRecord: CaseRecord): CaseRecord {
  const normalized = {
    ...caseRecord,
    finalizedBy: caseRecord.finalizedBy ?? null,
    report: caseRecord.report ? normalizeReportPayload(caseRecord.report) : null,
    transitionJournal: Array.isArray(caseRecord.transitionJournal)
      ? caseRecord.transitionJournal
      : [],
    workflowQueue: Array.isArray(caseRecord.workflowQueue)
      ? caseRecord.workflowQueue.map(normalizeWorkflowQueueEntry)
      : [],
    workerArtifacts: normalizeWorkerArtifacts(caseRecord),
  };

  assertCaseStateInvariant(normalized);

  return normalized;
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
  private readonly artifactStore: ArtifactStoreConfig;
  private readonly dispatchQueue: DispatchQueueAdapter;

  constructor(private readonly options: MemoryCaseServiceOptions = {}) {
    this.repository = options.repository ?? new SnapshotCaseRepository(options);
    this.artifactStore = options.artifactStore ?? createDefaultArtifactStoreConfig();
    this.dispatchQueue = options.dispatchQueue ?? createLocalDispatchQueueAdapter(this.repository);
  }

  async listCases() {
    const cases = await this.repository.listSummaries();
    return cases.map(cloneCase);
  }

  async getCase(caseId: string) {
    return cloneCase(await this.requireCase(caseId));
  }

  async getCaseSummary(caseId: string) {
    return cloneCase(await this.requireCaseSummary(caseId));
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
    const queuedEntry = this.enqueueQueueEntry(record, "inference", "case-created", "Case queued for inference.");
    record.evidenceCards = createEvidenceCards(record);
    await this.persistNewCase(record);
    await this.enqueueDispatchJobs(this.selectQueuedEntries(record, [queuedEntry.queueEntryId]));
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
    this.transition(initial, nextStatus, nextReason, {
      transitionType: nextStatus === "SUBMITTED" ? "ingest-accepted" : "ingest-rejected",
      actor: "integration",
      source: "internal-ingest",
    });
    this.appendOperation(initial, {
      caseId: initial.caseId,
      correlationId: normalized.correlationId,
      operationType: nextStatus === "SUBMITTED" ? "ingest-accepted" : "ingest-rejected",
      actorType: "integration",
      source: "internal-ingest",
      outcome: nextStatus === "SUBMITTED" ? "accepted" : "blocked",
      detail: nextReason,
    });
    const queuedEntry =
      nextStatus === "SUBMITTED"
        ? this.enqueueQueueEntry(initial, "inference", "ingest-accepted", "Case queued for inference.")
        : null;
    initial.evidenceCards = createEvidenceCards(initial);
    await this.persistNewCase(initial);
    await this.enqueueDispatchJobs(this.selectQueuedEntries(initial, queuedEntry ? [queuedEntry.queueEntryId] : []));

    return cloneCase(initial);
  }

  async completeInference(caseId: string, input: InferenceCallbackInput) {
    const record = await this.requireCase(caseId);
    const normalizedInput = this.normalizeInferenceInput(input);
    const fingerprint = createInferenceFingerprint(normalizedInput);

    return this.persistExistingCase(record, async (record) => {
      const claimedQueueEntry = this.requireLeaseBoundQueueEntry(
        record,
        "inference",
        normalizedInput.leaseId,
        normalizedInput.workerId,
      );

      if (record.status !== "SUBMITTED") {
        if (record.report?.versionPins.finalizedReleaseVersion !== null) {
          if (record.lastInferenceFingerprint === fingerprint) {
            this.appendOperation(record, {
              caseId: record.caseId,
              correlationId: normalizedInput.correlationId,
              operationType: "inference-replayed",
              actorType: "integration",
              source: "internal-inference",
              outcome: "replayed",
              detail: "Duplicate inference callback ignored because finalized release is already pinned.",
            });
            this.appendJournal(record, {
              transitionType: "inference-replayed",
              fromStatus: record.status,
              toStatus: record.status,
              actor: "integration",
              source: "internal-inference",
              detail: "Duplicate inference callback ignored because finalized release is already pinned.",
            });
            return cloneCase(record);
          }

          throw new WorkflowError(
            409,
            "Finalized release is pinned and cannot be replaced by a later machine rerun",
            "FINALIZED_RELEASE_PINNED",
          );
        }

        if (record.lastInferenceFingerprint === fingerprint) {
          this.appendOperation(record, {
            caseId: record.caseId,
            correlationId: normalizedInput.correlationId,
            operationType: "inference-replayed",
            actorType: "integration",
            source: "internal-inference",
            outcome: "replayed",
            detail: "Duplicate inference callback ignored because draft output already exists.",
          });
          this.appendJournal(record, {
            transitionType: "inference-replayed",
            fromStatus: record.status,
            toStatus: record.status,
            actor: "integration",
            source: "internal-inference",
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
        const workflowPackage = getWorkflowPackageManifest(record.planEnvelope.packageResolution.selectedPackage);
        const qcGeneratedAt = nowIso();
        const artifactReferences = buildArtifactReferences(
          normalizedInput.artifacts,
          this.artifactStore,
          workflowPackage?.packageId ?? "internal-inference",
          buildArtifactAttemptId(record, "inference"),
        );
        const artifactManifest = workflowPackage
          ? buildArtifactManifest(workflowPackage, artifactReferences, qcGeneratedAt)
          : [];
        record.lastInferenceFingerprint = fingerprint;
        record.workerArtifacts.workflowPackage = workflowPackage;
        record.workerArtifacts.qcSummary = {
          disposition: normalizedInput.qcDisposition,
          summary: normalizedInput.generatedSummary ?? "QC gate rejected the study.",
          issues: [...(normalizedInput.issues ?? [])],
          artifactRefs: artifactReferences.map((artifact) => ({ ...artifact })),
          generatedAt: qcGeneratedAt,
        };
        record.workerArtifacts.findingsPayload = null;
        record.workerArtifacts.artifactManifest = artifactManifest;
        record.workerArtifacts.structuralExecution = workflowPackage
          ? buildStructuralExecutionEnvelope({
              manifest: workflowPackage,
              artifactManifest,
              dispatchedAt: record.planEnvelope.provenance.createdAt,
              completedAt: qcGeneratedAt,
              status: "blocked",
              resourceClass: record.planEnvelope.dispatchProfile.resourceClass,
              dispatchSource: "internal-inference",
            })
          : null;
        record.workerArtifacts.structuralRun = buildStructuralRunFromExecution(
          record.workerArtifacts.structuralExecution,
          artifactManifest,
        );
        if (claimedQueueEntry) {
          this.resolveQueueEntry(claimedQueueEntry, "completed", "Inference completed with QC rejection.");
        } else {
          this.resolveLatestQueueEntry(record, "inference", "completed", "Inference completed with QC rejection.");
        }
        this.transition(record, "QC_REJECTED", "QC gate rejected the study", {
          transitionType: "inference-rejected",
          actor: "integration",
          source: "internal-inference",
        });
        this.appendOperation(record, {
          caseId: record.caseId,
          correlationId: normalizedInput.correlationId,
          operationType: "inference-rejected",
          actorType: "integration",
          source: "internal-inference",
          outcome: "blocked",
          detail: "Inference callback marked the study as QC rejected.",
        });
        record.evidenceCards = createEvidenceCards(record);
        return cloneCase(record);
      }

      const workflowPackage = getWorkflowPackageManifest(record.planEnvelope.packageResolution.selectedPackage);
      const reportGeneratedAt = nowIso();
      const machineDraftVersion = nextMachineDraftVersion(record.report?.versionPins);
      const artifactReferences = buildArtifactReferences(
        normalizedInput.artifacts,
        this.artifactStore,
        workflowPackage?.packageId ?? "internal-inference",
        buildArtifactAttemptId(record, "inference"),
      );
      const artifactManifest = workflowPackage
        ? buildArtifactManifest(workflowPackage, artifactReferences, reportGeneratedAt)
        : [];
      record.lastInferenceFingerprint = fingerprint;
      record.report = createDraftReport(
        record,
        normalizedInput,
        artifactReferences,
        workflowPackage
          ? `${workflowPackage.packageId}@${workflowPackage.packageVersion}`
          : `${record.planEnvelope.packageResolution.selectedPackage ?? "brain-structural-fastsurfer"}@0.1.0`,
        {
          machineDraftVersion,
          reviewedReleaseVersion: null,
          finalizedReleaseVersion: null,
        },
        reportGeneratedAt,
      );
      record.workerArtifacts.workflowPackage = workflowPackage;
      record.workerArtifacts.qcSummary = buildQcSummaryFromReport(record.report);
      record.workerArtifacts.findingsPayload = buildFindingsPayloadFromReport(record.report);
      record.workerArtifacts.artifactManifest = artifactManifest;
      record.workerArtifacts.structuralExecution = workflowPackage
        ? buildStructuralExecutionEnvelope({
            manifest: workflowPackage,
            artifactManifest,
            dispatchedAt: record.planEnvelope.provenance.createdAt,
            completedAt: reportGeneratedAt,
            status: "succeeded",
            resourceClass: record.planEnvelope.dispatchProfile.resourceClass,
            dispatchSource: "internal-inference",
          })
        : null;
      record.workerArtifacts.structuralRun = buildStructuralRunFromExecution(
        record.workerArtifacts.structuralExecution,
        artifactManifest,
      ) ?? buildStructuralRunFromReport(record);
      if (claimedQueueEntry) {
        this.resolveQueueEntry(claimedQueueEntry, "completed", "Inference completed and draft prepared.");
      } else {
        this.resolveLatestQueueEntry(record, "inference", "completed", "Inference completed and draft prepared.");
      }
      record.planEnvelope.branches = record.planEnvelope.branches.map((branch) => ({
        ...branch,
        status: branch.status === "blocked" ? branch.status : "succeeded",
      }));
      this.transition(record, "AWAITING_REVIEW", "Inference completed and draft prepared", {
        transitionType: "inference-completed",
        actor: "integration",
        source: "internal-inference",
      });
      this.appendOperation(record, {
        caseId: record.caseId,
        correlationId: normalizedInput.correlationId,
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
        correlationId: normalizeCorrelationId(input.correlationId),
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
      record.report.versionPins = pinReviewedReleaseVersion(record.report.versionPins.machineDraftVersion);
      record.report.reviewStatus = "reviewed";
      if (normalized.finalImpression) {
        record.report.finalImpression = normalized.finalImpression;
      }
      if (normalized.comments) {
        record.report.issues = Array.from(new Set([...record.report.issues, normalized.comments]));
      }

      this.transition(record, "REVIEWED", "Clinician review completed", {
        transitionType: "clinician-reviewed",
        actor: "clinician",
        source: "public-review",
      });
      this.appendOperation(record, {
        caseId: record.caseId,
        correlationId: normalized.correlationId,
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

  async finalizeCase(caseId: string, input: FinalizeCaseInput) {
    const record = await this.requireCase(caseId);
    let deliveryQueueEntryId: string | null = null;
    const finalized = await this.persistExistingCase(record, async (record) => {
      this.assertStatus(record, ["REVIEWED"]);

      const clinicianId = assertNonEmptyString(input.clinicianId, "clinicianId");
      const correlationId = normalizeCorrelationId(input.correlationId);

      if (!record.report) {
        throw new WorkflowError(409, "Report draft is not available", "REPORT_NOT_READY");
      }

      if (record.report.versionPins.reviewedReleaseVersion === null) {
        throw new WorkflowError(409, "Reviewed release version is not pinned", "REVIEW_VERSION_NOT_PINNED");
      }

      if (typeof input.finalSummary === "string" && input.finalSummary.trim().length > 0) {
        record.report.processingSummary = input.finalSummary.trim();
      }
      record.report.versionPins = pinFinalizedReleaseVersion(record.report.versionPins);
      record.report.reviewStatus = "finalized";
      record.finalizedBy = clinicianId;

      const deliveryOutcome = input.deliveryOutcome ?? "pending";

      this.transition(record, "FINALIZED", `Final clinical summary locked by ${clinicianId}`, {
        transitionType: "case-finalized",
        actor: "clinician",
        source: "public-finalize",
      });
      this.appendOperation(record, {
        caseId: record.caseId,
        correlationId,
        operationType: "case-finalized",
        actorType: "clinician",
        source: "public-finalize",
        outcome: "completed",
        detail: `Final review state locked by ${clinicianId}.`,
      });
      this.transition(record, "DELIVERY_PENDING", "Report queued for outbound delivery", {
        transitionType: "delivery-queued",
        actor: "system",
        source: "public-finalize",
      });
      this.appendOperation(record, {
        caseId: record.caseId,
        correlationId,
        operationType: "delivery-queued",
        actorType: "system",
        source: "public-finalize",
        outcome: "accepted",
        detail: "Report queued for outbound delivery.",
      });
      deliveryQueueEntryId = this.enqueueQueueEntry(
        record,
        "delivery",
        "delivery-queued",
        "Report queued for outbound delivery.",
      ).queueEntryId;

      if (deliveryOutcome === "failed") {
        this.transition(record, "DELIVERY_FAILED", "Outbound delivery failed", {
          transitionType: "delivery-failed",
          actor: "system",
          source: "public-finalize",
        });
        this.resolveLatestQueueEntry(record, "delivery", "failed", "Simulated outbound delivery failure recorded at finalize time.");
        this.appendOperation(record, {
          caseId: record.caseId,
          correlationId,
          operationType: "delivery-failed",
          actorType: "system",
          source: "public-finalize",
          outcome: "failed",
          detail: "Simulated outbound delivery failure recorded at finalize time.",
        });
      } else if (deliveryOutcome === "delivered") {
        this.transition(record, "DELIVERED", "Outbound delivery succeeded", {
          transitionType: "delivery-succeeded",
          actor: "system",
          source: "public-finalize",
        });
        this.resolveLatestQueueEntry(record, "delivery", "completed", "Simulated outbound delivery success recorded at finalize time.");
        this.appendOperation(record, {
          caseId: record.caseId,
          correlationId,
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

    if (deliveryQueueEntryId) {
      await this.enqueueDispatchJobs(this.selectQueuedEntries(finalized, [deliveryQueueEntryId]));
    }

    return finalized;
  }

  async retryDelivery(caseId: string, correlationId?: string) {
    const record = await this.requireCase(caseId);
    let deliveryQueueEntryId: string | null = null;
    const retried = await this.persistExistingCase(record, async (record) => {
      this.assertStatus(record, ["DELIVERY_FAILED"]);
      const latestDeliveryAttempt = [...record.workflowQueue]
        .reverse()
        .find((entry) => entry.stage === "delivery" && entry.status === "failed");

      if (latestDeliveryAttempt?.deadLetteredAt) {
        throw new WorkflowError(
          409,
          "Delivery is dead-lettered and cannot be retried from the public API",
          "DELIVERY_DEAD_LETTERED",
        );
      }

      this.transition(record, "DELIVERY_PENDING", "Delivery retry requested", {
        transitionType: "delivery-retry-requested",
        actor: "system",
        source: "public-api",
      });
      this.appendOperation(record, {
        caseId: record.caseId,
        correlationId: normalizeCorrelationId(correlationId),
        operationType: "delivery-retry-requested",
        actorType: "system",
        source: "public-api",
        outcome: "accepted",
        detail: "Delivery retry requested from public API.",
      });
      deliveryQueueEntryId = this.enqueueQueueEntry(
        record,
        "delivery",
        "delivery-retry-requested",
        "Delivery retry requested from public API.",
      ).queueEntryId;
      record.evidenceCards = createEvidenceCards(record);
      return cloneCase(record);
    });

    if (deliveryQueueEntryId) {
      await this.enqueueDispatchJobs(this.selectQueuedEntries(retried, [deliveryQueueEntryId]));
    }

    return retried;
  }

  async recordDispatchFailure(caseId: string, input: RecordDispatchFailureInput) {
    const leaseId = assertNonEmptyString(input.leaseId, "leaseId");
    const failureCode = assertNonEmptyString(input.failureCode, "failureCode");
    const failureAt = input.now ?? nowIso();
    const record = await this.requireCase(caseId);
    let requeuedQueueEntryId: string | null = null;

    const updated = await this.persistExistingCase(record, async (workingCopy) => {
      const queueEntry = workingCopy.workflowQueue.find(
        (entry) => entry.stage === input.stage && entry.status === "claimed" && entry.leaseId === leaseId,
      );

      if (!queueEntry) {
        throw new WorkflowError(409, "Dispatch lease is not active for this case", "DISPATCH_LEASE_NOT_ACTIVE");
      }

      const retryDelaySeconds = getRetryBackoffSeconds(queueEntry.retryTier, queueEntry.attempt);
      const failureDetail = input.detail?.trim().length
        ? input.detail.trim()
        : `${input.stage} dispatch ${input.failureClass} failure (${failureCode}).`;
      const shouldRetry = input.failureClass === "transient" && queueEntry.attempt < queueEntry.maxAttempts;

      queueEntry.status = "failed";
      queueEntry.updatedAt = failureAt;
      queueEntry.resolvedAt = failureAt;
      queueEntry.leaseId = null;
      queueEntry.claimedBy = null;
      queueEntry.claimedAt = null;
      queueEntry.claimExpiresAt = null;
      queueEntry.failureClass = input.failureClass;
      queueEntry.failureCode = failureCode;
      queueEntry.deadLetteredAt = shouldRetry ? null : failureAt;
      queueEntry.detail = shouldRetry
        ? `${failureDetail} Retry scheduled in ${retryDelaySeconds}s.`
        : `${failureDetail} Delivery moved to dead-letter.`;

      if (shouldRetry) {
        const retryEligibleAt = addLeaseSeconds(failureAt, retryDelaySeconds);
        requeuedQueueEntryId = this.enqueueQueueEntry(
          workingCopy,
          "delivery",
          "delivery-retry-scheduled",
          `Delivery retry scheduled in ${retryDelaySeconds}s after ${failureCode}.`,
          { retryEligibleAt },
        ).queueEntryId;
        this.appendOperation(workingCopy, {
          caseId: workingCopy.caseId,
          operationType: "delivery-retry-scheduled",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "accepted",
          detail: `Delivery retry ${requeuedQueueEntryId} scheduled after ${failureCode}.`,
        });
        this.appendJournal(workingCopy, {
          transitionType: "delivery-retry-scheduled",
          fromStatus: workingCopy.status,
          toStatus: workingCopy.status,
          actor: "integration",
          source: "internal-delivery",
          detail: `Delivery retry scheduled in ${retryDelaySeconds}s after ${failureCode}.`,
        });
      } else {
        this.transition(
          workingCopy,
          "DELIVERY_FAILED",
          `Delivery moved to dead-letter after attempt ${queueEntry.attempt} (${failureCode})`,
          {
            transitionType: "delivery-dead-lettered",
            actor: "integration",
            source: "internal-delivery",
          },
        );
        this.appendOperation(workingCopy, {
          caseId: workingCopy.caseId,
          operationType: "delivery-dead-lettered",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "failed",
          detail: `Delivery dead-lettered after attempt ${queueEntry.attempt} (${failureCode}).`,
        });
      }

      workingCopy.evidenceCards = createEvidenceCards(workingCopy);

      return cloneCase(workingCopy);
    });

    if (requeuedQueueEntryId) {
      await this.enqueueDispatchJobs(this.selectQueuedEntries(updated, [requeuedQueueEntryId]));
    }

    return updated;
  }

  async renewDispatchLease(caseId: string, input: RenewDispatchLeaseInput) {
    const leaseId = assertNonEmptyString(input.leaseId, "leaseId");
    const workerId = assertNonEmptyString(input.workerId, "workerId");
    const leaseSeconds =
      typeof input.leaseSeconds === "number" && Number.isFinite(input.leaseSeconds)
        ? Math.max(1, Math.floor(input.leaseSeconds))
        : 300;
    const heartbeatAt = input.now ?? nowIso();
    const record = await this.requireCase(caseId);

    return this.persistExistingCase(record, async (workingCopy) => {
      const queueEntry = this.requireLeaseBoundQueueEntry(workingCopy, input.stage, leaseId, workerId, heartbeatAt);

      if (!queueEntry) {
        throw new WorkflowError(409, "Dispatch lease is not active for this case", "DISPATCH_LEASE_NOT_ACTIVE");
      }

      queueEntry.lastHeartbeatAt = heartbeatAt;
      queueEntry.claimExpiresAt = addLeaseSeconds(heartbeatAt, leaseSeconds);
      queueEntry.updatedAt = heartbeatAt;
      queueEntry.detail = `Dispatch lease renewed by ${workerId}.`;

      this.appendOperation(workingCopy, {
        caseId: workingCopy.caseId,
        correlationId: normalizeCorrelationId(input.correlationId),
        operationType: `${input.stage}-dispatch-heartbeat`,
        actorType: "integration",
        source: input.stage === "inference" ? "internal-inference" : "internal-delivery",
        outcome: "accepted",
        detail: `Dispatch lease ${leaseId} renewed by ${workerId}.`,
      });
      this.appendJournal(workingCopy, {
        transitionType: `${input.stage}-dispatch-heartbeat`,
        fromStatus: workingCopy.status,
        toStatus: workingCopy.status,
        actor: "integration",
        source: input.stage === "inference" ? "internal-inference" : "internal-delivery",
        detail: `Dispatch lease ${leaseId} renewed by ${workerId}.`,
      });
      workingCopy.evidenceCards = createEvidenceCards(workingCopy);

      return this.buildDispatchClaim(workingCopy, queueEntry, workerId);
    });
  }

  async completeDelivery(caseId: string, input: DeliveryCallbackInput) {
    const record = await this.requireCase(caseId);
    const normalizedInput = this.normalizeDeliveryInput(input);

    return this.persistExistingCase(record, async (record) => {
      const claimedQueueEntry = this.requireLeaseBoundQueueEntry(
        record,
        "delivery",
        normalizedInput.leaseId,
        normalizedInput.workerId,
      );

      if (record.status === "DELIVERED" && normalizedInput.deliveryStatus === "delivered") {
        this.appendOperation(record, {
          caseId: record.caseId,
          correlationId: normalizedInput.correlationId,
          operationType: "delivery-replayed",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "replayed",
          detail: normalizedInput.detail?.trim().length
            ? normalizedInput.detail.trim()
            : "Duplicate delivery success callback acknowledged.",
        });
        this.appendJournal(record, {
          transitionType: "delivery-replayed",
          fromStatus: record.status,
          toStatus: record.status,
          actor: "integration",
          source: "internal-delivery",
          detail: normalizedInput.detail?.trim().length
            ? normalizedInput.detail.trim()
            : "Duplicate delivery success callback acknowledged.",
        });
        return cloneCase(record);
      }

      if (record.status === "DELIVERY_FAILED" && normalizedInput.deliveryStatus === "failed") {
        this.appendOperation(record, {
          caseId: record.caseId,
          correlationId: normalizedInput.correlationId,
          operationType: "delivery-replayed",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "replayed",
          detail: normalizedInput.detail?.trim().length
            ? normalizedInput.detail.trim()
            : "Duplicate delivery failure callback acknowledged.",
        });
        this.appendJournal(record, {
          transitionType: "delivery-replayed",
          fromStatus: record.status,
          toStatus: record.status,
          actor: "integration",
          source: "internal-delivery",
          detail: normalizedInput.detail?.trim().length
            ? normalizedInput.detail.trim()
            : "Duplicate delivery failure callback acknowledged.",
        });
        return cloneCase(record);
      }

      this.assertStatus(record, ["DELIVERY_PENDING"]);

      if (normalizedInput.deliveryStatus === "delivered") {
        this.transition(
          record,
          "DELIVERED",
          normalizedInput.detail?.trim().length
            ? `Outbound delivery succeeded: ${normalizedInput.detail.trim()}`
            : "Outbound delivery succeeded",
          {
            transitionType: "delivery-succeeded",
            actor: "integration",
            source: "internal-delivery",
          },
        );
        if (claimedQueueEntry) {
          this.resolveQueueEntry(
            claimedQueueEntry,
            "completed",
            normalizedInput.detail?.trim().length ? normalizedInput.detail.trim() : "Delivery callback confirmed success.",
          );
        } else {
          this.resolveLatestQueueEntry(
            record,
            "delivery",
            "completed",
            normalizedInput.detail?.trim().length ? normalizedInput.detail.trim() : "Delivery callback confirmed success.",
          );
        }
        this.appendOperation(record, {
          caseId: record.caseId,
          correlationId: normalizedInput.correlationId,
          operationType: "delivery-succeeded",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "completed",
          detail: normalizedInput.detail?.trim().length
            ? normalizedInput.detail.trim()
            : "Delivery callback confirmed success.",
        });
      } else {
        this.transition(
          record,
          "DELIVERY_FAILED",
          normalizedInput.detail?.trim().length
            ? `Outbound delivery failed: ${normalizedInput.detail.trim()}`
            : "Outbound delivery failed",
          {
            transitionType: "delivery-failed",
            actor: "integration",
            source: "internal-delivery",
          },
        );
        if (claimedQueueEntry) {
          this.resolveQueueEntry(
            claimedQueueEntry,
            "failed",
            normalizedInput.detail?.trim().length ? normalizedInput.detail.trim() : "Delivery callback reported failure.",
          );
        } else {
          this.resolveLatestQueueEntry(
            record,
            "delivery",
            "failed",
            normalizedInput.detail?.trim().length ? normalizedInput.detail.trim() : "Delivery callback reported failure.",
          );
        }
        this.appendOperation(record, {
          caseId: record.caseId,
          correlationId: normalizedInput.correlationId,
          operationType: "delivery-failed",
          actorType: "integration",
          source: "internal-delivery",
          outcome: "failed",
          detail: normalizedInput.detail?.trim().length
            ? normalizedInput.detail.trim()
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
    const now = nowIso();
    const summaries = await this.repository.listSummaries();
    const workflowJobs = await this.repository.listWorkflowJobs();
    const workflowJobsByCaseId = new Map(workflowJobs.map((projection) => [projection.caseId, projection.jobs]));
    const operations = summaries
      .flatMap((caseRecord) => caseRecord.operationLog.map((entry) => cloneCase(entry)))
      .sort((left, right) => right.at.localeCompare(left.at));
    const queueEntries = workflowJobs
      .flatMap((projection) => projection.jobs.map((entry) => cloneCase(entry)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const activeQueue = queueEntries.filter((entry) => entry.status === "queued" || entry.status === "claimed");
    const queuedEntries = queueEntries.filter((entry) => entry.status === "queued");
    const claimedEntries = queueEntries.filter((entry) => entry.status === "claimed");
    const abandonedEntries = claimedEntries.filter((entry) => isClaimExpired(entry, now));
    const inFlightEntries = claimedEntries.filter((entry) => !isClaimExpired(entry, now));
    const deadLetterEntries = queueEntries.filter((entry) => entry.deadLetteredAt !== null);
    const retryEntries = queueEntries.filter(
      (entry) => entry.stage === "delivery" && entry.attempt > 1 && (entry.status === "queued" || entry.status === "claimed"),
    );
    const activeWorkerIds = Array.from(new Set(inFlightEntries.map((entry) => entry.claimedBy).filter((value): value is string => typeof value === "string" && value.length > 0)));
    const inferenceWorkerIds = Array.from(new Set(inFlightEntries.filter((entry) => entry.stage === "inference").map((entry) => entry.claimedBy).filter((value): value is string => typeof value === "string" && value.length > 0)));
    const deliveryWorkerIds = Array.from(new Set(inFlightEntries.filter((entry) => entry.stage === "delivery").map((entry) => entry.claimedBy).filter((value): value is string => typeof value === "string" && value.length > 0)));

    for (const caseRecord of summaries) {
      assertCaseSummaryProjectionInvariant(caseRecord, workflowJobsByCaseId.get(caseRecord.caseId) ?? []);
      byStatus[caseRecord.status] += 1;
    }

    return {
      totalCases: summaries.length,
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
        claimed: activeQueue.filter((entry) => entry.status === "claimed").length,
        queued: activeQueue.filter((entry) => entry.status === "queued").length,
        active: activeQueue,
        recent: queueEntries.slice(0, 20),
      },
      queueHealth: {
        queued: queuedEntries.length,
        inFlight: inFlightEntries.length,
        abandoned: abandonedEntries.length,
        deadLetter: deadLetterEntries.length,
        retry: retryEntries.length,
      },
      workerHealth: {
        activeWorkers: activeWorkerIds.length,
        staleLeases: abandonedEntries.length,
        byStage: {
          inference: inferenceWorkerIds.length,
          delivery: deliveryWorkerIds.length,
        },
      },
    };
  }

  async claimNextDispatch(input: ClaimNextDispatchInput): Promise<DispatchClaim | null> {
    const workerId = assertNonEmptyString(input.workerId, "workerId");
    const stage = input.stage;
    const leaseSeconds =
      typeof input.leaseSeconds === "number" && Number.isFinite(input.leaseSeconds)
        ? Math.max(1, Math.floor(input.leaseSeconds))
        : 300;
    const now = input.now ?? nowIso();

    if (stage !== "inference" && stage !== "delivery") {
      throw new WorkflowError(400, "stage must be inference or delivery", "INVALID_INPUT");
    }

    await this.releaseExpiredDispatchClaims(stage, now);

    const candidate = await this.dispatchQueue.claim({
      stage,
      workerId,
      leaseSeconds,
      now,
    });

    if (!candidate) {
      return null;
    }

    let record: CaseRecord;

    try {
      record = await this.requireCase(candidate.caseId);
    } catch (error) {
      if (error instanceof WorkflowError && error.code === "CASE_NOT_FOUND") {
        return null;
      }
      await this.dispatchQueue.enqueue(candidate);
      throw error;
    }

    try {
      return await this.persistExistingCase(record, async (workingCopy) => {
        const queueEntry = workingCopy.workflowQueue.find(
          (entry) => entry.queueEntryId === candidate.queueEntryId && entry.stage === stage && entry.status === "queued",
        );

        if (!queueEntry) {
          return null;
        }

        const claimedAt = now;
        const claimExpiresAt = addLeaseSeconds(claimedAt, leaseSeconds);
        const leaseId = randomUUID();

        if (candidate.retryEligibleAt > now) {
          await this.dispatchQueue.enqueue(candidate);
          return null;
        }

        queueEntry.status = "claimed";
        queueEntry.leaseId = leaseId;
        queueEntry.claimedBy = workerId;
        queueEntry.claimedAt = claimedAt;
        queueEntry.lastHeartbeatAt = claimedAt;
        queueEntry.claimExpiresAt = claimExpiresAt;
        queueEntry.updatedAt = claimedAt;
        queueEntry.detail = `Dispatch claimed by ${workerId}.`;

        if (stage === "inference") {
          workingCopy.planEnvelope.branches = workingCopy.planEnvelope.branches.map((branch) => ({
            ...branch,
            status: branch.status === "planned" ? "dispatched" : branch.status,
          }));
        }

        this.appendOperation(workingCopy, {
          caseId: workingCopy.caseId,
          correlationId: normalizeCorrelationId(input.correlationId),
          operationType: `${stage}-dispatch-claimed`,
          actorType: "integration",
          source: stage === "inference" ? "internal-inference" : "internal-delivery",
          outcome: "accepted",
          detail: `Dispatch lease ${leaseId} claimed by ${workerId}.`,
        });
        this.appendJournal(workingCopy, {
          transitionType: `${stage}-dispatch-claimed`,
          fromStatus: workingCopy.status,
          toStatus: workingCopy.status,
          actor: "integration",
          source: stage === "inference" ? "internal-inference" : "internal-delivery",
          detail: `Dispatch lease ${leaseId} claimed by ${workerId}.`,
        });
        workingCopy.evidenceCards = createEvidenceCards(workingCopy);

        return this.buildDispatchClaim(workingCopy, queueEntry, workerId);
      });
    } catch (error) {
      await this.dispatchQueue.enqueue(candidate);
      throw error;
    }
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
      correlationId: normalizeCorrelationId(input.correlationId),
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
      leaseId: typeof input.leaseId === "string" ? input.leaseId.trim() : undefined,
      workerId: typeof input.workerId === "string" ? input.workerId.trim() : undefined,
      correlationId: normalizeCorrelationId(input.correlationId),
    };
  }

  private normalizeDeliveryInput(input: DeliveryCallbackInput): DeliveryCallbackInput {
    return {
      deliveryStatus: input.deliveryStatus,
      detail: input.detail,
      leaseId: typeof input.leaseId === "string" ? input.leaseId.trim() : undefined,
      workerId: typeof input.workerId === "string" ? input.workerId.trim() : undefined,
      correlationId: normalizeCorrelationId(input.correlationId),
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
      transitionJournal: [],
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
        workflowPackage: null,
        qcSummary: null,
        findingsPayload: null,
        structuralExecution: null,
        artifactManifest: [],
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
      finalizedBy: null,
    };
    record.workerArtifacts.studyContext = buildStudyContextArtifact(record);
    this.appendOperation(record, {
      caseId,
      correlationId: input.correlationId,
      operationType: source === "public-api" ? "case-created" : "ingest-received",
      actorType: source === "public-api" ? "system" : "integration",
      source,
      outcome: "accepted",
      detail: reason,
    });
    this.appendJournal(record, {
      transitionType: source === "public-api" ? "case-created" : "ingest-received",
      fromStatus: null,
      toStatus: initialStatus,
      actor: source === "public-api" ? "system" : "integration",
      source,
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
    return normalizeCaseRecordShape(caseRecord);
  }

  private async requireCaseSummary(caseId: string) {
    const caseSummary = (await this.repository.listSummaries()).find((entry) => entry.caseId === caseId);
    if (!caseSummary) {
      throw new WorkflowError(404, `Case ${caseId} not found`, "CASE_NOT_FOUND");
    }
    return cloneCase(caseSummary);
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

  private transition(
    caseRecord: CaseRecord,
    nextStatus: CaseStatus,
    reason: string,
    journalContext?: {
      transitionType: string;
      actor: "system" | "clinician" | "integration";
      source: string;
    },
  ) {
    const fromStatus = caseRecord.status;
    const allowed = ALLOWED_TRANSITIONS[fromStatus];
    if (!allowed.includes(nextStatus)) {
      throw new WorkflowError(
        409,
        `Transition ${fromStatus} -> ${nextStatus} is not allowed`,
        "INVALID_TRANSITION",
      );
    }

    const updatedAt = nowIso();
    caseRecord.history.push({
      from: fromStatus,
      to: nextStatus,
      reason,
      at: updatedAt,
    });
    caseRecord.status = nextStatus;
    caseRecord.updatedAt = updatedAt;

    if (journalContext) {
      this.appendJournal(caseRecord, {
        ...journalContext,
        fromStatus,
        toStatus: nextStatus,
        detail: reason,
      });
    }
  }

  private appendOperation(caseRecord: CaseRecord, entry: Omit<OperationLogEntry, "operationId" | "at">) {
    caseRecord.operationLog.push(createOperationLogEntry(entry));
  }

  private appendJournal(
    caseRecord: CaseRecord,
    input: {
      transitionType: string;
      fromStatus: CaseStatus | null;
      toStatus: CaseStatus;
      actor: "system" | "clinician" | "integration";
      source: string;
      detail: string;
    },
  ) {
    const sequence = caseRecord.transitionJournal.length + 1;
    caseRecord.transitionJournal.push({
      journalId: randomUUID(),
      caseId: caseRecord.caseId,
      sequence,
      transitionType: input.transitionType,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actor: input.actor,
      source: input.source,
      detail: input.detail,
      timestamp: nowIso(),
      stateSnapshot: this.captureStateSnapshot(caseRecord),
    });
  }

  private captureStateSnapshot(caseRecord: CaseRecord): JournalStateSnapshot {
    return {
      status: caseRecord.status,
      queueSummary: caseRecord.workflowQueue.map((entry) => ({
        stage: entry.stage,
        status: entry.status,
      })),
      hasReport: caseRecord.report !== null,
      reportReviewStatus: caseRecord.report?.reviewStatus ?? null,
      reviewerId: caseRecord.review.reviewerId || null,
      finalizedBy: caseRecord.finalizedBy ?? null,
    };
  }

  private enqueueQueueEntry(
    caseRecord: CaseRecord,
    stage: WorkflowQueueStage,
    sourceOperation: string,
    detail: string,
    options?: {
      retryEligibleAt?: string;
    },
  ) {
    const timestamp = nowIso();
    const attempt = caseRecord.workflowQueue.filter((entry) => entry.stage === stage).length + 1;
    const retryTier = caseRecord.planEnvelope.dispatchProfile.retryTier as WorkflowRetryTier;
    const retryPolicy = getRetryPolicy(retryTier);
    const queueEntry: WorkflowQueueEntry = {
      queueEntryId: randomUUID(),
      caseId: caseRecord.caseId,
      stage,
      status: "queued",
      attempt,
      attemptId: buildWorkflowAttemptId(stage, attempt),
      enqueuedAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      leaseId: null,
      claimedBy: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      claimExpiresAt: null,
      retryTier,
      maxAttempts: retryPolicy.maxAttempts,
      retryEligibleAt: options?.retryEligibleAt ?? timestamp,
      failureClass: null,
      failureCode: null,
      deadLetteredAt: null,
      detail,
      sourceOperation,
    };

    caseRecord.workflowQueue.push(queueEntry);

    return queueEntry;
  }

  private selectQueuedEntries(caseRecord: CaseRecord, queueEntryIds?: string[]) {
    const selectedIds = queueEntryIds ? new Set(queueEntryIds) : null;

    return caseRecord.workflowQueue
      .filter((entry) => entry.status === "queued")
      .filter((entry) => selectedIds ? selectedIds.has(entry.queueEntryId) : true)
      .map((entry) => ({
        queueEntryId: entry.queueEntryId,
        caseId: caseRecord.caseId,
        stage: entry.stage,
        attempt: entry.attempt,
        attemptId: entry.attemptId,
        enqueuedAt: entry.enqueuedAt,
        retryEligibleAt: entry.retryEligibleAt,
      }));
  }

  private async enqueueDispatchJobs(queueEntries: DispatchQueueJob[]) {
    for (const queueEntry of queueEntries) {
      await this.dispatchQueue.enqueue(queueEntry);
    }
  }

  private resolveLatestQueueEntry(
    caseRecord: CaseRecord,
    stage: WorkflowQueueStage,
    status: Exclude<WorkflowQueueStatus, "queued">,
    detail: string,
  ) {
    for (let index = caseRecord.workflowQueue.length - 1; index >= 0; index -= 1) {
      const entry = caseRecord.workflowQueue[index];
      if (entry.stage !== stage || (entry.status !== "queued" && entry.status !== "claimed")) {
        continue;
      }

      this.resolveQueueEntry(entry, status, detail);
      return;
    }
  }

  private resolveQueueEntry(
    entry: WorkflowQueueEntry,
    status: Exclude<WorkflowQueueStatus, "queued">,
    detail: string,
  ) {
    const timestamp = nowIso();
    entry.status = status;
    entry.updatedAt = timestamp;
    entry.resolvedAt = timestamp;
    entry.leaseId = null;
    entry.claimedBy = null;
    entry.claimedAt = null;
    entry.lastHeartbeatAt = null;
    entry.claimExpiresAt = null;
    entry.failureClass = null;
    entry.failureCode = null;
    entry.deadLetteredAt = null;
    entry.detail = detail;
  }

  private requireLeaseBoundQueueEntry(
    caseRecord: CaseRecord,
    stage: WorkflowQueueStage,
    leaseId?: string,
    workerId?: string,
    referenceTime: string = nowIso(),
  ) {
    if (!leaseId && !workerId) {
      return null;
    }

    const normalizedLeaseId = assertNonEmptyString(leaseId, "leaseId");
    const normalizedWorkerId = assertNonEmptyString(workerId, "workerId");
    const queueEntry = caseRecord.workflowQueue.find(
      (entry) => entry.stage === stage && entry.status === "claimed" && entry.leaseId === normalizedLeaseId,
    );

    if (!queueEntry) {
      throw new WorkflowError(409, "Dispatch lease is not active for this case", "DISPATCH_LEASE_NOT_ACTIVE");
    }

    if (isClaimExpired(queueEntry, referenceTime)) {
      throw new WorkflowError(409, "Dispatch lease is expired", "DISPATCH_LEASE_EXPIRED");
    }

    if (queueEntry.claimedBy !== normalizedWorkerId) {
      throw new WorkflowError(409, "Dispatch lease belongs to another worker", "DISPATCH_LEASE_OWNER_MISMATCH");
    }

    return queueEntry;
  }

  private buildDispatchClaim(
    caseRecord: CaseRecord,
    queueEntry: WorkflowQueueEntry,
    workerId: string,
  ): DispatchClaim {
    const baseClaim: DispatchClaim = {
      leaseId: queueEntry.leaseId as string,
      workerId,
      caseId: caseRecord.caseId,
      stage: queueEntry.stage,
      attempt: queueEntry.attempt,
      attemptId: queueEntry.attemptId,
      resourceClass: caseRecord.planEnvelope.dispatchProfile.resourceClass,
      retryTier: queueEntry.retryTier,
      maxAttempts: queueEntry.maxAttempts,
      claimedAt: queueEntry.claimedAt as string,
      lastHeartbeatAt: queueEntry.lastHeartbeatAt ?? null,
      claimExpiresAt: queueEntry.claimExpiresAt as string,
    };

    if (queueEntry.stage === "inference") {
      return {
        ...baseClaim,
        planEnvelope: cloneCase(caseRecord.planEnvelope),
        studyContext: cloneCase(caseRecord.workerArtifacts.studyContext),
        workflowPackage: caseRecord.workerArtifacts.workflowPackage
          ? cloneCase(caseRecord.workerArtifacts.workflowPackage)
          : buildWorkflowPackageFromCase(caseRecord),
        requiredArtifacts: [...caseRecord.planEnvelope.requiredArtifacts],
      };
    }

    return {
      ...baseClaim,
      report: caseRecord.report ? cloneCase(caseRecord.report) : null,
      artifactManifest: caseRecord.workerArtifacts.artifactManifest.map((artifact) => cloneCase(artifact)),
      structuralRun: caseRecord.workerArtifacts.structuralRun
        ? cloneCase(caseRecord.workerArtifacts.structuralRun)
        : null,
    };
  }

  private async releaseExpiredDispatchClaims(stage: WorkflowQueueStage, now: string) {
    const cases = (await this.repository.list()).map(normalizeCaseRecordShape);

    for (const caseRecord of cases) {
      const hasExpiredClaim = caseRecord.workflowQueue.some(
        (entry) => entry.stage === stage && isClaimExpired(entry, now),
      );

      if (!hasExpiredClaim) {
        continue;
      }

      let releasedQueueEntryIds: string[] = [];
      const updatedCase = await this.persistExistingCase(caseRecord, async (workingCopy) => {
        let released = false;
        releasedQueueEntryIds = [];

        for (const entry of workingCopy.workflowQueue) {
          if (entry.stage !== stage || !isClaimExpired(entry, now)) {
            continue;
          }

          entry.status = "queued";
          entry.updatedAt = now;
          entry.resolvedAt = null;
          entry.leaseId = null;
          entry.claimedBy = null;
          entry.claimedAt = null;
          entry.lastHeartbeatAt = null;
          entry.claimExpiresAt = null;
          entry.retryEligibleAt = now;
          entry.detail = "Dispatch lease expired and entry returned to queue.";
          released = true;
          releasedQueueEntryIds.push(entry.queueEntryId);
        }

        if (released) {
          if (stage === "inference") {
            workingCopy.planEnvelope.branches = workingCopy.planEnvelope.branches.map((branch) => ({
              ...branch,
              status: branch.status === "dispatched" ? "planned" : branch.status,
            }));
          }

          this.appendOperation(workingCopy, {
            caseId: workingCopy.caseId,
            operationType: `${stage}-dispatch-lease-expired`,
            actorType: "system",
            source: "system",
            outcome: "replayed",
            detail: "Expired dispatch lease returned to queue.",
          });
          this.appendJournal(workingCopy, {
            transitionType: `${stage}-dispatch-lease-expired`,
            fromStatus: workingCopy.status,
            toStatus: workingCopy.status,
            actor: "system",
            source: "system",
            detail: "Expired dispatch lease returned to queue.",
          });
          workingCopy.evidenceCards = createEvidenceCards(workingCopy);
        }

        return released ? cloneCase(workingCopy) : null;
      });

      if (updatedCase && releasedQueueEntryIds.length > 0) {
        await this.enqueueDispatchJobs(this.selectQueuedEntries(updatedCase, releasedQueueEntryIds));
      }
    }
  }

  private async persistNewCase(caseRecord: CaseRecord) {
    assertCaseStateInvariant(caseRecord);
    await this.repository.upsert(caseRecord);
  }

  private async persistExistingCase<T>(caseRecord: CaseRecord, mutate: (workingCopy: CaseRecord) => Promise<T>) {
    const workingCopy = cloneCase(caseRecord);
    const original = JSON.stringify(workingCopy);

    const result = await mutate(workingCopy);

    if (JSON.stringify(workingCopy) !== original) {
      assertCaseStateInvariant(workingCopy);
      workingCopy.updatedAt = nowIso();
      await this.repository.upsert(workingCopy, {
        expectedUpdatedAt: caseRecord.updatedAt,
      });
    }

    return result;
  }
}