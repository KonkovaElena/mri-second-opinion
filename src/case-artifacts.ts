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
  retrievalUrl: string | null;
  mimeType: string;
  contentSha256: string | null;
  byteSize: number | null;
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

export interface ArtifactStorageOverride {
  artifactRef: string;
  storageUri: string;
  mimeType?: string;
  contentSha256?: string | null;
  byteSize?: number | null;
}

const FILE_SCHEME_PREFIX = "file://";
const ARTIFACT_SCHEME_PREFIX = "artifact://";
const OBJECT_STORE_SCHEME_PREFIX = "object-store://";

function supportsApiArtifactRetrieval(storageUri: string) {
  return storageUri.startsWith(FILE_SCHEME_PREFIX) || storageUri.startsWith(OBJECT_STORE_SCHEME_PREFIX);
}

function normalizePathSegments(value: string) {
  return value.replace(/\\/gu, "/").replace(/\/+/gu, "/");
}

function looksLikeWindowsDrivePath(value: string) {
  return /^[A-Za-z]:[\\/]/u.test(value);
}

function looksLikeUncPath(value: string) {
  return /^([\\/]{2})[^\\/]+[\\/][^\\/]+/u.test(value);
}

function looksLikePosixAbsolutePath(value: string) {
  return value.startsWith("/") && !value.startsWith("//");
}

function canonicalizeWindowsDrivePath(value: string) {
  const normalized = normalizePathSegments(value);
  return `${FILE_SCHEME_PREFIX}/${normalized}`;
}

function canonicalizeUncPath(value: string) {
  const trimmed = value.replace(/^([\\/]{2})+/u, "");
  const normalized = normalizePathSegments(trimmed);
  const [host, ...segments] = normalized.split("/").filter((segment) => segment.length > 0);

  if (!host) {
    return `${FILE_SCHEME_PREFIX}/`;
  }

  return `${FILE_SCHEME_PREFIX}${host}/${segments.join("/")}`;
}

function canonicalizePosixPath(value: string) {
  return `${FILE_SCHEME_PREFIX}${normalizePathSegments(value)}`;
}

function canonicalizeFileUrl(value: string) {
  const withoutScheme = value.slice(FILE_SCHEME_PREFIX.length);

  if (looksLikeWindowsDrivePath(withoutScheme)) {
    return canonicalizeWindowsDrivePath(withoutScheme);
  }

  if (withoutScheme.startsWith("/") && looksLikeWindowsDrivePath(withoutScheme.slice(1))) {
    return canonicalizeWindowsDrivePath(withoutScheme.slice(1));
  }

  if (looksLikeUncPath(withoutScheme)) {
    return canonicalizeUncPath(withoutScheme);
  }

  if (looksLikePosixAbsolutePath(withoutScheme)) {
    return canonicalizePosixPath(withoutScheme);
  }

  return `${FILE_SCHEME_PREFIX}${normalizePathSegments(withoutScheme)}`;
}

function canonicalizeOpaqueUri(prefix: string, value: string) {
  const normalized = normalizePathSegments(value.slice(prefix.length));
  return `${prefix}${normalized.replace(/^\/+|\/+$/gu, "")}`;
}

export function canonicalizeArtifactReference(reference: string) {
  const trimmed = reference.trim();

  if (trimmed.startsWith(FILE_SCHEME_PREFIX)) {
    return canonicalizeFileUrl(trimmed);
  }

  if (trimmed.startsWith(ARTIFACT_SCHEME_PREFIX)) {
    return canonicalizeOpaqueUri(ARTIFACT_SCHEME_PREFIX, trimmed);
  }

  if (trimmed.startsWith(OBJECT_STORE_SCHEME_PREFIX)) {
    return canonicalizeOpaqueUri(OBJECT_STORE_SCHEME_PREFIX, trimmed);
  }

  if (looksLikeWindowsDrivePath(trimmed)) {
    return canonicalizeWindowsDrivePath(trimmed);
  }

  if (looksLikeUncPath(trimmed)) {
    return canonicalizeUncPath(trimmed);
  }

  if (looksLikePosixAbsolutePath(trimmed)) {
    return canonicalizePosixPath(trimmed);
  }

  return trimmed;
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

function isSyntheticSeriesInstanceUid(series: StudyContextRecord["series"][number]) {
  return series.syntheticSeriesInstanceUid || /^series-\d+$/u.test(series.seriesInstanceUid);
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
    studyContext.series.find((series) => !isSyntheticSeriesInstanceUid(series))
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
  artifactStorageOverrides?: ArtifactStorageOverride[];
}): DerivedArtifactDescriptor[] {
  const archiveLocator = createArchiveLocator(input.studyContext);
  const storageOverrideByRef = new Map(
    (input.artifactStorageOverrides ?? []).map((override) => [
      canonicalizeArtifactReference(override.artifactRef),
      {
        ...override,
        storageUri: canonicalizeArtifactReference(override.storageUri),
      },
    ]),
  );

  return input.artifactRefs.map((reference, index) => {
    const canonicalRef = canonicalizeArtifactReference(reference);
    const storageOverride = storageOverrideByRef.get(canonicalRef);
    const storageUri = storageOverride?.storageUri ?? canonicalRef;
    const artifactType = classifyArtifactType(storageUri);
    const viewerDescriptor = createViewerDescriptor({
      artifactType,
      studyContext: input.studyContext,
    });
    const artifactId = `${input.caseId}-artifact-${index + 1}`;

    return {
      artifactId,
      artifactType,
      label: labelForArtifactType(artifactType),
      storageUri,
      retrievalUrl: supportsApiArtifactRetrieval(storageUri)
        ? `/api/cases/${input.caseId}/artifacts/${artifactId}`
        : null,
      mimeType: storageOverride?.mimeType ?? mimeTypeForArtifactType(artifactType),
      contentSha256: storageOverride?.contentSha256 ?? null,
      byteSize: storageOverride?.byteSize ?? null,
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
      plannedStorageUri: canonicalizeArtifactReference(`object-store://case-artifacts/${plannedStorageKey}`),
    };
  });
}