import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import { applyServerHardening } from "../src/http-runtime";

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-second-opinion-runtime-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.sqlite"),
  };
}

async function startServer(
  caseStoreFile: string,
  configOverrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const app = createApp({
    nodeEnv: "test",
    port: 0,
    caseStoreFile,
    caseStoreMode: "sqlite",
    ...configOverrides,
  });
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    app,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server, shutdown: () => Promise<void>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await shutdown();
}

async function withServer<T>(
  caseStoreFile: string,
  run: (helpers: { baseUrl: string }) => Promise<T>,
  configOverrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const { app, server, baseUrl } = await startServer(caseStoreFile, configOverrides);

  try {
    return await run({ baseUrl });
  } finally {
    await stopServer(server, async () => {
      await app.locals.caseService.close();
    });
  }
}

test("metrics endpoint exposes Prometheus-formatted registry output", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ baseUrl }) => {
      const casesResponse = await fetch(`${baseUrl}/api/cases`);
      assert.equal(casesResponse.status, 200);

      const metricsResponse = await fetch(`${baseUrl}/metrics`);
      const metricsBody = await metricsResponse.text();

      assert.equal(metricsResponse.status, 200);
      assert.match(metricsResponse.headers.get("content-type") ?? "", /text\/plain/);
      assert.match(metricsBody, /mri_second_opinion_http_requests_total/);
      assert.match(metricsBody, /mri_second_opinion_http_request_duration_seconds/);
      assert.match(metricsBody, /mri_second_opinion_process_cpu_user_seconds_total/);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public API rate limiting returns 429 while internal routes stay exempt", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const firstPublic = await fetch(`${baseUrl}/api/cases`);
        assert.equal(firstPublic.status, 200);

        const limitedPublic = await fetch(`${baseUrl}/api/cases`);
        const limitedBody = await limitedPublic.json();
        assert.equal(limitedPublic.status, 429);
        assert.equal(limitedBody.code, "RATE_LIMITED");
        assert.equal(typeof limitedBody.requestId, "string");

        const internal = await fetch(`${baseUrl}/api/internal/ingest`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            patientAlias: "synthetic-patient-rate-limit-001",
            studyUid: "1.2.840.rate-limit.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        const internalBody = await internal.json();

        assert.equal(internal.status, 201);
        assert.equal(internalBody.case.status, "SUBMITTED");
      },
      {
        publicApiRateLimitMaxRequests: 1,
        publicApiRateLimitWindowMs: 60_000,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("oversized JSON requests fail with a typed 413 response", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/cases`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            patientAlias: "synthetic-patient-payload-001",
            studyUid: "1.2.840.payload.1",
            sequenceInventory: ["T1w", "FLAIR"],
            indication: "x".repeat(4096),
          }),
        });
        const body = await response.json();

        assert.equal(response.status, 413);
        assert.equal(body.code, "PAYLOAD_TOO_LARGE");
        assert.match(body.error, /configured limit of 1kb/i);
      },
      {
        jsonBodyLimit: "1kb",
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("server hardening applies configured timeout and keep-alive settings", () => {
  const app = createApp({
    nodeEnv: "test",
    port: 0,
    caseStoreFile: join(tmpdir(), "mri-second-opinion-hardening.sqlite"),
    caseStoreMode: "sqlite",
  });
  const server = createServer(app);

  try {
    applyServerHardening(server, {
      nodeEnv: "test",
      port: 0,
      caseStoreFile: join(tmpdir(), "mri-second-opinion-hardening.sqlite"),
      caseStoreMode: "sqlite",
      clockSkewToleranceMs: 60_000,
      replayStoreTtlMs: 120_000,
      replayStoreMaxEntries: 10_000,
      persistenceMode: "snapshot",
      reviewerIdentitySource: "request-body",
      jsonBodyLimit: "1mb",
      publicApiRateLimitWindowMs: 900_000,
      publicApiRateLimitMaxRequests: 300,
      serverHeadersTimeoutMs: 31_000,
      serverRequestTimeoutMs: 121_000,
      serverSocketTimeoutMs: 122_000,
      serverKeepAliveTimeoutMs: 6_000,
      serverMaxRequestsPerSocket: 77,
      gracefulShutdownTimeoutMs: 10_000,
    });

    assert.equal(server.headersTimeout, 31_000);
    assert.equal(server.requestTimeout, 121_000);
    assert.equal(server.timeout, 122_000);
    assert.equal(server.keepAliveTimeout, 6_000);
    assert.equal(server.maxRequestsPerSocket, 77);
  } finally {
    server.close();
    void app.locals.caseService.close();
  }
});