import type { StudyContextRecord } from "./case-imaging";
import type { WorkflowPackageManifest } from "./workflow-packages";

export type DerivedArtifactType =
  | "qc-summary"
  | "metrics-json"
  | "overlay-preview"
  | "report-preview"
  | "generic-artifact";

export interface ArchiveLocator {
  sourceArchive: string | null;
  studyInstanceUid: string;
  accessionNumber: string | null;
  seriesInstanceUids: string[];
  dicomWebBaseUrl: string | null;
}

export interface ViewerDescriptor {
  viewerMode: "dicom-overlay" | "report-preview";
  studyInstanceUid: string;
  primarySeriesInstanceUid: string | null;
  dicomWebBaseUrl: string | null;
}

export interface DerivedArtifactDescriptor {
  artifactId: string;
  artifactType: DerivedArtifactType;
  label: string;
  storageUri: string;
  mimeType: string;
  producingPackageId: string | null;
  producingPackageVersion: string | null;
  workflowFamily: "brain-structural";
  exportCompatibilityTags: string[];
  archiveLocator: ArchiveLocator;
  viewerReady: boolean;
  viewerDescriptor: ViewerDescriptor | null;
  generatedAt: string;
}

export interface PlannedArtifactPersistenceTarget {
  artifactType: DerivedArtifactType;
  label: string;
  mimeType: string;
  plannedStorageKey: string;
  plannedStorageUri: string;
}

function classifyArtifactType(reference: string): DerivedArtifactType {
  if (reference.includes("qc-summary")) {
    return "qc-summary";
  }
  if (reference.includes("metrics-json") || reference.includes("metrics")) {
    return "metrics-json";
  }
  if (reference.includes("overlay-preview") || reference.includes("overlay")) {
    return "overlay-preview";
  }
  if (reference.includes("report-preview") || reference.includes("report")) {
    return "report-preview";
  }
  return "generic-artifact";
}

function labelForArtifactType(artifactType: DerivedArtifactType) {
  switch (artifactType) {
    case "qc-summary":
      return "QC summary";
    case "metrics-json":
      return "Metrics payload";
    case "overlay-preview":
      return "Viewer overlay preview";
    case "report-preview":
      return "Report preview";
    default:
      return "Derived artifact";
  }
}

function mimeTypeForArtifactType(artifactType: DerivedArtifactType) {
  switch (artifactType) {
    case "qc-summary":
    case "metrics-json":
      return "application/json";
    case "overlay-preview":
      return "image/png";
    case "report-preview":
      return "text/html";
    default:
      return "application/octet-stream";
  }
}

function fileExtensionForArtifactType(artifactType: DerivedArtifactType) {
  switch (artifactType) {
    case "qc-summary":
    case "metrics-json":
      return ".json";
    case "overlay-preview":
      return ".png";
    case "report-preview":
      return ".html";
    default:
      return ".bin";
  }
}

function toArtifactType(reference: string): DerivedArtifactType {
  if (
    reference === "qc-summary" ||
    reference === "metrics-json" ||
    reference === "overlay-preview" ||
    reference === "report-preview" ||
    reference === "generic-artifact"
  ) {
    return reference;
  }

  return classifyArtifactType(reference);
}

function isSyntheticSeriesInstanceUid(seriesInstanceUid: string) {
  return /^series-\d+$/u.test(seriesInstanceUid);
}

function createArchiveLocator(studyContext: StudyContextRecord): ArchiveLocator {
  return {
    sourceArchive: studyContext.sourceArchive,
    studyInstanceUid: studyContext.studyInstanceUid,
    accessionNumber: studyContext.accessionNumber,
    seriesInstanceUids: studyContext.series.map((series) => series.seriesInstanceUid),
    dicomWebBaseUrl: studyContext.dicomWebBaseUrl,
  };
}

function hasTrustedArchiveBinding(studyContext: StudyContextRecord) {
  return Boolean(studyContext.sourceArchive || studyContext.dicomWebBaseUrl);
}

function getTrustedPrimarySeriesInstanceUid(studyContext: StudyContextRecord) {
  return (
    studyContext.series.find((series) => !isSyntheticSeriesInstanceUid(series.seriesInstanceUid))
      ?.seriesInstanceUid ?? null
  );
}

function createViewerDescriptor(input: {
  artifactType: DerivedArtifactType;
  studyContext: StudyContextRecord;
}): ViewerDescriptor | null {
  const hasArchiveBinding = hasTrustedArchiveBinding(input.studyContext);
  const trustedPrimarySeriesInstanceUid = getTrustedPrimarySeriesInstanceUid(input.studyContext);

  if (input.artifactType === "overlay-preview") {
    if (!hasArchiveBinding || !trustedPrimarySeriesInstanceUid) {
      return null;
    }

    return {
      viewerMode: "dicom-overlay",
      studyInstanceUid: input.studyContext.studyInstanceUid,
      primarySeriesInstanceUid: trustedPrimarySeriesInstanceUid,
      dicomWebBaseUrl: input.studyContext.dicomWebBaseUrl,
    };
  }

  if (input.artifactType === "report-preview") {
    if (!hasArchiveBinding) {
      return null;
    }

    return {
      viewerMode: "report-preview",
      studyInstanceUid: input.studyContext.studyInstanceUid,
      primarySeriesInstanceUid: null,
      dicomWebBaseUrl: input.studyContext.dicomWebBaseUrl,
    };
  }

  return null;
}

export function createDerivedArtifactDescriptors(input: {
  caseId: string;
  studyUid: string;
  artifactRefs: string[];
  studyContext: StudyContextRecord;
  generatedAt: string;
  packageManifest?: WorkflowPackageManifest | null;
}): DerivedArtifactDescriptor[] {
  const archiveLocator = createArchiveLocator(input.studyContext);

  return input.artifactRefs.map((reference, index) => {
    const artifactType = classifyArtifactType(reference);
    const viewerDescriptor = createViewerDescriptor({
      artifactType,
      studyContext: input.studyContext,
    });

    return {
      artifactId: `${input.caseId}-artifact-${index + 1}`,
      artifactType,
      label: labelForArtifactType(artifactType),
      storageUri: reference,
      mimeType: mimeTypeForArtifactType(artifactType),
      producingPackageId: input.packageManifest?.packageId ?? null,
      producingPackageVersion: input.packageManifest?.packageVersion ?? null,
      workflowFamily: input.packageManifest?.workflowFamily ?? "brain-structural",
      exportCompatibilityTags: [...(input.packageManifest?.outputContracts.exportCompatibility ?? [])],
      archiveLocator,
      viewerReady: viewerDescriptor !== null,
      viewerDescriptor,
      generatedAt: input.generatedAt,
    };
  });
}

export function createPlannedArtifactPersistenceTargets(input: {
  caseId: string;
  artifactTypes: string[];
}): PlannedArtifactPersistenceTarget[] {
  return input.artifactTypes.map((artifactTypeRef) => {
    const artifactType = toArtifactType(artifactTypeRef);
    const extension = fileExtensionForArtifactType(artifactType);
    const plannedStorageKey = `${input.caseId}/${artifactType}${extension}`;

    return {
      artifactType,
      label: labelForArtifactType(artifactType),
      mimeType: mimeTypeForArtifactType(artifactType),
      plannedStorageKey,
      plannedStorageUri: `object-store://case-artifacts/${plannedStorageKey}`,
    };
  });
}