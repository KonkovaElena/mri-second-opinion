import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";

const DEFAULT_INTERNAL_API_TOKEN = "test-internal-token-secret-001";
const DEFAULT_OPERATOR_API_TOKEN = "test-operator-token-secret-001";
const DEFAULT_REVIEWER_JWT_SECRET = "reviewer-jwt-secret-0123456789abcdef";

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-pagination-tests-"));
  return { tempDir, caseStoreFile: join(tempDir, "cases.sqlite") };
}

function buildTestConfig(caseStoreFile: string, configOverrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    port: 0,
    caseStoreFile,
    caseStoreMode: "sqlite",
    inferenceLeaseRecoveryIntervalMs: undefined,
    inferenceLeaseRecoveryMaxClaimAgeMs: undefined,
    corsAllowedOrigins: [],
    artifactStoreProvider: "local-file",
    artifactStoreBasePath: join(dirnameSafe(caseStoreFile), "artifacts"),
    artifactStoreEndpoint: undefined,
    artifactStoreBucket: undefined,
    artifactStoreRegion: "us-east-1",
    artifactStoreForcePathStyle: true,
    artifactStorePresignTtlSeconds: 900,
    archiveLookupBaseUrl: undefined,
    archiveLookupSource: undefined,
    archiveLookupMode: "custom",
    caseStoreDatabaseUrl: undefined,
    caseStoreSchema: "public",
    databaseUrl: undefined,
    internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
    hmacSecret: undefined,
    operatorApiToken: DEFAULT_OPERATOR_API_TOKEN,
    clockSkewToleranceMs: 60_000,
    replayStoreTtlMs: 120_000,
    replayStoreMaxEntries: 10_000,
    persistenceMode: "snapshot",
    reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
    reviewerAllowedRoles: ["clinician", "radiologist", "neuroradiologist"],
    reviewerJwksUrl: undefined,
    reviewerJwksIssuer: undefined,
    reviewerJwksAudience: undefined,
    jsonBodyLimit: "1mb",
    publicApiRateLimitWindowMs: 900_000,
    publicApiRateLimitMaxRequests: 300,
    serverHeadersTimeoutMs: 30_000,
    serverRequestTimeoutMs: 120_000,
    serverSocketTimeoutMs: 120_000,
    serverKeepAliveTimeoutMs: 5_000,
    serverMaxRequestsPerSocket: 100,
    gracefulShutdownTimeoutMs: 10_000,
    ...configOverrides,
  };
}

function dirnameSafe(path: string) {
  return path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
}

async function startServer(caseStoreFile: string, configOverrides: Partial<AppConfig> = {}) {
  const app = createApp(buildTestConfig(caseStoreFile, configOverrides));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { app, server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: Server, shutdown: () => Promise<void>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await shutdown();
}

function withOperatorAuth(headers?: HeadersInit) {
  return {
    "content-type": "application/json",
    "x-api-key": DEFAULT_OPERATOR_API_TOKEN,
    ...(headers ?? {}),
  };
}

async function jsonRequest(baseUrl: string, path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: withOperatorAuth(init?.headers),
  });
  const text = await response.text();
  return {
    response,
    body: text.length > 0 ? JSON.parse(text) : null,
  };
}

test("GET /api/cases supports limit/offset pagination with stable totals", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { app, server, baseUrl } = await startServer(caseStoreFile);

    try {
      for (const studyUid of ["study-1", "study-2", "study-3"]) {
        const created = await jsonRequest(baseUrl, "/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: `patient-${studyUid}`,
            studyUid,
            sequenceInventory: ["T1w"],
            indication: "pagination-test",
          }),
        });
        assert.equal(created.response.status, 201);
      }

      const pageOne = await jsonRequest(baseUrl, "/api/cases?limit=2&offset=0");
      assert.equal(pageOne.response.status, 200);
      assert.equal(pageOne.body.meta.totalCases, 3);
      assert.equal(pageOne.body.meta.limit, 2);
      assert.equal(pageOne.body.meta.offset, 0);
      assert.equal(pageOne.body.cases.length, 2);

      const pageTwo = await jsonRequest(baseUrl, "/api/cases?limit=2&offset=2");
      assert.equal(pageTwo.response.status, 200);
      assert.equal(pageTwo.body.meta.totalCases, 3);
      assert.equal(pageTwo.body.meta.limit, 2);
      assert.equal(pageTwo.body.meta.offset, 2);
      assert.equal(pageTwo.body.cases.length, 1);
    } finally {
      await stopServer(server, async () => {
        await app.locals.caseService.close();
      });
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("GET /api/cases rejects invalid pagination values", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { app, server, baseUrl } = await startServer(caseStoreFile);

    try {
      const invalidLimit = await jsonRequest(baseUrl, "/api/cases?limit=0");
      assert.equal(invalidLimit.response.status, 400);
      assert.equal(invalidLimit.body.code, "INVALID_INPUT");

      const invalidOffset = await jsonRequest(baseUrl, "/api/cases?offset=-1");
      assert.equal(invalidOffset.response.status, 400);
      assert.equal(invalidOffset.body.code, "INVALID_INPUT");
    } finally {
      await stopServer(server, async () => {
        await app.locals.caseService.close();
      });
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("GET /api/cases returns an empty page when offset exceeds total cases", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { app, server, baseUrl } = await startServer(caseStoreFile);

    try {
      const created = await jsonRequest(baseUrl, "/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "patient-study-1",
          studyUid: "study-1",
          sequenceInventory: ["T1w"],
          indication: "pagination-empty-page-test",
        }),
      });
      assert.equal(created.response.status, 201);

      const page = await jsonRequest(baseUrl, "/api/cases?limit=10&offset=5");
      assert.equal(page.response.status, 200);
      assert.equal(page.body.meta.totalCases, 1);
      assert.equal(page.body.meta.limit, 10);
      assert.equal(page.body.meta.offset, 5);
      assert.deepEqual(page.body.cases, []);
    } finally {
      await stopServer(server, async () => {
        await app.locals.caseService.close();
      });
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
