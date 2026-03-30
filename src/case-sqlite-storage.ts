import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaseRecord, DeliveryJobRecord, InferenceJobRecord } from "./cases";
import {
  backfillStructuralExecutionEnvelope,
  createDefaultStructuralExecutionContext,
} from "./case-planning";
import { createDerivedArtifactDescriptors } from "./case-artifacts";
import { formatWorkflowPackageVersion, getWorkflowPackageManifest } from "./workflow-packages";

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
      last_error TEXT,
      lease_id TEXT,
      lease_expires_at TEXT,
      failure_class TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inference_jobs_status_available
    ON inference_jobs (status, available_at ASC);

    CREATE INDEX IF NOT EXISTS idx_inference_jobs_case_id
    ON inference_jobs (case_id, updated_at DESC);
  `);

  const inferenceJobColumns = new Set(
    (
      database.prepare("PRAGMA table_info(inference_jobs)").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );

  if (!inferenceJobColumns.has("lease_id")) {
    database.exec("ALTER TABLE inference_jobs ADD COLUMN lease_id TEXT;");
  }

  if (!inferenceJobColumns.has("lease_expires_at")) {
    database.exec("ALTER TABLE inference_jobs ADD COLUMN lease_expires_at TEXT;");
  }

  if (!inferenceJobColumns.has("failure_class")) {
    database.exec("ALTER TABLE inference_jobs ADD COLUMN failure_class TEXT;");
  }

  return database;
}

export function parseStoredCaseRecord(payloadJson: string): LoadedSqliteCaseRecord {
  const parsed = JSON.parse(payloadJson) as CaseRecord;
  return {
    caseRecord: normalizeStoredCaseRecord(parsed),
  };
}

export function normalizeStoredCaseRecord(parsed: CaseRecord): CaseRecord {
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
          packageManifest: getWorkflowPackageManifest(parsed.planEnvelope.packageResolution.selectedPackage),
        })
      : []);
  const selectedPackageManifest = getWorkflowPackageManifest(
    parsed.structuralExecution?.packageId ?? parsed.planEnvelope.packageResolution.selectedPackage,
  );
  const normalizedArtifactManifest = artifactManifest.map((artifact) => ({
    ...artifact,
    retrievalUrl:
      typeof artifact.retrievalUrl === "string"
        ? artifact.retrievalUrl
        : artifact.storageUri.startsWith("file://")
          ? `/api/cases/${parsed.caseId}/artifacts/${artifact.artifactId}`
          : null,
    producingPackageId: artifact.producingPackageId ?? selectedPackageManifest?.packageId ?? null,
    producingPackageVersion: artifact.producingPackageVersion ?? selectedPackageManifest?.packageVersion ?? null,
    workflowFamily: artifact.workflowFamily ?? (selectedPackageManifest?.workflowFamily ?? "brain-structural"),
    exportCompatibilityTags: Array.isArray(artifact.exportCompatibilityTags)
      ? [...artifact.exportCompatibilityTags]
      : [...(selectedPackageManifest?.outputContracts.exportCompatibility ?? [])],
  }));
  const report = parsed.report
    ? {
        ...parsed.report,
        derivedArtifacts: undefined,
        executionContext: createDefaultStructuralExecutionContext(
          parsed.report.executionContext ?? parsed.structuralExecution?.executionContext,
        ),
        provenance: {
          ...parsed.report.provenance,
          workflowVersion:
            parsed.report.provenance.workflowVersion ??
            formatWorkflowPackageVersion(parsed.structuralExecution ?? selectedPackageManifest) ??
            "brain-structural-fastsurfer@0.1.0",
        },
      }
    : null;
  const structuralExecution = parsed.structuralExecution
    ? {
        ...parsed.structuralExecution,
        executionContext: createDefaultStructuralExecutionContext(
          parsed.structuralExecution.executionContext ?? report?.executionContext,
        ),
        artifactIds: Array.isArray(parsed.structuralExecution.artifactIds)
          ? [...parsed.structuralExecution.artifactIds]
          : normalizedArtifactManifest.map((artifact) => artifact.artifactId),
      }
    : backfillStructuralExecutionEnvelope({
        caseRecord: {
          ...parsed,
          studyContext,
          artifactManifest: normalizedArtifactManifest,
          report,
        },
        artifactIds: normalizedArtifactManifest.map((artifact) => artifact.artifactId),
      });

  return {
    ...parsed,
    studyContext,
    structuralExecution,
    artifactManifest: normalizedArtifactManifest,
    report,
    lastInferenceFingerprint: parsed.lastInferenceFingerprint ?? null,
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
  lease_id?: string | null;
  lease_expires_at?: string | null;
  failure_class?: string | null;
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
      leaseId: row.lease_id ?? null,
      leaseExpiresAt: row.lease_expires_at ?? null,
      failureClass: (row.failure_class as InferenceJobRecord["failureClass"]) ?? null,
    },
  };
}