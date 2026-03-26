import type {
  ArtifactReference,
  ArtifactManifestEntry,
  CaseRecord,
  OperationLogEntry,
  QcDisposition,
  StructuralRunArtifact,
  WorkflowFamily,
  WorkflowQueueEntry,
} from "./cases";
import type { ReportVersionPins } from "./case-common";

export interface CaseReportProjection {
  reviewStatus: "draft" | "reviewed" | "finalized";
  versionPins: ReportVersionPins;
  qcDisposition: QcDisposition | "pending";
  generatedAt: string;
  workflowVersion: string;
}

export interface CaseSummaryProjection {
  caseId: string;
  patientAlias: string;
  studyUid: string;
  workflowFamily: WorkflowFamily;
  status: CaseRecord["status"];
  createdAt: string;
  updatedAt: string;
  indication: string | null;
  sequenceInventory: string[];
  operationLog: OperationLogEntry[];
  review: CaseRecord["review"];
  finalizedBy: string | null;
  report: CaseReportProjection | null;
}

export interface WorkflowJobProjection {
  caseId: string;
  updatedAt: string;
  jobs: WorkflowQueueEntry[];
}

export interface ArtifactReferenceProjection {
  caseId: string;
  updatedAt: string;
  reportArtifactRefs: ArtifactReference[];
  qcArtifactRefs: ArtifactReference[];
  artifactManifest: ArtifactManifestEntry[];
  structuralRun: StructuralRunArtifact | null;
  reportGeneratedAt: string | null;
  workflowVersion: string | null;
}

export interface PersistedProjectionSnapshot {
  caseSummaries: CaseSummaryProjection[];
  workflowJobs: WorkflowJobProjection[];
  artifactReferences: ArtifactReferenceProjection[];
}

function cloneProjection<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildCaseSummaryProjection(caseRecord: CaseRecord): CaseSummaryProjection {
  return {
    caseId: caseRecord.caseId,
    patientAlias: caseRecord.patientAlias,
    studyUid: caseRecord.studyUid,
    workflowFamily: caseRecord.workflowFamily,
    status: caseRecord.status,
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt,
    indication: caseRecord.indication,
    sequenceInventory: [...caseRecord.sequenceInventory],
    operationLog: caseRecord.operationLog.map((entry) => ({ ...entry })),
    review: {
      reviewerId: caseRecord.review.reviewerId,
      reviewerRole: caseRecord.review.reviewerRole ?? null,
      comments: caseRecord.review.comments ?? null,
      reviewedAt: caseRecord.review.reviewedAt ?? null,
    },
    finalizedBy: caseRecord.finalizedBy ?? null,
    report: caseRecord.report
      ? {
          reviewStatus: caseRecord.report.reviewStatus,
          versionPins: { ...caseRecord.report.versionPins },
          qcDisposition: caseRecord.report.qcDisposition,
          generatedAt: caseRecord.report.provenance.generatedAt,
          workflowVersion: caseRecord.report.provenance.workflowVersion,
        }
      : null,
  };
}

export function buildWorkflowJobProjection(caseRecord: CaseRecord): WorkflowJobProjection {
  return {
    caseId: caseRecord.caseId,
    updatedAt: caseRecord.updatedAt,
    jobs: caseRecord.workflowQueue.map((entry) => ({
      ...entry,
      resolvedAt: entry.resolvedAt ?? null,
      leaseId: entry.leaseId ?? null,
      claimedBy: entry.claimedBy ?? null,
      claimedAt: entry.claimedAt ?? null,
      lastHeartbeatAt: entry.lastHeartbeatAt ?? null,
      claimExpiresAt: entry.claimExpiresAt ?? null,
      failureClass: entry.failureClass ?? null,
      failureCode: entry.failureCode ?? null,
      deadLetteredAt: entry.deadLetteredAt ?? null,
    })),
  };
}

export function buildArtifactReferenceProjection(caseRecord: CaseRecord): ArtifactReferenceProjection {
  return {
    caseId: caseRecord.caseId,
    updatedAt: caseRecord.updatedAt,
    reportArtifactRefs: caseRecord.report ? caseRecord.report.artifacts.map((artifact) => ({ ...artifact })) : [],
    qcArtifactRefs: caseRecord.workerArtifacts.qcSummary
      ? caseRecord.workerArtifacts.qcSummary.artifactRefs.map((artifact) => ({ ...artifact }))
      : [],
    artifactManifest: caseRecord.workerArtifacts.artifactManifest.map((artifact) => ({
      ...artifact,
      artifact: { ...artifact.artifact },
      exportCompatibility: [...artifact.exportCompatibility],
    })),
    structuralRun: caseRecord.workerArtifacts.structuralRun
      ? {
          ...caseRecord.workerArtifacts.structuralRun,
          artifacts: caseRecord.workerArtifacts.structuralRun.artifacts.map((artifact) => ({
            ...artifact,
            artifact: { ...artifact.artifact },
          })),
        }
      : null,
    reportGeneratedAt: caseRecord.report?.provenance.generatedAt ?? null,
    workflowVersion: caseRecord.report?.provenance.workflowVersion ?? null,
  };
}

export function buildPersistedCaseProjections(caseRecords: Iterable<CaseRecord>): PersistedProjectionSnapshot {
  const records = Array.from(caseRecords, (caseRecord) => cloneProjection(caseRecord));

  return {
    caseSummaries: records.map(buildCaseSummaryProjection),
    workflowJobs: records.map(buildWorkflowJobProjection),
    artifactReferences: records.map(buildArtifactReferenceProjection),
  };
}

export function normalizeCaseSummaryProjection(projection: CaseSummaryProjection): CaseSummaryProjection {
  return {
    ...projection,
    indication: projection.indication ?? null,
    sequenceInventory: [...projection.sequenceInventory],
    operationLog: projection.operationLog.map((entry) => ({ ...entry })),
    review: {
      reviewerId: projection.review.reviewerId,
      reviewerRole: projection.review.reviewerRole ?? null,
      comments: projection.review.comments ?? null,
      reviewedAt: projection.review.reviewedAt ?? null,
    },
    finalizedBy: projection.finalizedBy ?? null,
    report: projection.report
      ? {
          ...projection.report,
          versionPins: { ...projection.report.versionPins },
        }
      : null,
  };
}

export function normalizeWorkflowJobProjection(projection: WorkflowJobProjection): WorkflowJobProjection {
  return {
    ...projection,
    jobs: projection.jobs.map((entry) => ({
      ...entry,
      resolvedAt: entry.resolvedAt ?? null,
      leaseId: entry.leaseId ?? null,
      claimedBy: entry.claimedBy ?? null,
      claimedAt: entry.claimedAt ?? null,
      lastHeartbeatAt: entry.lastHeartbeatAt ?? null,
      claimExpiresAt: entry.claimExpiresAt ?? null,
      failureClass: entry.failureClass ?? null,
      failureCode: entry.failureCode ?? null,
      deadLetteredAt: entry.deadLetteredAt ?? null,
    })),
  };
}

export function normalizeArtifactReferenceProjection(
  projection: ArtifactReferenceProjection,
): ArtifactReferenceProjection {
  return {
    ...projection,
    reportArtifactRefs: projection.reportArtifactRefs.map((artifact) => ({ ...artifact })),
    qcArtifactRefs: projection.qcArtifactRefs.map((artifact) => ({ ...artifact })),
    artifactManifest: projection.artifactManifest.map((artifact) => ({
      ...artifact,
      artifact: { ...artifact.artifact },
      exportCompatibility: [...artifact.exportCompatibility],
    })),
    structuralRun: projection.structuralRun
      ? {
          ...projection.structuralRun,
          artifacts: projection.structuralRun.artifacts.map((artifact) => ({
            ...artifact,
            artifact: { ...artifact.artifact },
          })),
        }
      : null,
    reportGeneratedAt: projection.reportGeneratedAt ?? null,
    workflowVersion: projection.workflowVersion ?? null,
  };
}
