import { resolve } from "node:path";
import { createDefaultArtifactStoreConfig, type ArtifactStoreConfig } from "./artifact-store";
import { createDefaultDispatchQueueConfig, type DispatchQueueConfig } from "./dispatch-queue";

export interface AppConfig {
  nodeEnv: string;
  port: number;
  caseStoreFile: string;
  databaseUrl?: string;
  internalApiToken?: string;
  hmacSecret?: string;
  clockSkewToleranceMs: number;
  replayStoreTtlMs: number;
  replayStoreMaxEntries: number;
  persistenceMode: "snapshot" | "postgres";
  reviewerIdentitySource: "request-body";
  artifactStore: ArtifactStoreConfig;
  dispatchQueue?: DispatchQueueConfig;
}

const DEFAULT_PORT = 4010;

export function getConfig(): AppConfig {
  const rawPort = process.env.PORT;
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  const caseStoreFile = process.env.MRI_CASE_STORE_FILE ?? resolve(__dirname, "..", ".mri-data", "cases.json");
  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const internalApiToken = process.env.MRI_INTERNAL_API_TOKEN?.trim() || undefined;
  const hmacSecret = process.env.MRI_INTERNAL_HMAC_SECRET?.trim() || undefined;
  const reviewerIdentitySource = process.env.MRI_REVIEWER_IDENTITY_SOURCE?.trim() || "request-body";
  const clockSkewToleranceMs = Number(process.env.MRI_CLOCK_SKEW_TOLERANCE_MS ?? "60000");
  const replayStoreTtlMs = Number(process.env.MRI_REPLAY_STORE_TTL_MS ?? "120000");
  const replayStoreMaxEntries = Number(process.env.MRI_REPLAY_STORE_MAX_ENTRIES ?? "10000");
  const defaultArtifactStore = createDefaultArtifactStoreConfig();
  const defaultDispatchQueue = createDefaultDispatchQueueConfig();
  const artifactStoreProvider = process.env.MRI_ARTIFACT_STORE_PROVIDER?.trim() || defaultArtifactStore.provider;
  const artifactStoreBasePath = process.env.MRI_ARTIFACT_STORE_BASE_PATH?.trim() || defaultArtifactStore.basePath;
  const artifactStoreEndpoint = process.env.MRI_ARTIFACT_STORE_ENDPOINT?.trim() || null;
  const artifactStoreBucket = process.env.MRI_ARTIFACT_STORE_BUCKET?.trim() || null;
  const dispatchQueueProvider = process.env.MRI_QUEUE_PROVIDER?.trim() || defaultDispatchQueue.provider;
  const redisUrl = process.env.MRI_REDIS_URL?.trim() || defaultDispatchQueue.redisUrl;
  const queueKeyPrefix = process.env.MRI_QUEUE_KEY_PREFIX?.trim() || defaultDispatchQueue.keyPrefix;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort} (must be integer 1-65535)`);
  }

  if (databaseUrl && !databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
    throw new Error("DATABASE_URL must start with postgresql:// or postgres://");
  }

  if (hmacSecret && Buffer.byteLength(hmacSecret, "utf-8") < 32) {
    throw new Error("MRI_INTERNAL_HMAC_SECRET must be at least 32 bytes");
  }

  if (reviewerIdentitySource !== "request-body") {
    throw new Error("MRI_REVIEWER_IDENTITY_SOURCE must be request-body");
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

  if (artifactStoreProvider !== "local-file" && artifactStoreProvider !== "s3-compatible") {
    throw new Error("MRI_ARTIFACT_STORE_PROVIDER must be local-file or s3-compatible");
  }

  if (!artifactStoreBasePath) {
    throw new Error("MRI_ARTIFACT_STORE_BASE_PATH must be set");
  }

  if (dispatchQueueProvider !== "local" && dispatchQueueProvider !== "redis") {
    throw new Error("MRI_QUEUE_PROVIDER must be local or redis");
  }

  if (dispatchQueueProvider === "redis" && !redisUrl) {
    throw new Error("MRI_REDIS_URL must be set when MRI_QUEUE_PROVIDER=redis");
  }

  if (!queueKeyPrefix) {
    throw new Error("MRI_QUEUE_KEY_PREFIX must be set");
  }

  const nodeEnv = process.env.NODE_ENV ?? "development";

  if (nodeEnv === "production" && !hmacSecret && !internalApiToken) {
    throw new Error("In production, set MRI_INTERNAL_HMAC_SECRET or MRI_INTERNAL_API_TOKEN to protect internal mutation routes");
  }

  return {
    nodeEnv,
    port,
    caseStoreFile,
    databaseUrl,
    internalApiToken,
    hmacSecret,
    clockSkewToleranceMs,
    replayStoreTtlMs,
    replayStoreMaxEntries,
    persistenceMode: databaseUrl ? "postgres" : "snapshot",
    reviewerIdentitySource,
    artifactStore: {
      provider: artifactStoreProvider,
      basePath: artifactStoreBasePath,
      endpoint: artifactStoreEndpoint,
      bucket: artifactStoreBucket,
    },
    dispatchQueue: {
      provider: dispatchQueueProvider,
      redisUrl: dispatchQueueProvider === "redis" ? redisUrl : undefined,
      keyPrefix: queueKeyPrefix,
    },
  };
}
