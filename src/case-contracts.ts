import type { DerivedArtifactDescriptor } from "./case-artifacts";
import type { DispatchFailureClass } from "./case-common";
import type { ArtifactPayloadInput } from "./case-artifact-storage";
import type { QcSummaryInput, QcSummaryRecord, StudyContextInput, StudyContextRecord } from "./case-imaging";

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
export type StructuralComputeMode = "metadata-fallback" | "voxel-backed";
export type StructuralFallbackCode =
  | "missing-volume-input"
  | "volume-download-failed"
  | "volume-parse-failed";

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
  tenantId?: string;
  assignedReviewerId?: string;
  studyUid: string;
  sequenceInventory: string[];
  indication?: string;
  studyContext?: StudyContextInput;
}
export interface AccessScope {
  tenantId?: string;
  reviewerId?: string;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
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
  finalizerId?: string;
  finalizerRole?: string;
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
  artifactPayloads?: ArtifactPayloadInput[];
  executionContext?: StructuralExecutionContext;
  issues?: string[];
  generatedSummary?: string;
  qcSummary?: QcSummaryInput;
}

export interface StructuralExecutionContext {
  computeMode: StructuralComputeMode;
  fallbackCode: StructuralFallbackCode | null;
  fallbackDetail: string | null;
  sourceSeriesInstanceUid: string | null;
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
  actorId?: string | null;
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
  failureClass: DispatchFailureClass | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
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

export type StructuralExecutionStatus = "completed" | "qc-rejected";

export interface StructuralExecutionEnvelope {
  executionSchemaVersion: "0.1.0";
  packageId: string;
  packageVersion: string;
  manifestSchemaVersion: string;
  workflowFamily: WorkflowFamily;
  branchId: string;
  executionStatus: StructuralExecutionStatus;
  dispatchedAt: string | null;
  completedAt: string;
  resourceClass: string;
  callbackSource: "internal-inference";
  executionContext: StructuralExecutionContext;
  artifactIds: string[];
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
  executionContext: StructuralExecutionContext;
  uncertaintySummary: string;
  issues: string[];
  artifacts: string[];
  derivedArtifacts?: DerivedArtifactDescriptor[];
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
  tenantId?: string;
  assignedReviewerId?: string;
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
  structuralExecution: StructuralExecutionEnvelope | null;
  artifactManifest: DerivedArtifactDescriptor[];
  report: ReportPayload | null;
  lastInferenceFingerprint: string | null;
  review: {
    reviewerId: string;
    reviewerRole: string | null;
    comments: string | null;
    reviewedAt: string | null;
  };
}

export interface PersistedCaseSnapshot {
  version: "0.1.0";
  revision: number;
  cases: CaseRecord[];
  deliveryJobs?: DeliveryJobRecord[];
  inferenceJobs?: InferenceJobRecord[];
}