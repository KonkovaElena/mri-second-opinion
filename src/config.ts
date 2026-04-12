import type { ArtifactStoreProvider } from "./case-artifact-storage";
import type { ArchiveLookupMode } from "./archive-lookup";
import type { CaseStoreMode } from "./case-repository";
import { dirname, resolve } from "node:path";

const MAX_CLOCK_SKEW_TOLERANCE_MS = 60 * 60 * 1000;

export interface AppConfig {
  nodeEnv: string;
  port: number;
  caseStoreFile: string;
  caseStoreMode: CaseStoreMode;
  inferenceLeaseRecoveryIntervalMs?: number;
  inferenceLeaseRecoveryMaxClaimAgeMs?: number;
  corsAllowedOrigins: string[];
  artifactStoreProvider: ArtifactStoreProvider;
  artifactStoreBasePath: string;
  artifactStoreEndpoint?: string;
  artifactStoreBucket?: string;
  artifactStoreRegion: string;
  artifactStoreForcePathStyle: boolean;
  artifactStorePresignTtlSeconds: number;
  archiveLookupBaseUrl?: string;
  archiveLookupSource?: string;
  archiveLookupMode: ArchiveLookupMode;
  publicStudyContextAllowedOrigins?: string[];
  caseStoreDatabaseUrl?: string;
  caseStoreSchema?: string;
  databaseUrl?: string;
  internalApiToken?: string;
  hmacSecret?: string;
  operatorApiToken?: string;
  clockSkewToleranceMs: number;
  replayStoreTtlMs: number;
  replayStoreMaxEntries: number;
  persistenceMode: "snapshot" | "postgres";
  reviewerJwtSecret: string;
  reviewerAllowedRoles: string[];
  reviewerJwksUrl?: string;
  reviewerJwksIssuer?: string;
  reviewerJwksAudience?: string;
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
export const DEFAULT_REVIEWER_ALLOWED_ROLES = ["clinician", "radiologist", "neuroradiologist"] as const;

function parsePositiveInteger(value: string, name: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string, name: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return parsed;
}

function parseBoolean(value: string, name: string) {
  const normalized = value.trim().toLowerCase();

  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new Error(`${name} must be true/false or 1/0`);
}

function parseOriginAllowlist(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parseReviewerAllowedRoles(value: string | undefined) {
  if (typeof value === "undefined") {
    return [...DEFAULT_REVIEWER_ALLOWED_ROLES];
  }

  const roles = Array.from(
    new Set(
      value
        .split(",")
        .map((role) => role.trim().toLowerCase())
        .filter((role) => role.length > 0),
    ),
  );

  if (roles.length === 0) {
    throw new Error("MRI_REVIEWER_ALLOWED_ROLES must define at least one role");
  }

  return roles;
}

export function getConfig(): AppConfig {
  const rawPort = process.env.PORT;
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  const rawCaseStoreMode = process.env.MRI_CASE_STORE_MODE ?? "sqlite";
  if (rawCaseStoreMode !== "sqlite" && rawCaseStoreMode !== "snapshot" && rawCaseStoreMode !== "postgres") {
    throw new Error(`Invalid MRI_CASE_STORE_MODE value: ${rawCaseStoreMode}`);
  }

  const caseStoreMode = rawCaseStoreMode as CaseStoreMode;
  const corsAllowedOrigins = parseOriginAllowlist(process.env.MRI_CORS_ALLOWED_ORIGINS);
  const inferenceLeaseRecoveryIntervalMs = parseNonNegativeInteger(
    process.env.MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS ?? "30000",
    "MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS",
  );
  const inferenceLeaseRecoveryMaxClaimAgeMs = parsePositiveInteger(
    process.env.MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS ?? "300000",
    "MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS",
  );
  const defaultCaseStoreFile =
    caseStoreMode === "sqlite" || caseStoreMode === "postgres"
      ? resolve(__dirname, "..", ".mri-data", "cases.sqlite")
      : resolve(__dirname, "..", ".mri-data", "cases.json");
  const caseStoreFile = process.env.MRI_CASE_STORE_FILE ?? defaultCaseStoreFile;
  const rawArtifactStoreProvider = process.env.MRI_ARTIFACT_STORE_PROVIDER?.trim() || "local-file";
  if (rawArtifactStoreProvider !== "local-file" && rawArtifactStoreProvider !== "s3-compatible") {
    throw new Error(`Invalid MRI_ARTIFACT_STORE_PROVIDER value: ${rawArtifactStoreProvider}`);
  }

  const artifactStoreProvider = rawArtifactStoreProvider as ArtifactStoreProvider;
  const defaultArtifactStoreBasePath =
    artifactStoreProvider === "s3-compatible" ? "case-artifacts" : resolve(dirname(caseStoreFile), "artifacts");
  const artifactStoreBasePath = process.env.MRI_ARTIFACT_STORE_BASE_PATH?.trim() || defaultArtifactStoreBasePath;
  const artifactStoreEndpoint = process.env.MRI_ARTIFACT_STORE_ENDPOINT?.trim() || undefined;
  const artifactStoreBucket = process.env.MRI_ARTIFACT_STORE_BUCKET?.trim() || undefined;
  const artifactStoreRegion =
    process.env.MRI_ARTIFACT_STORE_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1";
  const artifactStoreForcePathStyle = process.env.MRI_ARTIFACT_STORE_FORCE_PATH_STYLE?.trim()
    ? parseBoolean(process.env.MRI_ARTIFACT_STORE_FORCE_PATH_STYLE, "MRI_ARTIFACT_STORE_FORCE_PATH_STYLE")
    : Boolean(artifactStoreEndpoint);
  const artifactStorePresignTtlSeconds = parsePositiveInteger(
    process.env.MRI_ARTIFACT_STORE_PRESIGN_TTL_SECONDS ?? "900",
    "MRI_ARTIFACT_STORE_PRESIGN_TTL_SECONDS",
  );
  const archiveLookupBaseUrl = process.env.MRI_ARCHIVE_LOOKUP_BASE_URL?.trim() || undefined;
  const archiveLookupSource = process.env.MRI_ARCHIVE_LOOKUP_SOURCE?.trim() || undefined;
  const rawArchiveLookupMode = process.env.MRI_ARCHIVE_LOOKUP_MODE?.trim() || "custom";
  const publicStudyContextAllowedOrigins = parseOriginAllowlist(
    process.env.MRI_PUBLIC_STUDY_CONTEXT_ALLOWED_ORIGINS,
  );
  if (rawArchiveLookupMode !== "custom" && rawArchiveLookupMode !== "dicomweb") {
    throw new Error(`Invalid MRI_ARCHIVE_LOOKUP_MODE value: ${rawArchiveLookupMode}`);
  }
  const archiveLookupMode = rawArchiveLookupMode as ArchiveLookupMode;
  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const caseStoreDatabaseUrl = process.env.MRI_CASE_STORE_DATABASE_URL?.trim() || databaseUrl;
  const caseStoreSchema = process.env.MRI_CASE_STORE_SCHEMA?.trim() || "public";
  const internalApiToken = process.env.MRI_INTERNAL_API_TOKEN?.trim() || undefined;
  const hmacSecret = process.env.MRI_INTERNAL_HMAC_SECRET?.trim() || undefined;
  const operatorApiToken = process.env.MRI_OPERATOR_API_TOKEN?.trim() || undefined;
  const reviewerJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET?.trim() || "";
  const reviewerAllowedRoles = parseReviewerAllowedRoles(process.env.MRI_REVIEWER_ALLOWED_ROLES);
  const reviewerJwksUrl = process.env.MRI_REVIEWER_JWKS_URL?.trim() || undefined;
  const reviewerJwksIssuer = process.env.MRI_REVIEWER_JWKS_ISSUER?.trim() || undefined;
  const reviewerJwksAudience = process.env.MRI_REVIEWER_JWKS_AUDIENCE?.trim() || undefined;
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

  if (artifactStoreBasePath.length === 0) {
    throw new Error("MRI_ARTIFACT_STORE_BASE_PATH must not be empty");
  }

  if (artifactStoreProvider === "s3-compatible" && !artifactStoreBucket) {
    throw new Error("MRI_ARTIFACT_STORE_BUCKET is required for s3-compatible artifact storage");
  }

  if (!reviewerJwtSecret && !reviewerJwksUrl) {
    throw new Error("MRI_REVIEWER_JWT_HS256_SECRET or MRI_REVIEWER_JWKS_URL is required");
  }

  if (reviewerJwtSecret && Buffer.byteLength(reviewerJwtSecret, "utf-8") < 32) {
    throw new Error("MRI_REVIEWER_JWT_HS256_SECRET must be at least 32 bytes");
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

  if (clockSkewToleranceMs > MAX_CLOCK_SKEW_TOLERANCE_MS) {
    throw new Error("MRI_CLOCK_SKEW_TOLERANCE_MS must be at most 3600000ms");
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

  if (nodeEnv === "production" && !operatorApiToken) {
    throw new Error("MRI_OPERATOR_API_TOKEN is required in production to protect public data endpoints");
  }

  return {
    nodeEnv,
    port,
    caseStoreFile,
    caseStoreMode,
    inferenceLeaseRecoveryIntervalMs,
    inferenceLeaseRecoveryMaxClaimAgeMs,
    corsAllowedOrigins,
    artifactStoreProvider,
    artifactStoreBasePath,
    artifactStoreEndpoint,
    artifactStoreBucket,
    artifactStoreRegion,
    artifactStoreForcePathStyle,
    artifactStorePresignTtlSeconds,
    archiveLookupBaseUrl,
    archiveLookupSource,
    archiveLookupMode,
    publicStudyContextAllowedOrigins,
    caseStoreDatabaseUrl,
    caseStoreSchema,
    databaseUrl,
    internalApiToken,
    hmacSecret,
    operatorApiToken,
    clockSkewToleranceMs,
    replayStoreTtlMs,
    replayStoreMaxEntries,
    persistenceMode,
    reviewerJwtSecret,
    reviewerAllowedRoles,
    reviewerJwksUrl,
    reviewerJwksIssuer,
    reviewerJwksAudience,
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
