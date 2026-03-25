import pg from "pg";
import type { CaseRecord } from "./cases";
import type { CaseRepository } from "./case-repository";

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
    this.pool = pool ?? new Pool({ connectionString });
  }

  async list() {
    const result = await this.pool.query<{ payload: CaseRecord }>(
      "SELECT payload FROM case_records ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => cloneCase(normalizeCaseRecord(row.payload)));
  }

  async get(caseId: string) {
    const result = await this.pool.query<{ payload: CaseRecord }>(
      "SELECT payload FROM case_records WHERE case_id = $1",
      [caseId],
    );
    const row = result.rows[0];
    return row ? cloneCase(normalizeCaseRecord(row.payload)) : undefined;
  }

  async upsert(caseRecord: CaseRecord) {
    const normalized = normalizeCaseRecord(caseRecord);
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
      [
        normalized.caseId,
        normalized.studyUid,
        normalized.status,
        normalized.createdAt,
        normalized.updatedAt,
        JSON.stringify(normalized),
      ],
    );
  }

  async delete(caseId: string) {
    await this.pool.query("DELETE FROM case_records WHERE case_id = $1", [caseId]);
  }

  async findByStudyUid(studyUid: string) {
    const result = await this.pool.query<{ payload: CaseRecord }>(
      "SELECT payload FROM case_records WHERE study_uid = $1 LIMIT 1",
      [studyUid],
    );
    const row = result.rows[0];
    return row ? cloneCase(normalizeCaseRecord(row.payload)) : null;
  }
}