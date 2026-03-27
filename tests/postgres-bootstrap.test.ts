import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPostgresBootstrapStatements,
  getPostgresBootstrapConfig,
} from "../src/postgres-bootstrap";

test("postgres bootstrap config reads explicit env contract", () => {
  const config = getPostgresBootstrapConfig({
    MRI_CASE_STORE_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/mri_second_opinion",
    MRI_CASE_STORE_SCHEMA: "mri_wave1",
  });

  assert.equal(
    config.connectionString,
    "postgresql://postgres:postgres@localhost:5432/mri_second_opinion",
  );
  assert.equal(config.schema, "mri_wave1");
});

test("postgres bootstrap config rejects missing connection string", () => {
  assert.throws(
    () => getPostgresBootstrapConfig({ MRI_CASE_STORE_SCHEMA: "mri_wave1" }),
    /MRI_CASE_STORE_DATABASE_URL or DATABASE_URL is required/,
  );
});

test("postgres bootstrap config rejects invalid schema identifiers", () => {
  assert.throws(
    () =>
      getPostgresBootstrapConfig({
        MRI_CASE_STORE_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/mri_second_opinion",
        MRI_CASE_STORE_SCHEMA: "invalid-schema-name",
      }),
    /Invalid MRI_CASE_STORE_SCHEMA value/,
  );
});

test("bootstrap statements provision revision, case, delivery, and inference tables", () => {
  const sql = buildPostgresBootstrapStatements("mri_wave1").join("\n");

  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS "mri_wave1";/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "mri_wave1"\."store_metadata"/);
  assert.match(sql, /INSERT INTO "mri_wave1"\."store_metadata" \(key, value\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "mri_wave1"\."case_records"/);
  assert.match(sql, /payload_json JSONB NOT NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "mri_wave1"\."delivery_jobs"/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "idx_delivery_jobs_status_available"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "mri_wave1"\."inference_jobs"/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "idx_inference_jobs_status_available"/);
});