import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaseRecord, DeliveryJobRecord, InferenceJobRecord } from "./cases";
import { createDerivedArtifactDescriptors } from "./case-artifacts";

export interface LoadedSqliteCaseRecord {
  caseRecord: CaseRecord;
}

export interface LoadedSqliteDeliveryJobRecord {
  deliveryJob: DeliveryJobRecord;
}

export interface LoadedSqliteInferenceJobRecord {
  inferenceJob: InferenceJobRecord;
}

export function openCaseDatabase(databaseFilePath: string) {
  mkdirSync(dirname(databaseFilePath), { recursive: true });

  const database = new DatabaseSync(databaseFilePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS store_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO store_metadata (key, value)
    VALUES ('revision', '0');

    CREATE TABLE IF NOT EXISTS case_records (
      case_id TEXT PRIMARY KEY,
      study_uid TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_case_records_status
    ON case_records (status);

    CREATE INDEX IF NOT EXISTS idx_case_records_updated_at
    ON case_records (updated_at DESC);

    CREATE TABLE IF NOT EXISTS delivery_jobs (
      job_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      enqueued_at TEXT NOT NULL,
      available_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      worker_id TEXT,
      claimed_at TEXT,
      completed_at TEXT,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_jobs_status_available
    ON delivery_jobs (status, available_at ASC);

    CREATE INDEX IF NOT EXISTS idx_delivery_jobs_case_id
    ON delivery_jobs (case_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS inference_jobs (
      job_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      enqueued_at TEXT NOT NULL,
      available_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      worker_id TEXT,
      claimed_at TEXT,
      completed_at TEXT,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inference_jobs_status_available
    ON inference_jobs (status, available_at ASC);

    CREATE INDEX IF NOT EXISTS idx_inference_jobs_case_id
    ON inference_jobs (case_id, updated_at DESC);
  `);

  return database;
}

export function parseStoredCaseRecord(payloadJson: string): LoadedSqliteCaseRecord {
  const parsed = JSON.parse(payloadJson) as CaseRecord;
  const studyContext = {
    ...parsed.studyContext,
    studyInstanceUid:
      parsed.studyContext.studyInstanceUid ??
      parsed.studyContext.dicomStudyInstanceUid ??
      parsed.studyUid,
    dicomStudyInstanceUid:
      parsed.studyContext.dicomStudyInstanceUid ??
      parsed.studyContext.studyInstanceUid ??
      parsed.studyUid,
    series: parsed.studyContext.series ?? [],
    metadataSummary: parsed.studyContext.metadataSummary ?? [],
  };
  const artifactManifest =
    parsed.artifactManifest ??
    parsed.report?.derivedArtifacts ??
    (parsed.report
      ? createDerivedArtifactDescriptors({
          caseId: parsed.caseId,
          studyUid: parsed.studyUid,
          artifactRefs: parsed.report.artifacts ?? [],
          studyContext,
          generatedAt: parsed.report.provenance.generatedAt,
        })
      : []);
  const report = parsed.report
    ? {
        ...parsed.report,
        derivedArtifacts: undefined,
      }
    : null;

  return {
    caseRecord: {
      ...parsed,
      studyContext,
      artifactManifest,
      report,
      lastInferenceFingerprint: parsed.lastInferenceFingerprint ?? null,
    },
  };
}

export function parseStoredDeliveryJobRecord(row: {
  job_id: string;
  case_id: string;
  status: string;
  attempt_count: number;
  enqueued_at: string;
  available_at: string;
  updated_at: string;
  worker_id: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}): LoadedSqliteDeliveryJobRecord {
  return {
    deliveryJob: {
      jobId: row.job_id,
      caseId: row.case_id,
      status: row.status as DeliveryJobRecord["status"],
      attemptCount: Number(row.attempt_count ?? 0),
      enqueuedAt: row.enqueued_at,
      availableAt: row.available_at,
      updatedAt: row.updated_at,
      workerId: row.worker_id ?? null,
      claimedAt: row.claimed_at ?? null,
      completedAt: row.completed_at ?? null,
      lastError: row.last_error ?? null,
    },
  };
}

export function parseStoredInferenceJobRecord(row: {
  job_id: string;
  case_id: string;
  status: string;
  attempt_count: number;
  enqueued_at: string;
  available_at: string;
  updated_at: string;
  worker_id: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}): LoadedSqliteInferenceJobRecord {
  return {
    inferenceJob: {
      jobId: row.job_id,
      caseId: row.case_id,
      status: row.status as InferenceJobRecord["status"],
      attemptCount: Number(row.attempt_count ?? 0),
      enqueuedAt: row.enqueued_at,
      availableAt: row.available_at,
      updatedAt: row.updated_at,
      workerId: row.worker_id ?? null,
      claimedAt: row.claimed_at ?? null,
      completedAt: row.completed_at ?? null,
      lastError: row.last_error ?? null,
    },
  };
}