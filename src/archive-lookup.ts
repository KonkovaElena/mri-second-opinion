import type { StudyContextInput } from "./case-imaging";

export interface ArchiveLookupConfig {
  archiveLookupBaseUrl?: string;
  archiveLookupSource?: string;
}

export type ArchiveLookupResult =
  | { status: "found"; studyContext: StudyContextInput }
  | { status: "not-found" }
  | { status: "not-configured" }
  | { status: "error"; reason: "timeout" | "network" | "server-error"; httpStatus?: number };

export interface ArchiveLookupClient {
  isConfigured(): boolean;
  lookupStudy(studyUid: string): Promise<ArchiveLookupResult>;
}

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
  const normalizedBaseUrl = archiveLookupBaseUrl
    ? archiveLookupBaseUrl.endsWith("/")
      ? archiveLookupBaseUrl
      : `${archiveLookupBaseUrl}/`
    : undefined;

  return {
    isConfigured() {
      return Boolean(normalizedBaseUrl);
    },
    async lookupStudy(studyUid: string): Promise<ArchiveLookupResult> {
      if (!normalizedBaseUrl) {
        return { status: "not-configured" };
      }

      const requestUrl = new URL(`studies/${encodeURIComponent(studyUid)}`, normalizedBaseUrl);

      try {
        const response = await fetch(requestUrl, {
          headers: {
            accept: "application/json",
          },
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
    },
  };
}