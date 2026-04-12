import type { StudyContextInput, StudySeriesInput } from "./case-imaging";

export interface ArchiveLookupConfig {
  archiveLookupBaseUrl?: string;
  archiveLookupSource?: string;
  archiveLookupMode?: ArchiveLookupMode;
}

export type ArchiveLookupMode = "custom" | "dicomweb";

export type ArchiveLookupResult =
  | { status: "found"; studyContext: StudyContextInput }
  | { status: "not-found" }
  | { status: "not-configured" }
  | { status: "error"; reason: "timeout" | "network" | "server-error" | "circuit-open"; httpStatus?: number };

export interface ArchiveLookupClient {
  isConfigured(): boolean;
  lookupStudy(studyUid: string): Promise<ArchiveLookupResult>;
}

type CircuitState = "closed" | "open" | "half-open";

const ARCHIVE_LOOKUP_FAILURE_THRESHOLD = 3;
const ARCHIVE_LOOKUP_COOLDOWN_MS = 30_000;

function normalizeString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => typeof entry === "string");

  return normalized.length > 0 ? normalized : undefined;
}

function parseStudyContextPayload(
  payload: unknown,
  archiveLookupSource?: string,
): StudyContextInput | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const parsedSeries = Array.isArray(record.series)
    ? record.series
        .map((entry, index) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const seriesRecord = entry as Record<string, unknown>;
          return {
            seriesInstanceUid: normalizeString(seriesRecord.seriesInstanceUid) ?? `series-${index + 1}`,
            seriesDescription: normalizeString(seriesRecord.seriesDescription),
            modality: normalizeString(seriesRecord.modality),
            sequenceLabel: normalizeString(seriesRecord.sequenceLabel),
            instanceCount: normalizeNumber(seriesRecord.instanceCount),
            volumeDownloadUrl: normalizeString(seriesRecord.volumeDownloadUrl),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : undefined;

  const studyContext: StudyContextInput = {
    studyInstanceUid: normalizeString(record.studyInstanceUid),
    accessionNumber: normalizeString(record.accessionNumber),
    studyDate: normalizeString(record.studyDate),
    sourceArchive: normalizeString(record.sourceArchive) ?? normalizeString(archiveLookupSource),
    dicomWebBaseUrl: normalizeString(record.dicomWebBaseUrl),
    metadataSummary: normalizeStringArray(record.metadataSummary),
    series: parsedSeries && parsedSeries.length > 0 ? parsedSeries : undefined,
  };

  if (
    !studyContext.studyInstanceUid &&
    !studyContext.accessionNumber &&
    !studyContext.studyDate &&
    !studyContext.sourceArchive &&
    !studyContext.dicomWebBaseUrl &&
    (!studyContext.series || studyContext.series.length === 0)
  ) {
    return null;
  }

  return studyContext;
}

export function createArchiveLookupClient(config: ArchiveLookupConfig): ArchiveLookupClient {
  const archiveLookupBaseUrl = normalizeString(config.archiveLookupBaseUrl);
  const archiveLookupSource = normalizeString(config.archiveLookupSource);
  const mode: ArchiveLookupMode = config.archiveLookupMode ?? "custom";
  let circuitState: CircuitState = "closed";
  let failureCount = 0;
  let lastFailureAt = 0;
  const normalizedBaseUrl = archiveLookupBaseUrl
    ? archiveLookupBaseUrl.endsWith("/")
      ? archiveLookupBaseUrl
      : `${archiveLookupBaseUrl}/`
    : undefined;

  const resetCircuit = () => {
    circuitState = "closed";
    failureCount = 0;
    lastFailureAt = 0;
  };

  const recordFailure = () => {
    failureCount += 1;
    lastFailureAt = Date.now();
    if (circuitState === "half-open" || failureCount >= ARCHIVE_LOOKUP_FAILURE_THRESHOLD) {
      circuitState = "open";
    }
  };

  const withCircuitBreaker = async (lookup: () => Promise<ArchiveLookupResult>) => {
    if (circuitState === "open") {
      const cooldownElapsed = Date.now() - lastFailureAt >= ARCHIVE_LOOKUP_COOLDOWN_MS;
      if (!cooldownElapsed) {
        return { status: "error", reason: "circuit-open", httpStatus: 503 } satisfies ArchiveLookupResult;
      }

      circuitState = "half-open";
    }

    const result = await lookup();

    if (result.status === "found" || result.status === "not-found") {
      resetCircuit();
      return result;
    }

    if (result.status === "error" && result.reason !== "circuit-open") {
      recordFailure();
    }

    return result;
  };

  return {
    isConfigured() {
      return Boolean(normalizedBaseUrl);
    },
    async lookupStudy(studyUid: string): Promise<ArchiveLookupResult> {
      if (!normalizedBaseUrl) {
        return { status: "not-configured" };
      }

      if (mode === "dicomweb") {
        return withCircuitBreaker(() => lookupStudyDicomWeb(normalizedBaseUrl, studyUid, archiveLookupSource));
      }

      return withCircuitBreaker(() => lookupStudyCustom(normalizedBaseUrl, studyUid, archiveLookupSource));
    },
  };
}

// ---------------------------------------------------------------------------
// Custom archive protocol (original)
// ---------------------------------------------------------------------------

async function lookupStudyCustom(
  baseUrl: string,
  studyUid: string,
  archiveLookupSource: string | undefined,
): Promise<ArchiveLookupResult> {
  const requestUrl = new URL(`studies/${encodeURIComponent(studyUid)}`, baseUrl);

  try {
    const response = await fetch(requestUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 404) {
      return { status: "not-found" };
    }

    if (!response.ok) {
      return { status: "error", reason: "server-error", httpStatus: response.status };
    }

    const studyContext = parseStudyContextPayload(await response.json(), archiveLookupSource);
    if (!studyContext) {
      return { status: "not-found" };
    }

    return { status: "found", studyContext };
  } catch (error: unknown) {
    const reason =
      error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network";
    return { status: "error", reason };
  }
}

// ---------------------------------------------------------------------------
// DICOMweb QIDO-RS / WADO-RS (R-01 academic audit recommendation)
// ---------------------------------------------------------------------------

const DICOM_TAG_STUDY_INSTANCE_UID = "0020000D";
const DICOM_TAG_ACCESSION_NUMBER = "00080050";
const DICOM_TAG_STUDY_DATE = "00080020";
const DICOM_TAG_SERIES_INSTANCE_UID = "0020000E";
const DICOM_TAG_SERIES_DESCRIPTION = "0008103E";
const DICOM_TAG_MODALITY = "00080060";
const DICOM_TAG_NUMBER_OF_INSTANCES = "00201208";

function dicomTagValue(dataset: Record<string, unknown>, tag: string): string | undefined {
  const entry = dataset[tag] as { Value?: unknown[] } | undefined;
  if (!entry || !Array.isArray(entry.Value) || entry.Value.length === 0) {
    return undefined;
  }
  const first = entry.Value[0];
  return typeof first === "string" ? first.trim() || undefined : typeof first === "number" ? String(first) : undefined;
}

function dicomTagNumber(dataset: Record<string, unknown>, tag: string): number | undefined {
  const entry = dataset[tag] as { Value?: unknown[] } | undefined;
  if (!entry || !Array.isArray(entry.Value) || entry.Value.length === 0) {
    return undefined;
  }
  const first = entry.Value[0];
  return typeof first === "number" && Number.isFinite(first) ? first : undefined;
}

function buildWadoRsSeriesUrl(baseUrl: string, studyUid: string, seriesUid: string): string {
  return `${baseUrl}studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUid)}`;
}

async function lookupStudyDicomWeb(
  baseUrl: string,
  studyUid: string,
  archiveLookupSource: string | undefined,
): Promise<ArchiveLookupResult> {
  try {
    // Step 1: QIDO-RS study-level query
    const qidoStudyUrl = new URL(
      `studies?StudyInstanceUID=${encodeURIComponent(studyUid)}&limit=1`,
      baseUrl,
    );
    const studyResponse = await fetch(qidoStudyUrl, {
      headers: { accept: "application/dicom+json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (studyResponse.status === 404) {
      return { status: "not-found" };
    }

    if (!studyResponse.ok) {
      return { status: "error", reason: "server-error", httpStatus: studyResponse.status };
    }

    const studyResults = (await studyResponse.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(studyResults) || studyResults.length === 0) {
      return { status: "not-found" };
    }

    const studyDataset = studyResults[0];
    const studyInstanceUid = dicomTagValue(studyDataset, DICOM_TAG_STUDY_INSTANCE_UID) ?? studyUid;
    const accessionNumber = dicomTagValue(studyDataset, DICOM_TAG_ACCESSION_NUMBER);
    const studyDate = dicomTagValue(studyDataset, DICOM_TAG_STUDY_DATE);

    // Step 2: QIDO-RS series-level query for this study
    const qidoSeriesUrl = new URL(
      `studies/${encodeURIComponent(studyUid)}/series`,
      baseUrl,
    );
    const seriesResponse = await fetch(qidoSeriesUrl, {
      headers: { accept: "application/dicom+json" },
      signal: AbortSignal.timeout(10_000),
    });

    let series: StudySeriesInput[] | undefined;

    if (seriesResponse.ok) {
      const seriesResults = (await seriesResponse.json()) as Array<Record<string, unknown>>;
      if (Array.isArray(seriesResults) && seriesResults.length > 0) {
        series = seriesResults
          .map((seriesDataset, index): StudySeriesInput => {
            const seriesInstanceUid =
              dicomTagValue(seriesDataset, DICOM_TAG_SERIES_INSTANCE_UID) ?? `series-${index + 1}`;
            return {
              seriesInstanceUid,
              seriesDescription: dicomTagValue(seriesDataset, DICOM_TAG_SERIES_DESCRIPTION),
              modality: dicomTagValue(seriesDataset, DICOM_TAG_MODALITY),
              instanceCount: dicomTagNumber(seriesDataset, DICOM_TAG_NUMBER_OF_INSTANCES),
              volumeDownloadUrl: buildWadoRsSeriesUrl(baseUrl, studyUid, seriesInstanceUid),
            };
          });
      }
    }

    const studyContext: StudyContextInput = {
      studyInstanceUid,
      accessionNumber,
      studyDate,
      sourceArchive: archiveLookupSource ?? "dicomweb",
      dicomWebBaseUrl: baseUrl,
      series,
    };

    return { status: "found", studyContext };
  } catch (error: unknown) {
    const reason =
      error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network";
    return { status: "error", reason };
  }
}