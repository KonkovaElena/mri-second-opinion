import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";

// ---------- helpers (mirrors workflow-api.test.ts patterns) ----------

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-archive-tests-"));
  return { tempDir, caseStoreFile: join(tempDir, "cases.sqlite") };
}

function buildTestConfig(
  caseStoreFile: string,
  configOverrides: Partial<AppConfig> = {},
): AppConfig {
  return {
    nodeEnv: "test",
    port: 0,
    caseStoreFile,
    caseStoreMode: "sqlite",
    archiveLookupBaseUrl: undefined,
    archiveLookupSource: undefined,
    caseStoreDatabaseUrl: undefined,
    caseStoreSchema: "public",
    databaseUrl: undefined,
    internalApiToken: undefined,
    hmacSecret: undefined,
    clockSkewToleranceMs: 60_000,
    replayStoreTtlMs: 120_000,
    replayStoreMaxEntries: 10_000,
    persistenceMode: "snapshot",
    reviewerIdentitySource: "request-body",
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
  } as AppConfig;
}

async function startServer(
  caseStoreFile: string,
  configOverrides: Partial<AppConfig> = {},
) {
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

async function withServer<T>(
  caseStoreFile: string,
  run: (helpers: {
    baseUrl: string;
    jsonRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>;
  }) => Promise<T>,
  configOverrides: Partial<AppConfig> = {},
) {
  const { app, server, baseUrl } = await startServer(caseStoreFile, configOverrides);
  try {
    return await run({
      baseUrl,
      jsonRequest: async (path: string, init?: RequestInit) => {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
        });
        const text = await response.text();
        const body = text.length > 0 ? JSON.parse(text) : null;
        return { response, body };
      },
    });
  } finally {
    await stopServer(server, async () => {
      await app.locals.caseService.close();
    });
  }
}

/**
 * Creates a mock archive HTTP server with per-UID custom responses.
 * Default: unknown studyUid → 404.
 */
async function withArchiveMock<T>(
  behavior: Record<string, { statusCode?: number; body?: unknown; delay?: number }>,
  callback: (archiveBaseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((req, res) => {
    const match = req.url?.match(/^\/studies\/(.+)$/);
    const studyUid = match ? decodeURIComponent(match[1]) : undefined;
    const entry = studyUid ? behavior[studyUid] : undefined;

    if (!entry) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "study-not-found" }));
      return;
    }

    if (entry.delay) {
      // Simulate delay (for timeout tests we use a short AbortSignal instead)
      setTimeout(() => respond(), entry.delay);
    } else {
      respond();
    }

    function respond() {
      const statusCode = entry!.statusCode ?? 200;
      const body = Buffer.from(JSON.stringify(entry!.body ?? {}), "utf-8");
      res.statusCode = statusCode;
      res.setHeader("content-type", "application/json");
      res.setHeader("content-length", String(body.length));
      res.end(body);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function validCreatePayload(studyUid: string) {
  return {
    patientAlias: "archive-test-patient",
    studyUid,
    sequenceInventory: ["T1w", "FLAIR"],
    indication: "archive error test",
  };
}

// ---------- Phase 2: Archive error type distinction tests ----------

test("archive lookup: 200 with valid payload → study context merged", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withArchiveMock(
      {
        "1.2.test.success": {
          body: {
            studyInstanceUid: "2.25.success.1",
            accessionNumber: "ACC-001",
            studyDate: "2026-01-01",
            sourceArchive: "orthanc-test",
            series: [
              {
                seriesInstanceUid: "2.25.success.1.1",
                seriesDescription: "Sag T1",
                modality: "MR",
                sequenceLabel: "T1w",
                instanceCount: 180,
              },
            ],
          },
        },
      },
      async (archiveBaseUrl) => {
        await withServer(
          caseStoreFile,
          async ({ jsonRequest }) => {
            const { response, body } = await jsonRequest("/api/cases", {
              method: "POST",
              body: JSON.stringify(validCreatePayload("1.2.test.success")),
            });

            assert.equal(response.status, 201);
            const caseId = body.case.caseId;

            const detail = await jsonRequest(`/api/cases/${caseId}`);
            assert.equal(detail.response.status, 200);
            assert.equal(detail.body.case.studyContext.studyInstanceUid, "2.25.success.1");
            assert.equal(detail.body.case.studyContext.sourceArchive, "orthanc-test");
          },
          { archiveLookupBaseUrl: archiveBaseUrl },
        );
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("archive lookup: 404 → case created without enrichment, no error", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withArchiveMock({}, async (archiveBaseUrl) => {
      await withServer(
        caseStoreFile,
        async ({ jsonRequest }) => {
          const { response, body } = await jsonRequest("/api/cases", {
            method: "POST",
            body: JSON.stringify(validCreatePayload("1.2.test.missing")),
          });

          assert.equal(response.status, 201);
            const caseId = body.case.caseId as string;
            const detail = await jsonRequest(`/api/cases/${caseId}`);
            assert.equal(detail.response.status, 200);
            // 404 → no enrichment: sourceArchive stays null, series empty
            assert.equal(detail.body.case.studyContext.sourceArchive, null);
            assert.deepEqual(detail.body.case.studyContext.series, []);
        },
        { archiveLookupBaseUrl: archiveBaseUrl },
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("archive lookup: 500 → case created without enrichment, graceful degradation", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withArchiveMock(
      {
        "1.2.test.servererror": {
          statusCode: 500,
          body: { error: "internal-server-error" },
        },
      },
      async (archiveBaseUrl) => {
        await withServer(
          caseStoreFile,
          async ({ jsonRequest }) => {
            const { response, body } = await jsonRequest("/api/cases", {
              method: "POST",
              body: JSON.stringify(validCreatePayload("1.2.test.servererror")),
            });

            // Graceful degradation: case created despite archive 500
            assert.equal(response.status, 201);
            const caseId = body.case.caseId as string;
            const detail = await jsonRequest(`/api/cases/${caseId}`);
            assert.equal(detail.response.status, 200);
            // 500 → error path → no enrichment
            assert.equal(detail.body.case.studyContext.sourceArchive, null);
            assert.deepEqual(detail.body.case.studyContext.series, []);
          },
          { archiveLookupBaseUrl: archiveBaseUrl },
        );
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("archive lookup: 200 with empty payload → treated as not-found", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withArchiveMock(
      {
        "1.2.test.emptybody": {
          statusCode: 200,
          body: {},
        },
      },
      async (archiveBaseUrl) => {
        await withServer(
          caseStoreFile,
          async ({ jsonRequest }) => {
            const { response, body } = await jsonRequest("/api/cases", {
              method: "POST",
              body: JSON.stringify(validCreatePayload("1.2.test.emptybody")),
            });

            assert.equal(response.status, 201);
            const caseId = body.case.caseId as string;
            const detail = await jsonRequest(`/api/cases/${caseId}`);
            assert.equal(detail.response.status, 200);
            // Empty body → not-found → no enrichment
            assert.equal(detail.body.case.studyContext.sourceArchive, null);
            assert.deepEqual(detail.body.case.studyContext.series, []);
          },
          { archiveLookupBaseUrl: archiveBaseUrl },
        );
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("archive lookup: not configured → case created without enrichment", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const { response, body } = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify(validCreatePayload("1.2.test.noconfig")),
      });

      // No archiveLookupBaseUrl configured → no enrichment attempt
      assert.equal(response.status, 201);
      const caseId = body.case.caseId as string;
      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.case.studyContext.sourceArchive, null);
      assert.deepEqual(detail.body.case.studyContext.series, []);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
