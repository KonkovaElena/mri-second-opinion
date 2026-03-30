import {
  createPlannedArtifactPersistenceTargets,
  type DerivedArtifactDescriptor,
} from "./case-artifacts";
import type { CaseRecord, DeliveryJobRecord, InferenceJobRecord, ReportPayload } from "./cases";
import { getWorkflowPackageManifest } from "./workflow-packages";

type OperationsSummary = Awaited<
  ReturnType<import("./cases").MemoryCaseService["getOperationsSummary"]>
>;

function buildViewerPath(caseId: string, artifact: DerivedArtifactDescriptor) {
  if (!artifact.viewerReady || !artifact.viewerDescriptor) {
    return null;
  }

  const params = new URLSearchParams({
    caseId,
    panel: "viewer",
    artifactId: artifact.artifactId,
  });

  return `/workbench?${params.toString()}`;
}

function buildArchiveStudyUrl(artifact: DerivedArtifactDescriptor) {
  return artifact.viewerDescriptor?.dicomWebBaseUrl ?? artifact.archiveLocator.dicomWebBaseUrl ?? null;
}

function presentArtifactDescriptor(caseId: string, artifact: DerivedArtifactDescriptor) {
  const presentedArtifact = artifact.retrievalUrl
    ? {
        ...artifact,
        storageUri: artifact.retrievalUrl,
      }
    : {
        ...artifact,
      };

  return {
    ...presentedArtifact,
    viewerPath: buildViewerPath(caseId, artifact),
    archiveStudyUrl: buildArchiveStudyUrl(artifact),
  };
}

export function presentCaseListItem(caseRecord: CaseRecord) {
  return {
    caseId: caseRecord.caseId,
    patientAlias: caseRecord.patientAlias,
    studyUid: caseRecord.studyUid,
    workflowFamily: caseRecord.workflowFamily,
    status: caseRecord.status,
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt,
    indication: caseRecord.indication,
    sequenceInventory: caseRecord.sequenceInventory,
    qcDisposition: caseRecord.qcSummary.disposition,
    selectedPackage: caseRecord.planEnvelope.packageResolution.selectedPackage,
    reviewStatus: caseRecord.report?.reviewStatus ?? "not-ready",
  };
}

export function presentCaseDetail(caseRecord: CaseRecord) {
  const reportArtifacts = caseRecord.artifactManifest.map((artifact) => presentArtifactDescriptor(caseRecord.caseId, artifact));
  const selectedPackage = caseRecord.structuralExecution?.packageId ?? caseRecord.planEnvelope.packageResolution.selectedPackage;

  return {
    ...presentCaseListItem(caseRecord),
    packageManifest: getWorkflowPackageManifest(selectedPackage),
    structuralExecution: caseRecord.structuralExecution,
    studyContext: caseRecord.studyContext,
    qcSummary: caseRecord.qcSummary,
    planSummary: {
      workflowCandidates: caseRecord.planEnvelope.studyContext.workflowCandidates,
      qcDisposition: caseRecord.planEnvelope.studyContext.qcDisposition,
      metadataSummary: caseRecord.planEnvelope.studyContext.metadataSummary,
      selectedPackage: caseRecord.planEnvelope.packageResolution.selectedPackage,
      blockedPackages: caseRecord.planEnvelope.packageResolution.blockedPackages,
      requiredArtifacts: caseRecord.planEnvelope.requiredArtifacts,
      seriesCount: caseRecord.planEnvelope.studyContext.dicomStudy.seriesCount,
    },
    reportSummary: caseRecord.report
      ? {
          reviewStatus: caseRecord.report.reviewStatus,
          processingSummary: caseRecord.report.processingSummary,
          executionContext: caseRecord.report.executionContext,
          finalImpression: caseRecord.report.finalImpression ?? null,
          artifactCount: reportArtifacts.length,
        }
      : null,
    artifactManifest: reportArtifacts,
    review: caseRecord.review,
    evidenceCards: caseRecord.evidenceCards,
    history: caseRecord.history,
    operationLog: caseRecord.operationLog,
  };
}

export function presentReport(report: ReportPayload) {
  return {
    reportSchemaVersion: report.reportSchemaVersion,
    caseId: report.caseId,
    studyRef: report.studyRef,
    workflowFamily: report.workflowFamily,
    processingSummary: report.processingSummary,
    qcDisposition: report.qcDisposition,
    sequenceCoverage: report.sequenceCoverage,
    findings: report.findings,
    measurements: report.measurements,
    executionContext: report.executionContext,
    uncertaintySummary: report.uncertaintySummary,
    issues: report.issues,
    artifactRefs: report.artifacts,
    artifacts: (report.derivedArtifacts ?? []).map((artifact) => presentArtifactDescriptor(report.caseId, artifact)),
    provenance: report.provenance,
    reviewStatus: report.reviewStatus,
    disclaimerProfile: report.disclaimerProfile,
    finalImpression: report.finalImpression ?? null,
  };
}

export function presentDeliveryJob(deliveryJob: DeliveryJobRecord) {
  return {
    jobId: deliveryJob.jobId,
    caseId: deliveryJob.caseId,
    status: deliveryJob.status,
    attemptCount: deliveryJob.attemptCount,
    enqueuedAt: deliveryJob.enqueuedAt,
    availableAt: deliveryJob.availableAt,
    updatedAt: deliveryJob.updatedAt,
    workerId: deliveryJob.workerId,
    claimedAt: deliveryJob.claimedAt,
    completedAt: deliveryJob.completedAt,
    lastError: deliveryJob.lastError,
  };
}

export function presentInferenceJob(inferenceJob: InferenceJobRecord) {
  return {
    jobId: inferenceJob.jobId,
    caseId: inferenceJob.caseId,
    status: inferenceJob.status,
    attemptCount: inferenceJob.attemptCount,
    enqueuedAt: inferenceJob.enqueuedAt,
    availableAt: inferenceJob.availableAt,
    updatedAt: inferenceJob.updatedAt,
    workerId: inferenceJob.workerId,
    claimedAt: inferenceJob.claimedAt,
    completedAt: inferenceJob.completedAt,
    lastError: inferenceJob.lastError,
    failureClass: inferenceJob.failureClass,
  };
}

export function presentInferenceExecutionContract(input: {
  caseRecord: CaseRecord;
  inferenceJob: InferenceJobRecord;
}) {
  const selectedPackage = input.caseRecord.planEnvelope.packageResolution.selectedPackage;
  const studyContext = input.caseRecord.studyContext;

  return {
    claim: {
      jobId: input.inferenceJob.jobId,
      caseId: input.inferenceJob.caseId,
      workerId: input.inferenceJob.workerId,
      claimedAt: input.inferenceJob.claimedAt,
      attemptCount: input.inferenceJob.attemptCount,
      status: input.inferenceJob.status,
    },
    workflowFamily: input.caseRecord.workflowFamily,
    selectedPackage,
    caseContext: {
      studyUid: input.caseRecord.studyUid,
      indication: input.caseRecord.indication,
      sequenceInventory: [...input.caseRecord.sequenceInventory],
    },
    studyContext: {
      ...studyContext,
      metadataSummary: [...studyContext.metadataSummary],
      series: studyContext.series.map((series) => ({
        ...series,
      })),
    },
    dispatchProfile: {
      ...input.caseRecord.planEnvelope.dispatchProfile,
    },
    packageManifest: getWorkflowPackageManifest(selectedPackage),
    requiredArtifacts: [...input.caseRecord.planEnvelope.requiredArtifacts],
    persistenceTargets: createPlannedArtifactPersistenceTargets({
      caseId: input.caseRecord.caseId,
      artifactTypes: input.caseRecord.planEnvelope.requiredArtifacts,
    }),
  };
}

export function presentOperationsSummary(summary: OperationsSummary) {
  return {
    totals: {
      totalCases: summary.totalCases,
      reviewRequiredCount: summary.reviewRequiredCount,
      deliveryFailures: summary.deliveryFailures,
    },
    byStatus: summary.byStatus,
    deliveryQueue: summary.deliveryQueue,
    inferenceQueue: summary.inferenceQueue,
    recentOperations: summary.recentOperations,
    retryHistory: summary.retryHistory,
  };
}