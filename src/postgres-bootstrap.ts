import { Pool } from "pg";

export interface PostgresBootstrapConfig {
  connectionString: string;
  schema: string;
}

export interface PostgresBootstrapResult {
  schema: string;
  tables: string[];
  statementsApplied: number;
}

const DEFAULT_SCHEMA = "public";
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function quoteIdentifier(identifier: string) {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid PostgreSQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function qualifyTable(schema: string, tableName: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
}

export function getPostgresBootstrapConfig(
  env: NodeJS.ProcessEnv = process.env,
): PostgresBootstrapConfig {
  const connectionString =
    env.MRI_CASE_STORE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || "";

  if (!connectionString) {
    throw new Error(
      "MRI_CASE_STORE_DATABASE_URL or DATABASE_URL is required for PostgreSQL bootstrap",
    );
  }

  const schema = env.MRI_CASE_STORE_SCHEMA?.trim() || DEFAULT_SCHEMA;

  if (!IDENTIFIER_PATTERN.test(schema)) {
    throw new Error(`Invalid MRI_CASE_STORE_SCHEMA value: ${schema}`);
  }

  return {
    connectionString,
    schema,
  };
}

export function buildPostgresBootstrapStatements(schema: string): string[] {
  const qualifiedStoreMetadata = qualifyTable(schema, "store_metadata");
  const qualifiedCaseRecords = qualifyTable(schema, "case_records");
  const qualifiedDeliveryJobs = qualifyTable(schema, "delivery_jobs");
  const qualifiedInferenceJobs = qualifyTable(schema, "inference_jobs");
  const caseUpdatedIndex = quoteIdentifier("idx_case_records_updated_at");
  const caseStudyUidIndex = quoteIdentifier("idx_case_records_study_uid");
  const deliveryStatusIndex = quoteIdentifier("idx_delivery_jobs_status_available");
  const deliveryCaseIndex = quoteIdentifier("idx_delivery_jobs_case_id");
  const inferenceStatusIndex = quoteIdentifier("idx_inference_jobs_status_available");
  const inferenceCaseIndex = quoteIdentifier("idx_inference_jobs_case_id");

  return [
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)};`,
    `CREATE TABLE IF NOT EXISTS ${qualifiedStoreMetadata} (
      key TEXT PRIMARY KEY,
      value BIGINT NOT NULL
    );`,
    `INSERT INTO ${qualifiedStoreMetadata} (key, value)
     VALUES ('revision', 0)
     ON CONFLICT (key) DO NOTHING;`,
    `CREATE TABLE IF NOT EXISTS ${qualifiedCaseRecords} (
      case_id TEXT PRIMARY KEY,
      study_uid TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json JSONB NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS ${caseUpdatedIndex}
     ON ${qualifiedCaseRecords} (updated_at DESC);`,
    `CREATE INDEX IF NOT EXISTS ${caseStudyUidIndex}
     ON ${qualifiedCaseRecords} (study_uid);`,
    
    `CREATE TABLE IF NOT EXISTS ${qualifiedDeliveryJobs} (
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
    );`,
    `CREATE INDEX IF NOT EXISTS ${deliveryStatusIndex}
     ON ${qualifiedDeliveryJobs} (status, available_at);`,
    `CREATE INDEX IF NOT EXISTS ${deliveryCaseIndex}
     ON ${qualifiedDeliveryJobs} (case_id);`,
    `CREATE TABLE IF NOT EXISTS ${qualifiedInferenceJobs} (
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
    );`,
    `ALTER TABLE ${qualifiedInferenceJobs}
     ADD COLUMN IF NOT EXISTS lease_id TEXT;`,
    `ALTER TABLE ${qualifiedInferenceJobs}
     ADD COLUMN IF NOT EXISTS lease_expires_at TEXT;`,
    `ALTER TABLE ${qualifiedInferenceJobs}
     ADD COLUMN IF NOT EXISTS failure_class TEXT;`,
    `CREATE INDEX IF NOT EXISTS ${inferenceStatusIndex}
     ON ${qualifiedInferenceJobs} (status, available_at);`,
    `CREATE INDEX IF NOT EXISTS ${inferenceCaseIndex}
     ON ${qualifiedInferenceJobs} (case_id);`,
  ];
}

export async function verifyPostgresBootstrap(
  config: PostgresBootstrapConfig,
): Promise<PostgresBootstrapResult> {
  const statements = buildPostgresBootstrapStatements(config.schema);
  const pool = new Pool({
    connectionString: config.connectionString,
  });

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const statement of statements) {
        await client.query(statement);
      }

      const tableResult = await client.query<{
        tablename: string;
      }>(
        `SELECT tablename
         FROM pg_tables
         WHERE schemaname = $1
           AND tablename = ANY($2::text[])
         ORDER BY tablename ASC`,
        [config.schema, ["case_records", "delivery_jobs", "inference_jobs", "store_metadata"]],
      );

      await client.query("COMMIT");

      return {
        schema: config.schema,
        tables: tableResult.rows.map((row) => row.tablename),
        statementsApplied: statements.length,
      };
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
  } finally {
    await pool.end();
  }
}