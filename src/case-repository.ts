import type { CaseRecord, DeliveryJobRecord, InferenceJobRecord } from "./cases";
import {
  loadPersistedCaseSnapshot,
  savePersistedCaseSnapshot,
} from "./case-storage";
import {
  PostgresCaseRepository,
  type PostgresPoolFactory,
} from "./case-postgres-repository";
import {
  openCaseDatabase,
  parseStoredDeliveryJobRecord,
  parseStoredInferenceJobRecord,
  parseStoredCaseRecord,
} from "./case-sqlite-storage";

export type CaseStoreMode = "snapshot" | "sqlite" | "postgres";

export interface CaseRepository {
  list(): Promise<CaseRecord[]>;
  get(caseId: string): Promise<CaseRecord | undefined>;
  getSnapshot(caseId: string): Promise<CaseRecord | null>;
  set(caseRecord: CaseRecord): void;
  delete(caseId: string): void;
  size(): Promise<number>;
  values(): Promise<CaseRecord[]>;
  findByStudyUid(studyUid: string): Promise<CaseRecord | null>;
  listDeliveryJobs(): Promise<DeliveryJobRecord[]>;
  setDeliveryJob(deliveryJob: DeliveryJobRecord): void;
  replaceDeliveryJobs(deliveryJobs: Iterable<DeliveryJobRecord>): void;
  listInferenceJobs(): Promise<InferenceJobRecord[]>;
  setInferenceJob(inferenceJob: InferenceJobRecord): void;
  replaceInferenceJobs(inferenceJobs: Iterable<InferenceJobRecord>): void;
  reload(): Promise<void>;
  save(): Promise<void>;
  close(): Promise<void>;
}

export interface CaseRepositoryOptions {
  caseStoreFilePath?: string;
  storageMode?: CaseStoreMode;
  databaseUrl?: string;
  schema?: string;
  postgresPoolFactory?: PostgresPoolFactory;
}

interface SnapshotCaseRepositoryOptions {
  snapshotFilePath?: string;
}

function cloneCase<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createCaseRepository(options: CaseRepositoryOptions = {}): CaseRepository {
  const storageMode = options.storageMode ?? "sqlite";

  if (storageMode === "snapshot") {
    return new SnapshotCaseRepository({ snapshotFilePath: options.caseStoreFilePath });
  }

  if (storageMode === "postgres") {
    if (!options.databaseUrl) {
      throw new Error("databaseUrl is required for postgres storage mode");
    }

    return new PostgresCaseRepository({
      connectionString: options.databaseUrl,
      schema: options.schema ?? "public",
      poolFactory: options.postgresPoolFactory,
    }) as unknown as CaseRepository;
  }

  if (!options.caseStoreFilePath) {
    throw new Error("caseStoreFilePath is required for sqlite storage mode");
  }

  return new SqliteCaseRepository({ databaseFilePath: options.caseStoreFilePath });
}

export class SnapshotCaseRepository implements CaseRepository {
  private readonly cases = new Map<string, CaseRecord>();
  private deliveryJobs = new Map<string, DeliveryJobRecord>();
  private inferenceJobs = new Map<string, InferenceJobRecord>();
  private snapshotRevision = 0;

  constructor(private readonly options: SnapshotCaseRepositoryOptions = {}) {
    const snapshot = loadPersistedCaseSnapshot(this.options.snapshotFilePath);
    this.snapshotRevision = snapshot.revision;

    for (const caseRecord of snapshot.cases) {
      this.cases.set(caseRecord.caseId, caseRecord);
    }

    for (const deliveryJob of snapshot.deliveryJobs) {
      this.deliveryJobs.set(deliveryJob.jobId, deliveryJob);
    }

    for (const inferenceJob of snapshot.inferenceJobs) {
      this.inferenceJobs.set(inferenceJob.jobId, inferenceJob);
    }
  }

  async list() {
    return Array.from(this.cases.values())
      .map(cloneCase)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async get(caseId: string) {
    return this.cases.get(caseId);
  }

  async getSnapshot(caseId: string) {
    const caseRecord = this.cases.get(caseId);
    return caseRecord ? cloneCase(caseRecord) : null;
  }

  set(caseRecord: CaseRecord) {
    this.cases.set(caseRecord.caseId, caseRecord);
  }

  delete(caseId: string) {
    this.cases.delete(caseId);
  }

  async size() {
    return this.cases.size;
  }

  async values() {
    return Array.from(this.cases.values());
  }

  async findByStudyUid(studyUid: string) {
    return Array.from(this.cases.values()).find((caseRecord) => caseRecord.studyUid === studyUid) ?? null;
  }

  async listDeliveryJobs() {
    return Array.from(this.deliveryJobs.values())
      .map(cloneCase)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.enqueuedAt.localeCompare(left.enqueuedAt));
  }

  setDeliveryJob(deliveryJob: DeliveryJobRecord) {
    this.deliveryJobs.set(deliveryJob.jobId, deliveryJob);
  }

  replaceDeliveryJobs(deliveryJobs: Iterable<DeliveryJobRecord>) {
    this.deliveryJobs = new Map(Array.from(deliveryJobs, (deliveryJob) => [deliveryJob.jobId, cloneCase(deliveryJob)]));
  }

  async listInferenceJobs() {
    return Array.from(this.inferenceJobs.values())
      .map(cloneCase)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.enqueuedAt.localeCompare(left.enqueuedAt));
  }

  setInferenceJob(inferenceJob: InferenceJobRecord) {
    this.inferenceJobs.set(inferenceJob.jobId, inferenceJob);
  }

  replaceInferenceJobs(inferenceJobs: Iterable<InferenceJobRecord>) {
    this.inferenceJobs = new Map(Array.from(inferenceJobs, (inferenceJob) => [inferenceJob.jobId, cloneCase(inferenceJob)]));
  }

  async reload() {
    const snapshot = loadPersistedCaseSnapshot(this.options.snapshotFilePath);
    this.snapshotRevision = snapshot.revision;
    this.cases.clear();
    this.deliveryJobs.clear();
    this.inferenceJobs.clear();

    for (const caseRecord of snapshot.cases) {
      this.cases.set(caseRecord.caseId, caseRecord);
    }

    for (const deliveryJob of snapshot.deliveryJobs) {
      this.deliveryJobs.set(deliveryJob.jobId, deliveryJob);
    }

    for (const inferenceJob of snapshot.inferenceJobs) {
      this.inferenceJobs.set(inferenceJob.jobId, inferenceJob);
    }
  }

  async save() {
    this.snapshotRevision = savePersistedCaseSnapshot(
      this.options.snapshotFilePath,
      this.snapshotRevision,
      this.cases.values(),
      this.deliveryJobs.values(),
      this.inferenceJobs.values(),
    );
  }

  async close() {}
}

interface SqliteCaseRepositoryOptions {
  databaseFilePath: string;
}

class SqliteCaseRepository implements CaseRepository {
  private readonly cases = new Map<string, CaseRecord>();
  private readonly deliveryJobs = new Map<string, DeliveryJobRecord>();
  private readonly inferenceJobs = new Map<string, InferenceJobRecord>();
  private readonly dirtyCaseIds = new Set<string>();
  private readonly deletedCaseIds = new Set<string>();
  private readonly dirtyDeliveryJobIds = new Set<string>();
  private readonly dirtyInferenceJobIds = new Set<string>();
  private readonly database;
  private storeRevision = 0;

  private readonly selectAllCases;

  private readonly selectCaseByIdStatement;

  private readonly selectAllDeliveryJobsStatement;

  private readonly selectDeliveryJobByIdStatement;

  private readonly selectAllInferenceJobsStatement;

  private readonly selectInferenceJobByIdStatement;

  private readonly insertCaseStatement;

  private readonly updateCaseStatement;

  private readonly insertDeliveryJobStatement;

  private readonly updateDeliveryJobStatement;

  private readonly insertInferenceJobStatement;

  private readonly updateInferenceJobStatement;

  private readonly deleteCaseStatement;

  private readonly selectRevisionStatement;

  private readonly updateRevisionStatement;

  constructor(private readonly options: SqliteCaseRepositoryOptions) {
    this.database = openCaseDatabase(this.options.databaseFilePath);
    this.selectAllCases = this.database.prepare(
      `SELECT case_id, payload_json
       FROM case_records
       ORDER BY updated_at DESC`,
    );
    this.selectCaseByIdStatement = this.database.prepare(
      `SELECT case_id FROM case_records WHERE case_id = ?`,
    );
    this.selectAllDeliveryJobsStatement = this.database.prepare(
      `SELECT job_id, case_id, status, attempt_count, enqueued_at, available_at, updated_at, worker_id, claimed_at, completed_at, last_error
       FROM delivery_jobs
       ORDER BY updated_at DESC, enqueued_at DESC`,
    );
    this.selectDeliveryJobByIdStatement = this.database.prepare(
      `SELECT job_id FROM delivery_jobs WHERE job_id = ?`,
    );
    this.selectAllInferenceJobsStatement = this.database.prepare(
      `SELECT job_id, case_id, status, attempt_count, enqueued_at, available_at, updated_at, worker_id, claimed_at, completed_at, last_error, lease_id, lease_expires_at
       FROM inference_jobs
       ORDER BY updated_at DESC, enqueued_at DESC`,
    );
    this.selectInferenceJobByIdStatement = this.database.prepare(
      `SELECT job_id FROM inference_jobs WHERE job_id = ?`,
    );
    this.insertCaseStatement = this.database.prepare(
      `INSERT INTO case_records (
         case_id,
         study_uid,
         status,
         created_at,
         updated_at,
         payload_json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.updateCaseStatement = this.database.prepare(
      `UPDATE case_records
       SET study_uid = ?,
           status = ?,
           created_at = ?,
           updated_at = ?,
           payload_json = ?
       WHERE case_id = ?`,
    );
    this.insertDeliveryJobStatement = this.database.prepare(
      `INSERT INTO delivery_jobs (
         job_id,
         case_id,
         status,
         attempt_count,
         enqueued_at,
         available_at,
         updated_at,
         worker_id,
         claimed_at,
         completed_at,
         last_error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updateDeliveryJobStatement = this.database.prepare(
      `UPDATE delivery_jobs
       SET case_id = ?,
           status = ?,
           attempt_count = ?,
           enqueued_at = ?,
           available_at = ?,
           updated_at = ?,
           worker_id = ?,
           claimed_at = ?,
           completed_at = ?,
           last_error = ?
       WHERE job_id = ?`,
    );
     this.insertInferenceJobStatement = this.database.prepare(
      `INSERT INTO inference_jobs (
        job_id,
        case_id,
        status,
        attempt_count,
        enqueued_at,
        available_at,
        updated_at,
        worker_id,
        claimed_at,
        completed_at,
        last_error,
        lease_id,
        lease_expires_at,
        failure_class
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
     );
     this.updateInferenceJobStatement = this.database.prepare(
      `UPDATE inference_jobs
       SET case_id = ?,
          status = ?,
          attempt_count = ?,
          enqueued_at = ?,
          available_at = ?,
          updated_at = ?,
          worker_id = ?,
          claimed_at = ?,
          completed_at = ?,
           last_error = ?,
           lease_id = ?,
           lease_expires_at = ?,
           failure_class = ?
         WHERE job_id = ?`,
     );
    this.deleteCaseStatement = this.database.prepare(
      `DELETE FROM case_records WHERE case_id = ?`,
    );
    this.selectRevisionStatement = this.database.prepare(
      `SELECT value FROM store_metadata WHERE key = 'revision'`,
    );
    this.updateRevisionStatement = this.database.prepare(
      `UPDATE store_metadata SET value = ? WHERE key = 'revision'`,
    );

    try {
      this.reload();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  async list() {
    return Array.from(this.cases.values())
      .map(cloneCase)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async get(caseId: string) {
    return this.cases.get(caseId);
  }

  async getSnapshot(caseId: string) {
    const caseRecord = this.cases.get(caseId);
    return caseRecord ? cloneCase(caseRecord) : null;
  }

  set(caseRecord: CaseRecord) {
    this.cases.set(caseRecord.caseId, caseRecord);
    this.deletedCaseIds.delete(caseRecord.caseId);
    this.dirtyCaseIds.add(caseRecord.caseId);
  }

  delete(caseId: string) {
    if (this.cases.delete(caseId)) {
      this.deletedCaseIds.add(caseId);
    }
    this.dirtyCaseIds.delete(caseId);
  }

  async size() {
    return this.cases.size;
  }

  async values() {
    return Array.from(this.cases.values());
  }

  async findByStudyUid(studyUid: string) {
    return Array.from(this.cases.values()).find((caseRecord) => caseRecord.studyUid === studyUid) ?? null;
  }

  async listDeliveryJobs() {
    return Array.from(this.deliveryJobs.values())
      .map(cloneCase)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.enqueuedAt.localeCompare(left.enqueuedAt));
  }

  setDeliveryJob(deliveryJob: DeliveryJobRecord) {
    this.deliveryJobs.set(deliveryJob.jobId, deliveryJob);
    this.dirtyDeliveryJobIds.add(deliveryJob.jobId);
  }

  replaceDeliveryJobs(deliveryJobs: Iterable<DeliveryJobRecord>) {
    this.deliveryJobs.clear();
    for (const deliveryJob of deliveryJobs) {
      this.deliveryJobs.set(deliveryJob.jobId, cloneCase(deliveryJob));
    }
    this.dirtyDeliveryJobIds.clear();
  }

  async listInferenceJobs() {
    return Array.from(this.inferenceJobs.values())
      .map(cloneCase)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.enqueuedAt.localeCompare(left.enqueuedAt));
  }

  setInferenceJob(inferenceJob: InferenceJobRecord) {
    this.inferenceJobs.set(inferenceJob.jobId, inferenceJob);
    this.dirtyInferenceJobIds.add(inferenceJob.jobId);
  }

  replaceInferenceJobs(inferenceJobs: Iterable<InferenceJobRecord>) {
    this.inferenceJobs.clear();
    for (const inferenceJob of inferenceJobs) {
      this.inferenceJobs.set(inferenceJob.jobId, cloneCase(inferenceJob));
    }
    this.dirtyInferenceJobIds.clear();
  }

  async reload() {
    this.cases.clear();
    this.deliveryJobs.clear();
    this.inferenceJobs.clear();
    this.dirtyCaseIds.clear();
    this.deletedCaseIds.clear();
    this.dirtyDeliveryJobIds.clear();
    this.dirtyInferenceJobIds.clear();

    const revisionRow = this.selectRevisionStatement.get() as { value?: string | number | bigint } | undefined;
    this.storeRevision = revisionRow ? Number(revisionRow.value ?? 0) : 0;

    for (const row of this.selectAllCases.iterate() as Iterable<{ case_id: string; payload_json: string }>) {
      const { caseRecord } = parseStoredCaseRecord(row.payload_json);
      this.cases.set(row.case_id, caseRecord);
    }

    for (const row of this.selectAllDeliveryJobsStatement.iterate() as Iterable<{
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
    }>) {
      const { deliveryJob } = parseStoredDeliveryJobRecord(row);
      this.deliveryJobs.set(row.job_id, deliveryJob);
    }

    for (const row of this.selectAllInferenceJobsStatement.iterate() as Iterable<{
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
      lease_id: string | null;
      lease_expires_at: string | null;
      failure_class: string | null;
    }>) {
      const { inferenceJob } = parseStoredInferenceJobRecord(row);
      this.inferenceJobs.set(row.job_id, inferenceJob);
    }
  }

  async save() {
    const currentRevision = this.readStoreRevision();
    if (currentRevision !== this.storeRevision) {
      throw new Error("Concurrent case store modification detected");
    }

    this.database.exec("BEGIN IMMEDIATE");

    try {
      for (const caseId of this.deletedCaseIds) {
        this.deleteCaseStatement.run(caseId);
      }

      for (const caseId of this.dirtyCaseIds) {
        const caseRecord = this.cases.get(caseId);
        if (!caseRecord) {
          continue;
        }

        const payloadJson = JSON.stringify(caseRecord);
        const existing = this.selectCaseByIdStatement.get(caseId) as { case_id?: string } | undefined;

        if (existing?.case_id) {
          this.updateCaseStatement.run(
            caseRecord.studyUid,
            caseRecord.status,
            caseRecord.createdAt,
            caseRecord.updatedAt,
            payloadJson,
            caseId,
          );
        } else {
          this.insertCaseStatement.run(
            caseId,
            caseRecord.studyUid,
            caseRecord.status,
            caseRecord.createdAt,
            caseRecord.updatedAt,
            payloadJson,
          );
        }
      }

      for (const jobId of this.dirtyDeliveryJobIds) {
        const deliveryJob = this.deliveryJobs.get(jobId);
        if (!deliveryJob) {
          continue;
        }

        const existing = this.selectDeliveryJobByIdStatement.get(jobId) as { job_id?: string } | undefined;
        if (existing?.job_id) {
          this.updateDeliveryJobStatement.run(
            deliveryJob.caseId,
            deliveryJob.status,
            deliveryJob.attemptCount,
            deliveryJob.enqueuedAt,
            deliveryJob.availableAt,
            deliveryJob.updatedAt,
            deliveryJob.workerId,
            deliveryJob.claimedAt,
            deliveryJob.completedAt,
            deliveryJob.lastError,
            jobId,
          );
        } else {
          this.insertDeliveryJobStatement.run(
            jobId,
            deliveryJob.caseId,
            deliveryJob.status,
            deliveryJob.attemptCount,
            deliveryJob.enqueuedAt,
            deliveryJob.availableAt,
            deliveryJob.updatedAt,
            deliveryJob.workerId,
            deliveryJob.claimedAt,
            deliveryJob.completedAt,
            deliveryJob.lastError,
          );
        }
      }

      for (const jobId of this.dirtyInferenceJobIds) {
        const inferenceJob = this.inferenceJobs.get(jobId);
        if (!inferenceJob) {
          continue;
        }

        const existing = this.selectInferenceJobByIdStatement.get(jobId) as { job_id?: string } | undefined;
        if (existing?.job_id) {
          this.updateInferenceJobStatement.run(
            inferenceJob.caseId,
            inferenceJob.status,
            inferenceJob.attemptCount,
            inferenceJob.enqueuedAt,
            inferenceJob.availableAt,
            inferenceJob.updatedAt,
            inferenceJob.workerId,
            inferenceJob.claimedAt,
            inferenceJob.completedAt,
            inferenceJob.lastError,
            inferenceJob.leaseId,
            inferenceJob.leaseExpiresAt,
            inferenceJob.failureClass,
            jobId,
          );
        } else {
          this.insertInferenceJobStatement.run(
            jobId,
            inferenceJob.caseId,
            inferenceJob.status,
            inferenceJob.attemptCount,
            inferenceJob.enqueuedAt,
            inferenceJob.availableAt,
            inferenceJob.updatedAt,
            inferenceJob.workerId,
            inferenceJob.claimedAt,
            inferenceJob.completedAt,
            inferenceJob.lastError,
            inferenceJob.leaseId,
            inferenceJob.leaseExpiresAt,
            inferenceJob.failureClass,
          );
        }
      }

      const nextRevision = this.storeRevision + 1;
      this.updateRevisionStatement.run(String(nextRevision));
      this.database.exec("COMMIT");
      this.storeRevision = nextRevision;
      this.deletedCaseIds.clear();
      this.dirtyCaseIds.clear();
      this.dirtyDeliveryJobIds.clear();
      this.dirtyInferenceJobIds.clear();
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new Error("Concurrent case store modification detected");
      }
      throw error;
    }
  }

  async close() {
    if (this.database.isOpen) {
      this.database.close();
    }
  }

  private readStoreRevision() {
    const row = this.selectRevisionStatement.get() as { value?: string | number | bigint } | undefined;
    return row ? Number(row.value ?? 0) : 0;
  }
}