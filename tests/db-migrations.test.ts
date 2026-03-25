import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyPendingMigrations,
  discoverSqlMigrations,
  planPendingMigrations,
} from "../src/db-migrations";

function createMigrationDir() {
  return mkdtempSync(join(tmpdir(), "mri-db-migrations-"));
}

test("discoverSqlMigrations returns ordered .sql migrations only", () => {
  const migrationDir = createMigrationDir();

  try {
    writeFileSync(join(migrationDir, "002_add_case_records.sql"), "SELECT 2;\n", "utf8");
    writeFileSync(join(migrationDir, "001_create_schema_migrations.sql"), "SELECT 1;\n", "utf8");
    writeFileSync(join(migrationDir, "README.md"), "ignore", "utf8");

    const migrations = discoverSqlMigrations(migrationDir);

    assert.deepEqual(
      migrations.map((migration) => migration.id),
      ["001_create_schema_migrations", "002_add_case_records"],
    );
    assert.equal(migrations[0].sql.trim(), "SELECT 1;");
    assert.equal(migrations[1].sql.trim(), "SELECT 2;");
  } finally {
    rmSync(migrationDir, { recursive: true, force: true });
  }
});

test("planPendingMigrations excludes already applied ids and preserves order", () => {
  const planned = planPendingMigrations(
    [
      { id: "001_create_schema_migrations", fileName: "001_create_schema_migrations.sql", sql: "SELECT 1;" },
      { id: "002_add_case_records", fileName: "002_add_case_records.sql", sql: "SELECT 2;" },
      { id: "003_add_case_events", fileName: "003_add_case_events.sql", sql: "SELECT 3;" },
    ],
    new Set(["001_create_schema_migrations", "003_add_case_events"]),
  );

  assert.deepEqual(planned.map((migration) => migration.id), ["002_add_case_records"]);
});

function createPoolStub(options: { failOnSql?: string } = {}) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let ended = false;

  const pool = {
    async query(sql: string, params?: unknown[]) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalizedSql, params });

      if (normalizedSql.startsWith("SELECT id FROM schema_migrations")) {
        return { rows: [{ id: "001_bootstrap" }] };
      }

      if (options.failOnSql && normalizedSql.includes(options.failOnSql)) {
        throw new Error("simulated migration failure");
      }

      return { rows: [] };
    },
    async end() {
      ended = true;
    },
  };

  return { pool, calls, wasEnded: () => ended };
}

test("applyPendingMigrations applies pending files and leaves injected pool lifecycle to caller", async () => {
  const migrationDir = createMigrationDir();

  try {
    writeFileSync(join(migrationDir, "001_bootstrap.sql"), "SELECT 1;\n", "utf8");
    writeFileSync(join(migrationDir, "002_create_case_records.sql"), "CREATE TABLE case_records(id text);\n", "utf8");
    writeFileSync(join(migrationDir, "003_add_status_index.sql"), "CREATE INDEX idx_status ON case_records(id);\n", "utf8");

    const stub = createPoolStub();
    const result = await applyPendingMigrations({
      migrationDirectory: migrationDir,
      pool: stub.pool,
    });

    assert.deepEqual(result.appliedIds, ["002_create_case_records", "003_add_status_index"]);
    assert.deepEqual(result.skippedIds, ["001_bootstrap"]);
    assert.equal(stub.calls.filter((call) => call.sql === "BEGIN").length, 2);
    assert.equal(stub.calls.filter((call) => call.sql === "COMMIT").length, 2);
    assert.equal(
      stub.calls.filter((call) => call.sql.startsWith("INSERT INTO schema_migrations")).length,
      2,
    );
    assert.equal(stub.wasEnded(), false);
  } finally {
    rmSync(migrationDir, { recursive: true, force: true });
  }
});

test("applyPendingMigrations rolls back failed migrations", async () => {
  const migrationDir = createMigrationDir();

  try {
    writeFileSync(join(migrationDir, "001_bootstrap.sql"), "SELECT 1;\n", "utf8");
    writeFileSync(join(migrationDir, "002_broken_step.sql"), "BROKEN MIGRATION SQL;\n", "utf8");

    const stub = createPoolStub({ failOnSql: "BROKEN MIGRATION SQL" });

    await assert.rejects(
      () =>
        applyPendingMigrations({
          migrationDirectory: migrationDir,
          pool: stub.pool,
        }),
      /simulated migration failure/,
    );

    assert.equal(stub.calls.filter((call) => call.sql === "BEGIN").length, 1);
    assert.equal(stub.calls.filter((call) => call.sql === "ROLLBACK").length, 1);
    assert.equal(stub.calls.filter((call) => call.sql === "COMMIT").length, 0);
  } finally {
    rmSync(migrationDir, { recursive: true, force: true });
  }
});