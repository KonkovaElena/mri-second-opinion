import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;

type MigrationQueryable = Pick<pg.Pool, "query">;

type MigrationPool = MigrationQueryable & {
  end?: () => Promise<void>;
};

export interface SqlMigration {
  id: string;
  fileName: string;
  sql: string;
}

export interface ApplyMigrationResult {
  appliedIds: string[];
  skippedIds: string[];
}

export function getDefaultMigrationDirectory() {
  return resolve(__dirname, "..", "sql", "migrations");
}

export function discoverSqlMigrations(migrationDirectory: string): SqlMigration[] {
  const migrations = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({
      id: entry.name.slice(0, -4),
      fileName: entry.name,
      sql: readFileSync(join(migrationDirectory, entry.name), "utf8"),
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));

  const seenIds = new Set<string>();
  for (const migration of migrations) {
    if (seenIds.has(migration.id)) {
      throw new Error(`Duplicate migration id detected: ${migration.id}`);
    }
    seenIds.add(migration.id);
  }

  return migrations;
}

export function planPendingMigrations(migrations: SqlMigration[], appliedIds: ReadonlySet<string>) {
  return migrations.filter((migration) => !appliedIds.has(migration.id));
}

async function ensureMigrationTable(pool: MigrationQueryable) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readAppliedMigrationIds(pool: MigrationQueryable) {
  const result = await pool.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id ASC");
  return new Set(result.rows.map((row) => row.id));
}

export async function applyPendingMigrations(
  options: {
    connectionString?: string;
    migrationDirectory?: string;
    pool?: MigrationPool;
  } = {},
): Promise<ApplyMigrationResult> {
  const migrationDirectory = options.migrationDirectory ?? getDefaultMigrationDirectory();
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;

  if (!options.pool && !connectionString) {
    throw new Error("DATABASE_URL is required for db:migrate");
  }

  const migrations = discoverSqlMigrations(migrationDirectory);
  const pool = options.pool ?? new Pool({ connectionString: connectionString! });
  const shouldClosePool = !options.pool;

  try {
    await ensureMigrationTable(pool);
    const appliedIds = await readAppliedMigrationIds(pool);
    const pending = planPendingMigrations(migrations, appliedIds);

    for (const migration of pending) {
      await pool.query("BEGIN");
      try {
        await pool.query(migration.sql);
        await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    }

    return {
      appliedIds: pending.map((migration) => migration.id),
      skippedIds: migrations.filter((migration) => appliedIds.has(migration.id)).map((migration) => migration.id),
    };
  } finally {
    if (shouldClosePool && pool.end) {
      await pool.end();
    }
  }
}