export type QcCheckStatus = "pass" | "warn" | "reject";

export interface StudySeriesInput {
  seriesInstanceUid: string;
  syntheticSeriesInstanceUid?: boolean;
  seriesDescription?: string;
  modality?: string;
  sequenceLabel?: string;
  instanceCount?: number;
  volumeDownloadUrl?: string;
}

export interface StudyContextInput {
  studyInstanceUid?: string;
  accessionNumber?: string;
  studyDate?: string;
  sourceArchive?: string;
  dicomWebBaseUrl?: string;
  metadataSummary?: string[];
  series?: StudySeriesInput[];
}

export interface StudySeriesRecord {
  seriesInstanceUid: string;
  syntheticSeriesInstanceUid: boolean;
  seriesDescription: string | null;
  modality: string;
  sequenceLabel: string | null;
  instanceCount: number | null;
  volumeDownloadUrl: string | null;
}

export interface StudyContextRecord {
  studyInstanceUid: string;
  dicomStudyInstanceUid: string;
  accessionNumber: string | null;
  studyDate: string | null;
  sourceArchive: string | null;
  dicomWebBaseUrl: string | null;
  metadataSummary: string[];
  series: StudySeriesRecord[];
  receivedAt: string;
  source: "public-api" | "internal-ingest";
}

export interface QcMetricInput {
  name: string;
  value: number;
  unit?: string;
}

export interface QcCheckInput {
  checkId: string;
  status: QcCheckStatus;
  detail: string;
}

export interface QcSummaryInput {
  summary?: string;
  checks?: QcCheckInput[];
  metrics?: QcMetricInput[];
}

export interface QcMetricRecord {
  name: string;
  value: number;
  unit: string | null;
}

export interface QcCheckRecord {
  checkId: string;
  status: QcCheckStatus;
  detail: string;
}

export interface QcSummaryRecord {
  disposition: QcCheckStatus | "pending";
  summary: string | null;
  checkedAt: string | null;
  source: "pending" | "internal-inference";
  checks: QcCheckRecord[];
  metrics: QcMetricRecord[];
  issues: string[];
}

function normalizeString(value: string | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createStudyContextRecord(input: {
  fallbackStudyUid: string;
  receivedAt: string;
  source: "public-api" | "internal-ingest";
  studyContext?: StudyContextInput;
}): StudyContextRecord {
  const series = (input.studyContext?.series ?? []).map((entry) => ({
    seriesInstanceUid: entry.seriesInstanceUid,
    syntheticSeriesInstanceUid: entry.syntheticSeriesInstanceUid === true,
    seriesDescription: normalizeString(entry.seriesDescription),
    modality: normalizeString(entry.modality) ?? "MR",
    sequenceLabel: normalizeString(entry.sequenceLabel),
    instanceCount: typeof entry.instanceCount === "number" ? entry.instanceCount : null,
    volumeDownloadUrl: normalizeString(entry.volumeDownloadUrl),
  }));

  return {
    studyInstanceUid: normalizeString(input.studyContext?.studyInstanceUid) ?? input.fallbackStudyUid,
    dicomStudyInstanceUid: normalizeString(input.studyContext?.studyInstanceUid) ?? input.fallbackStudyUid,
    accessionNumber: normalizeString(input.studyContext?.accessionNumber),
    studyDate: normalizeString(input.studyContext?.studyDate),
    sourceArchive: normalizeString(input.studyContext?.sourceArchive),
    dicomWebBaseUrl: normalizeString(input.studyContext?.dicomWebBaseUrl),
    metadataSummary: (input.studyContext?.metadataSummary ?? []).map((value) => String(value)),
    series,
    receivedAt: input.receivedAt,
    source: input.source,
  };
}

export function createPendingQcSummary(): QcSummaryRecord {
  return {
    disposition: "pending",
    summary: null,
    checkedAt: null,
    source: "pending",
    checks: [],
    metrics: [],
    issues: [],
  };
}

export function createQcSummaryRecord(input: {
  disposition: QcCheckStatus;
  checkedAt: string;
  issues?: string[];
  qcSummary?: QcSummaryInput;
}): QcSummaryRecord {
  return {
    disposition: input.disposition,
    summary: normalizeString(input.qcSummary?.summary),
    checkedAt: input.checkedAt,
    source: "internal-inference",
    checks: (input.qcSummary?.checks ?? []).map((entry) => ({
      checkId: entry.checkId,
      status: entry.status,
      detail: entry.detail,
    })),
    metrics: (input.qcSummary?.metrics ?? []).map((entry) => ({
      name: entry.name,
      value: entry.value,
      unit: normalizeString(entry.unit),
    })),
    issues: (input.issues ?? []).map((value) => String(value)),
  };
}