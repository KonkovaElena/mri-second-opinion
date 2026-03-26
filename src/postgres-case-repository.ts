import pg from "pg";
import type { CaseRecord } from "./cases";
import type { CaseRepository } from "./case-repository";
import {
  buildArtifactReferenceProjection,
  buildCaseSummaryProjection,
  buildWorkflowJobProjection,
  normalizeArtifactReferenceProjection,
  normalizeCaseSummaryProjection,
  normalizeWorkflowJobProjection,
  type ArtifactReferenceProjection,
  type CaseSummaryProjection,
  type WorkflowJobProjection,
} from "./case-projections";

const { Pool } = pg;

type QueryablePool = Pick<pg.Pool, "query">;

function cloneCase<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeCaseRecord(record: CaseRecord): CaseRecord {
  return {
    ...record,
    lastInferenceFingerprint: record.lastInferenceFingerprint ?? null,
    workflowQueue: Array.isArray(record.workflowQueue)
      ? record.workflowQueue.map((entry) => ({
          ...entry,
          resolvedAt: entry.resolvedAt ?? null,
        }))
      : [],
    workerArtifacts: record.workerArtifacts ?? undefined,
  };
}

export class PostgresCaseRepository implements CaseRepository {
  private readonly pool: QueryablePool;

  constructor(connectionString: string, pool?: QueryablePool) {
    this.pool = pool ?? new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      statement_timeout: 30_000,
      ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    });
  }

  async list() {
    const result = await this.pool.query<{ payload: CaseRecord }>(
      "SELECT payload FROM case_records ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => cloneCase(normalizeCaseRecord(row.payload)));
  }

  async listSummaries() {
    const result = await this.pool.query<{ payload: CaseSummaryProjection }>(
      "SELECT payload FROM case_summary_projection ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => cloneCase(normalizeCaseSummaryProjection(row.payload)));
  }

  async listWorkflowJobs() {
    const result = await this.pool.query<{ payload: WorkflowJobProjection }>(
      "SELECT payload FROM workflow_job_projection ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => cloneCase(normalizeWorkflowJobProjection(row.payload)));
  }

  async listArtifactReferences() {
    const result = await this.pool.query<{ payload: ArtifactReferenceProjection }>(
      "SELECT payload FROM artifact_reference_projection ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => cloneCase(normalizeArtifactReferenceProjection(row.payload)));
  }

  async get(caseId: string) {
    const result = await this.pool.query<{ payload: CaseRecord }>(
      "SELECT payload FROM case_records WHERE case_id = $1",
      [caseId],
    );
    const row = result.rows[0];
    return row ? cloneCase(normalizeCaseRecord(row.payload)) : undefined;
  }

  async upsert(
    caseRecord: CaseRecord,
    options?: {
      expectedUpdatedAt?: string | null;
    },
  ) {
    const normalized = normalizeCaseRecord(caseRecord);
    const summaryProjection = buildCaseSummaryProjection(normalized);
    const workflowJobProjection = buildWorkflowJobProjection(normalized);
    const artifactReferenceProjection = buildArtifactReferenceProjection(normalized);
    const params = [
      normalized.caseId,
      normalized.studyUid,
      normalized.status,
      normalized.createdAt,
      normalized.updatedAt,
      JSON.stringify(normalized),
    ];

    await this.pool.query("BEGIN");

    try {
      if (typeof options?.expectedUpdatedAt === "undefined") {
        await this.pool.query(
          `
            INSERT INTO case_records (
              case_id,
              study_uid,
              status,
              created_at,
              updated_at,
              payload
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            ON CONFLICT (case_id) DO UPDATE SET
              study_uid = EXCLUDED.study_uid,
              status = EXCLUDED.status,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              payload = EXCLUDED.payload
          `,
          params,
        );
      } else {
        const result = await this.pool.query(
          `
            INSERT INTO case_records (
              case_id,
              study_uid,
              status,
              created_at,
              updated_at,
              payload
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            ON CONFLICT (case_id) DO UPDATE SET
              study_uid = EXCLUDED.study_uid,
              status = EXCLUDED.status,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              payload = EXCLUDED.payload
            WHERE case_records.updated_at = $7
            RETURNING case_id
          `,
          [...params, options.expectedUpdatedAt],
        );

        if (result.rows.length === 0) {
          throw new Error("Concurrent case store modification detected");
        }
      }

      await this.pool.query(
        `
          INSERT INTO case_summary_projection (
            case_id,
            study_uid,
            status,
            updated_at,
            payload
          )
          VALUES ($1, $2, $3, $4, $5::jsonb)
          ON CONFLICT (case_id) DO UPDATE SET
            study_uid = EXCLUDED.study_uid,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at,
            payload = EXCLUDED.payload
        `,
        [
          normalized.caseId,
          normalized.studyUid,
          normalized.status,
          normalized.updatedAt,
          JSON.stringify(summaryProjection),
        ],
      );
      await this.pool.query(
        `
          INSERT INTO workflow_job_projection (
            case_id,
            updated_at,
            payload
          )
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (case_id) DO UPDATE SET
            updated_at = EXCLUDED.updated_at,
            payload = EXCLUDED.payload
        `,
        [normalized.caseId, normalized.updatedAt, JSON.stringify(workflowJobProjection)],
      );
      await this.pool.query(
        `
          INSERT INTO artifact_reference_projection (
            case_id,
            updated_at,
            payload
          )
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (case_id) DO UPDATE SET
            updated_at = EXCLUDED.updated_at,
            payload = EXCLUDED.payload
        `,
        [normalized.caseId, normalized.updatedAt, JSON.stringify(artifactReferenceProjection)],
      );
      await this.pool.query("COMMIT");
    } catch (error) {
      await this.pool.query("ROLLBACK");
      throw error;
    }
  }

  async delete(caseId: string) {
    await this.pool.query("BEGIN");
    try {
      await this.pool.query("DELETE FROM case_summary_projection WHERE case_id = $1", [caseId]);
      await this.pool.query("DELETE FROM workflow_job_projection WHERE case_id = $1", [caseId]);
      await this.pool.query("DELETE FROM artifact_reference_projection WHERE case_id = $1", [caseId]);
      await this.pool.query("DELETE FROM case_records WHERE case_id = $1", [caseId]);
      await this.pool.query("COMMIT");
    } catch (error) {
      await this.pool.query("ROLLBACK");
      throw error;
    }
  }

  async findByStudyUid(studyUid: string) {
    const summaryResult = await this.pool.query<{ case_id: string }>(
      "SELECT case_id FROM case_summary_projection WHERE study_uid = $1 LIMIT 1",
      [studyUid],
    );

    if (summaryResult.rows.length === 0) {
      return null;
    }

    const result = await this.pool.query<{ payload: CaseRecord }>(
      "SELECT payload FROM case_records WHERE case_id = $1",
      [summaryResult.rows[0].case_id],
    );
    const row = result.rows[0];
    return row ? cloneCase(normalizeCaseRecord(row.payload)) : null;
  }
}