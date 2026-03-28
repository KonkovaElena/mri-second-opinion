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
  jsonBodyLimit: string;
  publicApiRateLimitWindowMs: number;
  publicApiRateLimitMaxRequests: number;
  serverHeadersTimeoutMs: number;
  serverRequestTimeoutMs: number;
  serverSocketTimeoutMs: number;
  serverKeepAliveTimeoutMs: number;
  serverMaxRequestsPerSocket: number;
  gracefulShutdownTimeoutMs: number;
}

const DEFAULT_PORT = 4010;

function parsePositiveInteger(value: string, name: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

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
  const jsonBodyLimit = process.env.MRI_JSON_BODY_LIMIT?.trim() || "1mb";
  const publicApiRateLimitWindowMs = parsePositiveInteger(
    process.env.MRI_PUBLIC_RATE_LIMIT_WINDOW_MS ?? "900000",
    "MRI_PUBLIC_RATE_LIMIT_WINDOW_MS",
  );
  const publicApiRateLimitMaxRequests = parsePositiveInteger(
    process.env.MRI_PUBLIC_RATE_LIMIT_MAX_REQUESTS ?? "300",
    "MRI_PUBLIC_RATE_LIMIT_MAX_REQUESTS",
  );
  const serverHeadersTimeoutMs = parsePositiveInteger(
    process.env.MRI_SERVER_HEADERS_TIMEOUT_MS ?? "30000",
    "MRI_SERVER_HEADERS_TIMEOUT_MS",
  );
  const serverRequestTimeoutMs = parsePositiveInteger(
    process.env.MRI_SERVER_REQUEST_TIMEOUT_MS ?? "120000",
    "MRI_SERVER_REQUEST_TIMEOUT_MS",
  );
  const serverSocketTimeoutMs = parsePositiveInteger(
    process.env.MRI_SERVER_SOCKET_TIMEOUT_MS ?? "120000",
    "MRI_SERVER_SOCKET_TIMEOUT_MS",
  );
  const serverKeepAliveTimeoutMs = parsePositiveInteger(
    process.env.MRI_SERVER_KEEP_ALIVE_TIMEOUT_MS ?? "5000",
    "MRI_SERVER_KEEP_ALIVE_TIMEOUT_MS",
  );
  const serverMaxRequestsPerSocket = parsePositiveInteger(
    process.env.MRI_SERVER_MAX_REQUESTS_PER_SOCKET ?? "100",
    "MRI_SERVER_MAX_REQUESTS_PER_SOCKET",
  );
  const gracefulShutdownTimeoutMs = parsePositiveInteger(
    process.env.MRI_GRACEFUL_SHUTDOWN_TIMEOUT_MS ?? "10000",
    "MRI_GRACEFUL_SHUTDOWN_TIMEOUT_MS",
  );

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  if (caseStoreMode === "postgres" && !caseStoreDatabaseUrl) {
    throw new Error("MRI_CASE_STORE_DATABASE_URL is required for postgres storage mode");
  }

  if (reviewerIdentitySource !== "request-body") {
    throw new Error("MRI_REVIEWER_IDENTITY_SOURCE must be request-body");
  }

  if (jsonBodyLimit.length === 0) {
    throw new Error("MRI_JSON_BODY_LIMIT must not be empty");
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
    jsonBodyLimit,
    publicApiRateLimitWindowMs,
    publicApiRateLimitMaxRequests,
    serverHeadersTimeoutMs,
    serverRequestTimeoutMs,
    serverSocketTimeoutMs,
    serverKeepAliveTimeoutMs,
    serverMaxRequestsPerSocket,
    gracefulShutdownTimeoutMs,
  };
}
