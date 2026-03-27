import type { CaseStoreMode } from "./case-repository";
import { resolve } from "node:path";

export interface AppConfig {
  nodeEnv: string;
  port: number;
  caseStoreFile: string;
  caseStoreMode: CaseStoreMode;
  caseStoreDatabaseUrl?: string;
  caseStoreSchema?: string;
  databaseUrl?: string;
  internalApiToken?: string;
  hmacSecret?: string;
  clockSkewToleranceMs: number;
  replayStoreTtlMs: number;
  replayStoreMaxEntries: number;
  persistenceMode: "snapshot" | "postgres";
  reviewerIdentitySource: "request-body";
}

const DEFAULT_PORT = 4010;

export function getConfig(): AppConfig {
  const rawPort = process.env.PORT;
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  const rawCaseStoreMode = process.env.MRI_CASE_STORE_MODE ?? "sqlite";
  if (rawCaseStoreMode !== "sqlite" && rawCaseStoreMode !== "snapshot" && rawCaseStoreMode !== "postgres") {
    throw new Error(`Invalid MRI_CASE_STORE_MODE value: ${rawCaseStoreMode}`);
  }

  const caseStoreMode = rawCaseStoreMode as CaseStoreMode;
  const defaultCaseStoreFile =
    caseStoreMode === "sqlite" || caseStoreMode === "postgres"
      ? resolve(__dirname, "..", ".mri-data", "cases.sqlite")
      : resolve(__dirname, "..", ".mri-data", "cases.json");
  const caseStoreFile = process.env.MRI_CASE_STORE_FILE ?? defaultCaseStoreFile;
  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const caseStoreDatabaseUrl = process.env.MRI_CASE_STORE_DATABASE_URL?.trim() || databaseUrl;
  const caseStoreSchema = process.env.MRI_CASE_STORE_SCHEMA?.trim() || "public";
  const internalApiToken = process.env.MRI_INTERNAL_API_TOKEN?.trim() || undefined;
  const hmacSecret = process.env.MRI_INTERNAL_HMAC_SECRET?.trim() || undefined;
  const reviewerIdentitySource = process.env.MRI_REVIEWER_IDENTITY_SOURCE?.trim() || "request-body";
  const clockSkewToleranceMs = Number(process.env.MRI_CLOCK_SKEW_TOLERANCE_MS ?? "60000");
  const replayStoreTtlMs = Number(process.env.MRI_REPLAY_STORE_TTL_MS ?? "120000");
  const replayStoreMaxEntries = Number(process.env.MRI_REPLAY_STORE_MAX_ENTRIES ?? "10000");
  const persistenceMode: "snapshot" | "postgres" = databaseUrl ? "postgres" : "snapshot";

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  if (caseStoreMode === "postgres" && !caseStoreDatabaseUrl) {
    throw new Error("MRI_CASE_STORE_DATABASE_URL is required for postgres storage mode");
  }

  if (reviewerIdentitySource !== "request-body") {
    throw new Error("MRI_REVIEWER_IDENTITY_SOURCE must be request-body");
  }

  if (hmacSecret && Buffer.byteLength(hmacSecret, "utf-8") < 32) {
    throw new Error("MRI_INTERNAL_HMAC_SECRET must be at least 32 bytes");
  }

  if (!Number.isFinite(clockSkewToleranceMs) || clockSkewToleranceMs < 0) {
    throw new Error("MRI_CLOCK_SKEW_TOLERANCE_MS must be a non-negative number");
  }

  if (!Number.isFinite(replayStoreTtlMs) || replayStoreTtlMs <= 0) {
    throw new Error("MRI_REPLAY_STORE_TTL_MS must be a positive number");
  }

  if (!Number.isInteger(replayStoreMaxEntries) || replayStoreMaxEntries <= 0) {
    throw new Error("MRI_REPLAY_STORE_MAX_ENTRIES must be a positive integer");
  }

  const nodeEnv = process.env.NODE_ENV ?? "development";

  if (nodeEnv === "production" && !hmacSecret && !internalApiToken) {
    throw new Error("In production, set MRI_INTERNAL_HMAC_SECRET or MRI_INTERNAL_API_TOKEN to protect internal mutation routes");
  }

  return {
    nodeEnv,
    port,
    caseStoreFile,
    caseStoreMode,
    caseStoreDatabaseUrl,
    caseStoreSchema,
    databaseUrl,
    internalApiToken,
    hmacSecret,
    clockSkewToleranceMs,
    replayStoreTtlMs,
    replayStoreMaxEntries,
    persistenceMode,
    reviewerIdentitySource,
  };
}
