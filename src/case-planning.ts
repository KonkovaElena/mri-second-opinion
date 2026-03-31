import type {
  CaseRecord,
  CaseStatus,
  EvidenceCard,
  InferenceCallbackInput,
  InferenceJobRecord,
  PlanEnvelope,
  PolicyGateRecord,
  ReportPayload,
  StructuralExecutionContext,
  StructuralExecutionEnvelope,
} from "./case-contracts";
import type { ArtifactStorageOverride } from "./case-artifacts";
import type { StudyContextRecord } from "./case-imaging";
import { createDerivedArtifactDescriptors } from "./case-artifacts";
import { missingRequiredSequences, nowIso } from "./case-common";
import { formatWorkflowPackageVersion, getWorkflowPackageManifest } from "./workflow-packages";

export const ALLOWED_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  INGESTING: ["SUBMITTED", "QC_REJECTED"],
  QC_REJECTED: [],
  SUBMITTED: ["AWAITING_REVIEW"],
  AWAITING_REVIEW: ["REVIEWED"],
  REVIEWED: ["FINALIZED"],
  FINALIZED: ["DELIVERY_PENDING"],
  DELIVERY_PENDING: ["DELIVERED", "DELIVERY_FAILED"],
  DELIVERED: [],
  DELIVERY_FAILED: ["DELIVERY_PENDING"],
};

export function createPlanEnvelope(input: {
  caseId: string;
  studyUid: string;
  indication: string | null;
  sequenceInventory: string[];
  studyContext?: StudyContextRecord;
  qcDisposition: InferenceCallbackInput["qcDisposition"] | "pending";
  source: "public-api" | "internal-ingest";
  isEligible: boolean;
}): PlanEnvelope {
  const createdAt = nowIso();
  const studyContext = input.studyContext ?? {
    studyInstanceUid: input.studyUid,
    dicomStudyInstanceUid: input.studyUid,
    accessionNumber: null,
    studyDate: null,
    sourceArchive: null,
    dicomWebBaseUrl: null,
    metadataSummary: [],
    series: [],
    receivedAt: createdAt,
    source: input.source,
  };
  const blockedPackages = input.isEligible ? [] : ["brain-structural-fastsurfer"];
  const selectedPackage = input.isEligible ? "brain-structural-fastsurfer" : null;
  const downgradeState = input.isEligible
    ? null
    : {
        downgradeCode: "missing-required-sequence",
        fromState: "brain-structural",
        toState: "blocked",
        rationale: "T1w is required for the neuro structural MVP slice.",
        visibleToOperator: true,
        outputLimitations: ["No structural report may be generated."],
      };
  const policyGateResults: PolicyGateRecord[] = [
    {
      gateId: `sequence-gate-${input.caseId}`,
      gateClass: "sequence-gate",
      outcome: input.isEligible ? "allow" : "block",
      target: "brain-structural",
      rationale: input.isEligible ? "T1w sequence present." : "T1w sequence missing.",
      evidenceRefs: input.sequenceInventory,
      timestamp: createdAt,
    },
  ];

  return {
    planSchemaVersion: "0.1.0",
    caseRef: {
      caseId: input.caseId,
      studyUid: input.studyUid,
    },
    studyContext: {
      workflowCandidates: ["brain-structural"],
      sequenceInventory: input.sequenceInventory,
      indication: input.indication,
      qcDisposition: input.qcDisposition,
      metadataSummary: studyContext.metadataSummary,
      dicomStudy: {
        studyInstanceUid: studyContext.dicomStudyInstanceUid,
        accessionNumber: studyContext.accessionNumber,
        studyDate: studyContext.studyDate,
        sourceArchive: studyContext.sourceArchive,
        dicomWebBaseUrl: studyContext.dicomWebBaseUrl,
        seriesCount: studyContext.series.length,
      },
    },
    routingDecision: {
      workflowFamily: "brain-structural",
      confidence: input.isEligible ? 0.94 : 0.51,
      decisionBasis: input.isEligible
        ? ["sequence-rule", "neuro-first-mvp-slice"]
        : ["sequence-rule", "blocked-missing-t1w"],
      operatorOverride: null,
    },
    packageResolution: {
      eligiblePackages: selectedPackage ? [selectedPackage] : [],
      blockedPackages,
      selectedPackage,
    },
    branches: [
      {
        branchId: "qc",
        role: "quality-gate",
        status: input.isEligible ? "planned" : "blocked",
        requiredOutputs: ["qc-summary"],
      },
      {
        branchId: "structural",
        role: "specialist",
        status: input.isEligible ? "planned" : "blocked",
        requiredOutputs: ["metrics-json", "overlay-preview"],
      },
    ],
    policyGateResults,
    downgradeState,
    dispatchProfile: {
      resourceClass: "light-gpu",
      retryTier: "standard",
    },
    requiredArtifacts: input.isEligible ? ["qc-summary", "metrics-json", "overlay-preview", "report-preview"] : [],
    provenance: {
      plannerVersion: "wave1-memory-api",
      createdAt,
      source: input.source,
    },
  };
}

export function createEvidenceCards(caseRecord: CaseRecord): EvidenceCard[] {
  const cards: EvidenceCard[] = [];
  const missingRequired = missingRequiredSequences(caseRecord.sequenceInventory);
  const selectedPackage = caseRecord.structuralExecution?.packageId ?? caseRecord.planEnvelope.packageResolution.selectedPackage;
  const executionPackageRef = caseRecord.structuralExecution
    ? formatWorkflowPackageVersion(caseRecord.structuralExecution)
    : null;

  cards.push({
    cardType: "routing",
    cardVersion: "0.1.0",
    caseId: caseRecord.caseId,
    headline: selectedPackage ? "Structural workflow selected" : "Workflow blocked",
    severity: selectedPackage ? "info" : "blocked",
    status: selectedPackage ? "good" : "blocked",
    summary: selectedPackage
      ? executionPackageRef
        ? `Selected package ${executionPackageRef} with persisted execution state ${caseRecord.structuralExecution?.executionStatus}.`
        : `Selected package ${selectedPackage}.`
      : "No eligible package selected for this case.",
    supportingRefs: selectedPackage
      ? executionPackageRef
        ? [executionPackageRef, ...caseRecord.structuralExecution!.artifactIds]
        : [selectedPackage]
      : ["blocked:brain-structural-fastsurfer"],
    recommendedAction: selectedPackage ? null : "Confirm T1w availability or reject intake.",
  });

  cards.push({
    cardType: "sequence-coverage",
    cardVersion: "0.1.0",
    caseId: caseRecord.caseId,
    headline: missingRequired.length === 0 ? "Required sequences present" : "Missing required sequence",
    severity: missingRequired.length === 0 ? "info" : "blocked",
    status: missingRequired.length === 0 ? "good" : "blocked",
    summary:
      missingRequired.length === 0
        ? "T1w present for neuro structural routing."
        : `Missing required sequences: ${missingRequired.join(", ")}.`,
    supportingRefs: caseRecord.sequenceInventory,
    recommendedAction:
      missingRequired.length === 0 ? null : "Do not proceed to structural workflow until required sequences are present.",
  });

  cards.push({
    cardType: "review-status",
    cardVersion: "0.1.0",
    caseId: caseRecord.caseId,
    headline: `Case status: ${caseRecord.status}`,
    severity:
      caseRecord.status === "AWAITING_REVIEW"
        ? "high-review-priority"
        : caseRecord.status === "QC_REJECTED" || caseRecord.status === "DELIVERY_FAILED"
          ? "warn"
          : "info",
    status:
      caseRecord.status === "AWAITING_REVIEW"
        ? "review-required"
        : caseRecord.status === "QC_REJECTED"
          ? "blocked"
          : caseRecord.status === "DELIVERY_FAILED"
            ? "warn"
            : "good",
    summary: `Current workflow state is ${caseRecord.status}.`,
    supportingRefs: caseRecord.history.map((entry) => `${entry.to}@${entry.at}`),
    recommendedAction:
      caseRecord.status === "AWAITING_REVIEW"
        ? "Clinician review is required before finalization."
        : caseRecord.status === "DELIVERY_FAILED"
          ? "Retry delivery after resolving outbound failure."
          : null,
  });

  cards.push({
    cardType: "qc",
    cardVersion: "0.1.0",
    caseId: caseRecord.caseId,
    headline: `QC disposition: ${caseRecord.qcSummary.disposition}`,
    severity:
      caseRecord.qcSummary.disposition === "reject"
        ? "blocked"
        : caseRecord.qcSummary.disposition === "warn"
          ? "warn"
          : "info",
    status:
      caseRecord.qcSummary.disposition === "reject"
        ? "blocked"
        : caseRecord.qcSummary.disposition === "warn"
          ? "warn"
          : caseRecord.qcSummary.disposition === "pending"
            ? "review-required"
            : "good",
    summary:
      caseRecord.qcSummary.summary ??
      (caseRecord.report
        ? caseRecord.report.processingSummary
        : "QC has not been completed yet for this case."),
    supportingRefs: [
      ...caseRecord.qcSummary.checks.map((check) => `${check.checkId}:${check.status}`),
      ...caseRecord.artifactManifest.map((artifact) => artifact.artifactType),
    ],
    recommendedAction:
      caseRecord.qcSummary.disposition === "warn"
        ? "Review QC warnings before release."
        : caseRecord.qcSummary.disposition === "reject"
          ? "Do not release until study quality or completeness issues are resolved."
          : null,
  });

  if (caseRecord.structuralExecution) {
    const executionContext = caseRecord.structuralExecution.executionContext;
    const executionSummary =
      executionContext.computeMode === "voxel-backed"
        ? `Worker completed a voxel-backed pass${
            executionContext.sourceSeriesInstanceUid ? ` on series ${executionContext.sourceSeriesInstanceUid}` : "."
          }`
        : executionContext.fallbackCode
          ? `Worker fell back to metadata-only mode (${executionContext.fallbackCode}).`
          : "Worker completed in metadata-only mode.";

    cards.push({
      cardType: "execution",
      cardVersion: "0.1.0",
      caseId: caseRecord.caseId,
      headline:
        executionContext.computeMode === "voxel-backed"
          ? "Voxel-backed execution recorded"
          : "Metadata fallback recorded",
      severity: executionContext.computeMode === "voxel-backed" ? "info" : "warn",
      status: executionContext.computeMode === "voxel-backed" ? "good" : "warn",
      summary: executionSummary,
      supportingRefs: [
        executionContext.computeMode,
        ...(executionContext.fallbackCode ? [executionContext.fallbackCode] : []),
        ...(executionContext.sourceSeriesInstanceUid ? [executionContext.sourceSeriesInstanceUid] : []),
      ],
      recommendedAction:
        executionContext.computeMode === "voxel-backed"
          ? null
          : "Review fallback details before treating the draft as more than metadata-derived evidence.",
    });
  }

  return cards;
}

export function createDefaultStructuralExecutionContext(
  input: Partial<StructuralExecutionContext> = {},
): StructuralExecutionContext {
  const computeMode = input.computeMode === "voxel-backed" ? "voxel-backed" : "metadata-fallback";
  return {
    computeMode,
    fallbackCode: computeMode === "metadata-fallback" ? input.fallbackCode ?? null : null,
    fallbackDetail: computeMode === "metadata-fallback" ? input.fallbackDetail ?? null : null,
    sourceSeriesInstanceUid: input.sourceSeriesInstanceUid ?? null,
  };
}

export function createStructuralExecutionEnvelope(input: {
  caseRecord: CaseRecord;
  inferenceJob: InferenceJobRecord | null;
  executionStatus: StructuralExecutionEnvelope["executionStatus"];
  completedAt?: string;
  executionContext?: StructuralExecutionContext;
  artifactIds: string[];
}): StructuralExecutionEnvelope | null {
  const packageManifest = getWorkflowPackageManifest(input.caseRecord.planEnvelope.packageResolution.selectedPackage);

  if (!packageManifest) {
    return null;
  }

  return {
    executionSchemaVersion: "0.1.0",
    packageId: packageManifest.packageId,
    packageVersion: packageManifest.packageVersion,
    manifestSchemaVersion: packageManifest.manifestSchemaVersion,
    workflowFamily: packageManifest.workflowFamily,
    branchId: "structural",
    executionStatus: input.executionStatus,
    dispatchedAt: input.inferenceJob?.claimedAt ?? null,
    completedAt: input.completedAt ?? nowIso(),
    resourceClass: input.caseRecord.planEnvelope.dispatchProfile.resourceClass,
    callbackSource: "internal-inference",
    executionContext: createDefaultStructuralExecutionContext(input.executionContext),
    artifactIds: [...input.artifactIds],
  };
}

export function backfillStructuralExecutionEnvelope(input: {
  caseRecord: CaseRecord;
  artifactIds: string[];
}): StructuralExecutionEnvelope | null {
  if (!input.caseRecord.report) {
    return null;
  }

  return createStructuralExecutionEnvelope({
    caseRecord: input.caseRecord,
    inferenceJob: null,
    executionStatus: input.caseRecord.status === "QC_REJECTED" ? "qc-rejected" : "completed",
    completedAt: input.caseRecord.report.provenance.generatedAt,
    executionContext: input.caseRecord.report.executionContext,
    artifactIds: input.artifactIds,
  });
}

export function createArtifactManifest(
  caseRecord: CaseRecord,
  input: InferenceCallbackInput,
  generatedAt = nowIso(),
  artifactStorageOverrides?: ArtifactStorageOverride[],
) {
  const packageManifest = getWorkflowPackageManifest(caseRecord.planEnvelope.packageResolution.selectedPackage);

  return createDerivedArtifactDescriptors({
    caseId: caseRecord.caseId,
    studyUid: caseRecord.studyUid,
    artifactRefs: input.artifacts,
    studyContext: caseRecord.studyContext,
    generatedAt,
    packageManifest,
    artifactStorageOverrides,
  });
}

export function createDraftReport(
  caseRecord: CaseRecord,
  input: InferenceCallbackInput,
  generatedAt = nowIso(),
): ReportPayload {
  const packageManifest = getWorkflowPackageManifest(caseRecord.planEnvelope.packageResolution.selectedPackage);
  const workflowVersion =
    formatWorkflowPackageVersion(caseRecord.structuralExecution) ??
    formatWorkflowPackageVersion(packageManifest) ??
    "brain-structural-fastsurfer@0.1.0";

  return {
    reportSchemaVersion: "0.1.0",
    caseId: caseRecord.caseId,
    studyRef: { studyUid: caseRecord.studyUid },
    workflowFamily: caseRecord.workflowFamily,
    processingSummary:
      input.generatedSummary ??
      `Neuro structural draft generated with QC ${input.qcDisposition}.`,
    qcDisposition: input.qcDisposition,
    sequenceCoverage: {
      available: caseRecord.sequenceInventory,
      missingRequired: missingRequiredSequences(caseRecord.sequenceInventory),
    },
    findings: input.findings,
    measurements: input.measurements,
    executionContext: createDefaultStructuralExecutionContext(input.executionContext),
    uncertaintySummary: "Human review remains mandatory for all machine findings.",
    issues: input.issues ?? [],
    artifacts: input.artifacts,
    provenance: {
      workflowVersion,
      plannerVersion: caseRecord.planEnvelope.provenance.plannerVersion,
      generatedAt,
    },
    reviewStatus: "draft",
    disclaimerProfile: "RUO_CLINICIAN_REVIEW_REQUIRED",
  };
}