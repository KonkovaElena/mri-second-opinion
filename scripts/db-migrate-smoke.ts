import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { applyPendingMigrations } from "../src/db-migrations";

const execFileAsync = promisify(execFile);
const { Pool } = pg;

const IMAGE = process.env.POSTGRES_SMOKE_IMAGE ?? "postgres:17-alpine";
const HOST_PORT = process.env.POSTGRES_SMOKE_PORT ?? "55432";
const DB_NAME = process.env.POSTGRES_SMOKE_DB ?? "mri_smoke";
const DB_USER = process.env.POSTGRES_SMOKE_USER ?? "postgres";
const DB_PASSWORD = process.env.POSTGRES_SMOKE_PASSWORD ?? "postgres";
const containerName = `mri-pg-smoke-${randomUUID().slice(0, 8)}`;

const connectionString = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${DB_NAME}`;

async function runDocker(args: string[]) {
  return execFileAsync("docker", args, { windowsHide: true });
}

async function waitForDatabase(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      await pool.end();
      return;
    } catch {
      await pool.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Postgres smoke database did not become ready within ${timeoutMs}ms`);
}

async function verifySchema() {
  const pool = new Pool({ connectionString });
  try {
    const tableCheck = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'case_records'
      ) AS exists
    `);

    const migrationCheck = await pool.query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id ASC",
    );

    if (!tableCheck.rows[0]?.exists) {
      throw new Error("case_records table was not created by db:migrate");
    }

    return migrationCheck.rows.map((row) => row.id);
  } finally {
    await pool.end();
  }
}

async function cleanupContainer() {
  await runDocker(["rm", "-f", containerName]).catch(() => undefined);
}

async function main() {
  process.stdout.write(`[db:migrate:smoke] starting ${IMAGE} as ${containerName} on localhost:${HOST_PORT}\n`);

  try {
    await runDocker([
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      `POSTGRES_DB=${DB_NAME}`,
      "-e",
      `POSTGRES_USER=${DB_USER}`,
      "-e",
      `POSTGRES_PASSWORD=${DB_PASSWORD}`,
      "-p",
      `${HOST_PORT}:5432`,
      IMAGE,
    ]);

    await waitForDatabase(30000);
    const result = await applyPendingMigrations({ connectionString });
    const appliedIds = await verifySchema();

    process.stdout.write(`[db:migrate:smoke] applied ${result.appliedIds.length} migration(s)\n`);
    process.stdout.write(`[db:migrate:smoke] schema_migrations ids: ${appliedIds.join(", ")}\n`);
    process.stdout.write("[db:migrate:smoke] case_records table verified\n");
  } finally {
    await cleanupContainer();
  }
}

main().catch((error) => {
  process.stderr.write(
    `[db:migrate:smoke] failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});