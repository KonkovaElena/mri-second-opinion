import { Pool } from "pg";
import type { CaseRecord, DeliveryJobRecord, InferenceJobRecord } from "./case-contracts";
import { cloneCase, getRetryBackoffSeconds, MAX_INFERENCE_ATTEMPTS } from "./case-common";
import {
  buildPostgresBootstrapStatements,
  type PostgresBootstrapConfig,
} from "./postgres-bootstrap";
import {
  parseStoredCaseRecord,
  parseStoredDeliveryJobRecord,
  parseStoredInferenceJobRecord,
} from "./case-sqlite-storage";

interface PostgresQueryable {
  query<T = unknown>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface PostgresPoolLike extends PostgresQueryable {
  connect(): Promise<PostgresPoolClientLike>;
  end(): Promise<void>;
}

export interface PostgresPoolClientLike extends PostgresQueryable {
  release(): void;
}

export type PostgresPoolFactory = () => PostgresPoolLike;

export interface PostgresCaseRepositoryOptions extends PostgresBootstrapConfig {
  poolFactory?: PostgresPoolFactory;
}

interface StoredInferenceJobRow {
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
}

export interface PostgresRenewInferenceLeaseResult {
  status: "updated" | "expired" | "missing";
  job: InferenceJobRecord | null;
}

export interface PostgresFailInferenceJobInput {
  caseId: string;
  leaseId: string;
  failureClass: Exclude<InferenceJobRecord["failureClass"], null>;
  errorMessage: string;
}

export interface PostgresFailInferenceJobResult {
  status: "updated" | "missing";
  job: InferenceJobRecord | null;
  requeued: boolean;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/gu, '""')}"`;
}

function qualifyTable(schema: string, tableName: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
}

function createDefaultPool(connectionString: string): PostgresPoolLike {
  return new Pool({ connectionString });
}

export class PostgresCaseRepository {
  private readonly cases = new Map<string, CaseRecord>();
  private readonly deliveryJobs = new Map<string, DeliveryJobRecord>();
  private readonly inferenceJobs = new Map<string, InferenceJobRecord>();
  private readonly dirtyCaseIds = new Set<string>();
  private readonly deletedCaseIds = new Set<string>();
  private readonly dirtyDeliveryJobIds = new Set<string>();
  private readonly dirtyInferenceJobIds = new Set<string>();
  private readonly pool: PostgresPoolLike;
  private readonly ownsPool: boolean;
  private initialized = false;
  private storeRevision = 0;

  constructor(private readonly options: PostgresCaseRepositoryOptions) {
    if (options.poolFactory) {
      this.pool = options.poolFactory();
      this.ownsPool = false;
    } else {
      this.pool = createDefaultPool(options.connectionString);
      this.ownsPool = true;
    }
  }

  async list() {
    await this.ensureLoaded();
    return Array.from(this.cases.values())
      .map(cloneCase)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async get(caseId: string) {
    await this.ensureLoaded();
    return this.cases.get(caseId);
  }

  async getSnapshot(caseId: string) {
    await this.ensureLoaded();
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
    await this.ensureLoaded();
    return this.cases.size;
  }

  async values() {
    await this.ensureLoaded();
    return Array.from(this.cases.values());
  }

  async findByStudyUid(studyUid: string) {
    await this.ensureLoaded();
    return Array.from(this.cases.values()).find((caseRecord) => caseRecord.studyUid === studyUid) ?? null;
  }

  async listDeliveryJobs() {
    await this.ensureLoaded();
    return Array.from(this.deliveryJobs.values())
      .map(cloneCase)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.enqueuedAt.localeCompare(left.enqueuedAt),
      );
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
    await this.ensureLoaded();
    return Array.from(this.inferenceJobs.values())
      .map(cloneCase)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.enqueuedAt.localeCompare(left.enqueuedAt),
      );
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
    await this.ensureBootstrapped();
    this.cases.clear();
    this.deliveryJobs.clear();
    this.inferenceJobs.clear();
    this.dirtyCaseIds.clear();
    this.deletedCaseIds.clear();
    this.dirtyDeliveryJobIds.clear();
    this.dirtyInferenceJobIds.clear();

    const revisionTable = qualifyTable(this.options.schema, "store_metadata");
    const caseTable = qualifyTable(this.options.schema, "case_records");
    const deliveryTable = qualifyTable(this.options.schema, "delivery_jobs");
    const inferenceTable = qualifyTable(this.options.schema, "inference_jobs");

    const revisionRow = await this.pool.query<{ value: string | number }>(
      `SELECT value FROM ${revisionTable} WHERE key = 'revision'`,
    );
    this.storeRevision = Number(revisionRow.rows[0]?.value ?? 0);

    const caseRows = await this.pool.query<{ case_id: string; payload_json: string }>(
      `SELECT case_id, payload_json::text AS payload_json
       FROM ${caseTable}
       ORDER BY updated_at DESC`,
    );

    for (const row of caseRows.rows) {
      const { caseRecord } = parseStoredCaseRecord(row.payload_json);
      this.cases.set(row.case_id, caseRecord);
    }

    const deliveryRows = await this.pool.query<{
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
    }>(
      `SELECT job_id, case_id, status, attempt_count, enqueued_at, available_at, updated_at, worker_id, claimed_at, completed_at, last_error
       FROM ${deliveryTable}
       ORDER BY updated_at DESC, enqueued_at DESC`,
    );

    for (const row of deliveryRows.rows) {
      const { deliveryJob } = parseStoredDeliveryJobRecord(row);
      this.deliveryJobs.set(row.job_id, deliveryJob);
    }

    const inferenceRows = await this.pool.query<{
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
    }>(
      `SELECT job_id, case_id, status, attempt_count, enqueued_at, available_at, updated_at, worker_id, claimed_at, completed_at, last_error, lease_id, lease_expires_at
       FROM ${inferenceTable}
       ORDER BY updated_at DESC, enqueued_at DESC`,
    );

    for (const row of inferenceRows.rows) {
      const { inferenceJob } = parseStoredInferenceJobRecord(row);
      this.inferenceJobs.set(row.job_id, inferenceJob);
    }

    this.initialized = true;
  }

  async save() {
    await this.ensureLoaded();

    const revisionTable = qualifyTable(this.options.schema, "store_metadata");
    const caseTable = qualifyTable(this.options.schema, "case_records");
    const deliveryTable = qualifyTable(this.options.schema, "delivery_jobs");
    const inferenceTable = qualifyTable(this.options.schema, "inference_jobs");
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const revisionRow = await client.query<{ value: string | number }>(
        `SELECT value FROM ${revisionTable} WHERE key = 'revision' FOR UPDATE`,
      );
      const currentRevision = Number(revisionRow.rows[0]?.value ?? 0);

      if (currentRevision !== this.storeRevision) {
        throw new Error("Concurrent case store modification detected");
      }

      for (const caseId of this.deletedCaseIds) {
        await client.query(`DELETE FROM ${caseTable} WHERE case_id = $1`, [caseId]);
      }

      for (const caseId of this.dirtyCaseIds) {
        const caseRecord = this.cases.get(caseId);
        if (!caseRecord) {
          continue;
        }

        await client.query(
          `INSERT INTO ${caseTable} (
             case_id,
             study_uid,
             status,
             created_at,
             updated_at,
             payload_json
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (case_id) DO UPDATE SET
             study_uid = EXCLUDED.study_uid,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at,
             payload_json = EXCLUDED.payload_json`,
          [
            caseId,
            caseRecord.studyUid,
            caseRecord.status,
            caseRecord.createdAt,
            caseRecord.updatedAt,
            JSON.stringify(caseRecord),
          ],
        );
      }

      for (const jobId of this.dirtyDeliveryJobIds) {
        const deliveryJob = this.deliveryJobs.get(jobId);
        if (!deliveryJob) {
          continue;
        }

        await client.query(
          `INSERT INTO ${deliveryTable} (
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
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (job_id) DO UPDATE SET
             case_id = EXCLUDED.case_id,
             status = EXCLUDED.status,
             attempt_count = EXCLUDED.attempt_count,
             enqueued_at = EXCLUDED.enqueued_at,
             available_at = EXCLUDED.available_at,
             updated_at = EXCLUDED.updated_at,
             worker_id = EXCLUDED.worker_id,
             claimed_at = EXCLUDED.claimed_at,
             completed_at = EXCLUDED.completed_at,
             last_error = EXCLUDED.last_error`,
          [
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
          ],
        );
      }

      for (const jobId of this.dirtyInferenceJobIds) {
        const inferenceJob = this.inferenceJobs.get(jobId);
        if (!inferenceJob) {
          continue;
        }

        await client.query(
          `INSERT INTO ${inferenceTable} (
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
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (job_id) DO UPDATE SET
             case_id = EXCLUDED.case_id,
             status = EXCLUDED.status,
             attempt_count = EXCLUDED.attempt_count,
             enqueued_at = EXCLUDED.enqueued_at,
             available_at = EXCLUDED.available_at,
             updated_at = EXCLUDED.updated_at,
             worker_id = EXCLUDED.worker_id,
             claimed_at = EXCLUDED.claimed_at,
             completed_at = EXCLUDED.completed_at,
             last_error = EXCLUDED.last_error,
             lease_id = EXCLUDED.lease_id,
             lease_expires_at = EXCLUDED.lease_expires_at,
             failure_class = EXCLUDED.failure_class`,
          [
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
          ],
        );
      }

      const nextRevision = this.storeRevision + 1;
      await client.query(
        `UPDATE ${revisionTable} SET value = $1 WHERE key = 'revision'`,
        [String(nextRevision)],
      );

      await client.query("COMMIT");

      this.storeRevision = nextRevision;
      this.deletedCaseIds.clear();
      this.dirtyCaseIds.clear();
      this.dirtyDeliveryJobIds.clear();
      this.dirtyInferenceJobIds.clear();
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failures and surface the original error.
      }

      if (error instanceof Error && /duplicate key value|unique constraint/iu.test(error.message)) {
        throw new Error("Concurrent case store modification detected");
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async renewInferenceLease(
    leaseId: string,
    extensionMs: number,
  ): Promise<PostgresRenewInferenceLeaseResult> {
    await this.ensureLoaded();

    const revisionTable = qualifyTable(this.options.schema, "store_metadata");
    const inferenceTable = qualifyTable(this.options.schema, "inference_jobs");
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const revisionRow = await client.query<{ value: string | number }>(
        `SELECT value FROM ${revisionTable} WHERE key = 'revision' FOR UPDATE`,
      );
      const currentRevision = Number(revisionRow.rows[0]?.value ?? 0);

      const rowResult = await client.query<StoredInferenceJobRow>(
        `SELECT job_id, case_id, status, attempt_count, enqueued_at, available_at, updated_at, worker_id, claimed_at, completed_at, last_error, lease_id, lease_expires_at, failure_class
         FROM ${inferenceTable}
         WHERE lease_id = $1 AND status = 'claimed'
         LIMIT 1
         FOR UPDATE`,
        [leaseId],
      );
      const row = rowResult.rows[0];

      if (!row) {
        await client.query("ROLLBACK");
        this.storeRevision = currentRevision;
        return { status: "missing", job: null };
      }

      const { inferenceJob } = parseStoredInferenceJobRecord(row);

      if (inferenceJob.leaseExpiresAt && Date.parse(inferenceJob.leaseExpiresAt) < Date.now()) {
        await client.query("ROLLBACK");
        this.storeRevision = currentRevision;
        this.applyPersistedInferenceJob(inferenceJob);
        return { status: "expired", job: cloneCase(inferenceJob) };
      }

      const updatedAt = new Date().toISOString();
      const leaseExpiresAt = new Date(Date.now() + extensionMs).toISOString();
      const updatedJob: InferenceJobRecord = {
        ...inferenceJob,
        updatedAt,
        leaseExpiresAt,
      };

      await client.query(
        `UPDATE ${inferenceTable}
         SET updated_at = $1,
             lease_expires_at = $2
         WHERE job_id = $3`,
        [updatedJob.updatedAt, updatedJob.leaseExpiresAt, updatedJob.jobId],
      );

      const nextRevision = currentRevision + 1;
      await client.query(
        `UPDATE ${revisionTable} SET value = $1 WHERE key = 'revision'`,
        [String(nextRevision)],
      );

      await client.query("COMMIT");

      this.storeRevision = nextRevision;
      this.applyPersistedInferenceJob(updatedJob);
      return { status: "updated", job: cloneCase(updatedJob) };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failures and surface the original error.
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async failClaimedInferenceJob(
    input: PostgresFailInferenceJobInput,
  ): Promise<PostgresFailInferenceJobResult> {
    await this.ensureLoaded();

    const revisionTable = qualifyTable(this.options.schema, "store_metadata");
    const inferenceTable = qualifyTable(this.options.schema, "inference_jobs");
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const revisionRow = await client.query<{ value: string | number }>(
        `SELECT value FROM ${revisionTable} WHERE key = 'revision' FOR UPDATE`,
      );
      const currentRevision = Number(revisionRow.rows[0]?.value ?? 0);

      const rowResult = await client.query<StoredInferenceJobRow>(
        `SELECT job_id, case_id, status, attempt_count, enqueued_at, available_at, updated_at, worker_id, claimed_at, completed_at, last_error, lease_id, lease_expires_at, failure_class
         FROM ${inferenceTable}
         WHERE case_id = $1 AND lease_id = $2 AND status = 'claimed'
         LIMIT 1
         FOR UPDATE`,
        [input.caseId, input.leaseId],
      );
      const row = rowResult.rows[0];

      if (!row) {
        await client.query("ROLLBACK");
        this.storeRevision = currentRevision;
        return { status: "missing", job: null, requeued: false };
      }

      const { inferenceJob } = parseStoredInferenceJobRecord(row);
      const updatedAt = new Date().toISOString();
      const shouldRequeue =
        input.failureClass === "transient" && inferenceJob.attemptCount < MAX_INFERENCE_ATTEMPTS;
      const updatedJob: InferenceJobRecord =
        shouldRequeue
          ? {
              ...inferenceJob,
              status: "queued",
              availableAt: new Date(
                Date.now() + getRetryBackoffSeconds("standard", inferenceJob.attemptCount) * 1000,
              ).toISOString(),
              updatedAt,
              workerId: null,
              claimedAt: null,
              completedAt: null,
              lastError: input.errorMessage,
              failureClass: "transient",
              leaseId: null,
              leaseExpiresAt: null,
            }
          : {
              ...inferenceJob,
              status: "failed",
              updatedAt,
              completedAt: updatedAt,
              lastError: input.errorMessage,
              failureClass: "terminal",
              leaseId: null,
              leaseExpiresAt: null,
            };

      await client.query(
        `UPDATE ${inferenceTable}
         SET status = $1,
             attempt_count = $2,
             available_at = $3,
             updated_at = $4,
             worker_id = $5,
             claimed_at = $6,
             completed_at = $7,
             last_error = $8,
             lease_id = $9,
             lease_expires_at = $10,
             failure_class = $11
         WHERE job_id = $12`,
        [
          updatedJob.status,
          updatedJob.attemptCount,
          updatedJob.availableAt,
          updatedJob.updatedAt,
          updatedJob.workerId,
          updatedJob.claimedAt,
          updatedJob.completedAt,
          updatedJob.lastError,
          updatedJob.leaseId,
          updatedJob.leaseExpiresAt,
          updatedJob.failureClass,
          updatedJob.jobId,
        ],
      );

      const nextRevision = currentRevision + 1;
      await client.query(
        `UPDATE ${revisionTable} SET value = $1 WHERE key = 'revision'`,
        [String(nextRevision)],
      );

      await client.query("COMMIT");

      this.storeRevision = nextRevision;
      this.applyPersistedInferenceJob(updatedJob);
      return {
        status: "updated",
        job: cloneCase(updatedJob),
        requeued: shouldRequeue,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failures and surface the original error.
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }

  private async ensureLoaded() {
    if (!this.initialized) {
      await this.reload();
    }
  }

  private async ensureBootstrapped() {
    const requiredTables = ["store_metadata", "case_records", "delivery_jobs", "inference_jobs"];

    try {
      for (const tableName of requiredTables) {
        await this.pool.query(`SELECT 1 FROM ${qualifyTable(this.options.schema, tableName)} LIMIT 1`);
      }

      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/does not exist|relation .* does not exist|schema not found/iu.test(error.message)
      ) {
        throw error;
      }
    }

    const statements = buildPostgresBootstrapStatements(this.options.schema);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failures and surface the original bootstrap error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private applyPersistedInferenceJob(inferenceJob: InferenceJobRecord) {
    this.inferenceJobs.set(inferenceJob.jobId, cloneCase(inferenceJob));
    this.dirtyInferenceJobIds.delete(inferenceJob.jobId);
  }
}