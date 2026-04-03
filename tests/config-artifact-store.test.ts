import test from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../src/config";

const DEFAULT_REVIEWER_JWT_SECRET = "reviewer-jwt-secret-0123456789abcdef";

function withEnv(overrides: Record<string, string | undefined>, run: () => void) {
  const original = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    original.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }

  try {
    run();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  }
}

test("getConfig parses s3-compatible artifact storage settings", () => {
  withEnv(
    {
      MRI_REVIEWER_JWT_HS256_SECRET: DEFAULT_REVIEWER_JWT_SECRET,
      MRI_ARTIFACT_STORE_PROVIDER: "s3-compatible",
      MRI_ARTIFACT_STORE_BASE_PATH: "cases-derived",
      MRI_ARTIFACT_STORE_ENDPOINT: "https://minio.example.test",
      MRI_ARTIFACT_STORE_BUCKET: "mri-artifacts",
    },
    () => {
      const config = getConfig() as Record<string, unknown>;

      assert.equal(config.artifactStoreProvider, "s3-compatible");
      assert.equal(config.artifactStoreBasePath, "cases-derived");
      assert.equal(config.artifactStoreEndpoint, "https://minio.example.test");
      assert.equal(config.artifactStoreBucket, "mri-artifacts");
    },
  );
});

test("getConfig parses explicit CORS allowlist origins", () => {
  withEnv(
    {
      MRI_REVIEWER_JWT_HS256_SECRET: DEFAULT_REVIEWER_JWT_SECRET,
      MRI_CORS_ALLOWED_ORIGINS: "https://viewer.example.test, http://127.0.0.1:4173",
    },
    () => {
      const config = getConfig() as Record<string, unknown>;

      assert.deepEqual(config.corsAllowedOrigins, ["https://viewer.example.test", "http://127.0.0.1:4173"]);
    },
  );
});