import test from "node:test";
import assert from "node:assert/strict";
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

const STUDY_INCLUDE_FIELDS = ["0020000D", "00080050", "00080020"];
const SERIES_INCLUDE_FIELDS = ["0020000E", "0008103E", "00080060", "00201208"];

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-archive-dicomweb-tests-"));
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
    archiveLookupMode: "custom",
    publicStudyContextAllowedOrigins: [],
    corsAllowedOrigins: [],
    artifactStoreProvider: "local-file",
    artifactStoreBasePath: join(tmpdir(), "mri-artifacts"),
    artifactStoreEndpoint: undefined,
    artifactStoreBucket: undefined,
    artifactStoreRegion: "us-east-1",
    artifactStoreForcePathStyle: false,
    artifactStorePresignTtlSeconds: 900,
    caseStoreDatabaseUrl: undefined,
    caseStoreSchema: "public",
    databaseUrl: undefined,
    inferenceLeaseRecoveryIntervalMs: 0,
    inferenceLeaseRecoveryMaxClaimAgeMs: 300_000,
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
  } as AppConfig;
}

function isInternalProtectedPath(path: string) {
  return /^\/api\/internal(\/|$)/.test(path);
}

function isOperatorProtectedPath(path: string) {
  return /^\/api\/(cases|operations|delivery)(\/|$)/.test(path);
}

function withImplicitAuth(path: string, headers: HeadersInit | undefined) {
  const normalizedHeaders = new Headers(headers ?? {});

  if (isInternalProtectedPath(path) && !normalizedHeaders.has("authorization")) {
    normalizedHeaders.set("authorization", `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`);
  }

  if (isOperatorProtectedPath(path) && !normalizedHeaders.has("x-api-key")) {
    normalizedHeaders.set("x-api-key", DEFAULT_OPERATOR_API_TOKEN);
  }

  return normalizedHeaders;
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
    jsonRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>;
  }) => Promise<T>,
  configOverrides: Partial<AppConfig> = {},
) {
  const { app, server, baseUrl } = await startServer(caseStoreFile, configOverrides);
  try {
    return await run({
      jsonRequest: async (path: string, init?: RequestInit) => {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: withImplicitAuth(path, { "content-type": "application/json", ...(init?.headers ?? {}) }),
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

function validCreatePayload(studyUid: string) {
  return {
    patientAlias: "archive-dicomweb-test-patient",
    studyUid,
    sequenceInventory: ["T1w", "FLAIR"],
    indication: "archive dicomweb test",
  };
}

function buildDicomJsonValue(value: string | number) {
  return { Value: [value] };
}

async function withDicomWebMock<T>(
  handler: (requestUrl: URL, response: import("node:http").ServerResponse) => void,
  callback: (archiveBaseUrl: string) => Promise<T>,
) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    handler(requestUrl, response);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;

  try {
    return await callback(`http://127.0.0.1:${address.port}/dicom-web`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("dicomweb archive lookup enriches case intake via QIDO-RS and canonical study resource paths", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const requestedStudyUid = "1.2.840.71001";
  const canonicalStudyInstanceUid = "2.25.71001";
  const seriesInstanceUid = "2.25.71001.1";

  try {
    await withDicomWebMock((requestUrl, response) => {
      if (requestUrl.pathname === "/dicom-web/studies") {
        assert.equal(requestUrl.searchParams.get("StudyInstanceUID"), requestedStudyUid);
        assert.equal(requestUrl.searchParams.get("limit"), "1");
        assert.deepEqual(requestUrl.searchParams.getAll("includefield"), STUDY_INCLUDE_FIELDS);

        response.statusCode = 200;
        response.setHeader("content-type", "application/dicom+json");
        response.end(JSON.stringify([
          {
            "0020000D": buildDicomJsonValue(canonicalStudyInstanceUid),
            "00080050": buildDicomJsonValue("ACC-DW-001"),
            "00080020": buildDicomJsonValue("20260414"),
          },
        ]));
        return;
      }

      if (requestUrl.pathname === `/dicom-web/studies/${encodeURIComponent(canonicalStudyInstanceUid)}/series`) {
        assert.deepEqual(requestUrl.searchParams.getAll("includefield"), SERIES_INCLUDE_FIELDS);

        response.statusCode = 200;
        response.setHeader("content-type", "application/dicom+json");
        response.end(JSON.stringify([
          {
            "0020000E": buildDicomJsonValue(seriesInstanceUid),
            "0008103E": buildDicomJsonValue("Sag T1 MPRAGE"),
            "00080060": buildDicomJsonValue("MR"),
            "00201208": buildDicomJsonValue(176),
          },
        ]));
        return;
      }

      response.statusCode = 404;
      response.end();
    }, async (archiveBaseUrl) => {
      await withServer(
        caseStoreFile,
        async ({ jsonRequest }) => {
          const created = await jsonRequest("/api/cases", {
            method: "POST",
            body: JSON.stringify(validCreatePayload(requestedStudyUid)),
          });

          assert.equal(created.response.status, 201);
          const caseId = created.body.case.caseId as string;

          const detail = await jsonRequest(`/api/cases/${caseId}`);
          assert.equal(detail.response.status, 200);
          assert.equal(detail.body.case.studyContext.studyInstanceUid, canonicalStudyInstanceUid);
          assert.equal(detail.body.case.studyContext.accessionNumber, "ACC-DW-001");
          assert.equal(detail.body.case.studyContext.studyDate, "20260414");
          assert.equal(detail.body.case.studyContext.sourceArchive, "orthanc-dicomweb");
          assert.equal(detail.body.case.studyContext.dicomWebBaseUrl, `${archiveBaseUrl}/`);
          assert.equal(detail.body.case.studyContext.series.length, 1);
          assert.equal(detail.body.case.studyContext.series[0].seriesInstanceUid, seriesInstanceUid);
          assert.equal(
            detail.body.case.studyContext.series[0].volumeDownloadUrl,
            `${archiveBaseUrl}/studies/${encodeURIComponent(canonicalStudyInstanceUid)}/series/${encodeURIComponent(seriesInstanceUid)}`,
          );
        },
        {
          archiveLookupBaseUrl: archiveBaseUrl,
          archiveLookupMode: "dicomweb",
          archiveLookupSource: "orthanc-dicomweb",
        },
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dicomweb archive lookup keeps study-level enrichment when Study's Series query fails", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const requestedStudyUid = "1.2.840.71002";

  try {
    await withDicomWebMock((requestUrl, response) => {
      if (requestUrl.pathname === "/dicom-web/studies") {
        response.statusCode = 200;
        response.setHeader("content-type", "application/dicom+json");
        response.end(JSON.stringify([
          {
            "0020000D": buildDicomJsonValue(requestedStudyUid),
            "00080050": buildDicomJsonValue("ACC-DW-002"),
            "00080020": buildDicomJsonValue("20260415"),
          },
        ]));
        return;
      }

      if (requestUrl.pathname === `/dicom-web/studies/${encodeURIComponent(requestedStudyUid)}/series`) {
        response.statusCode = 500;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: "series-query-failed" }));
        return;
      }

      response.statusCode = 404;
      response.end();
    }, async (archiveBaseUrl) => {
      await withServer(
        caseStoreFile,
        async ({ jsonRequest }) => {
          const created = await jsonRequest("/api/cases", {
            method: "POST",
            body: JSON.stringify(validCreatePayload(requestedStudyUid)),
          });

          assert.equal(created.response.status, 201);
          const caseId = created.body.case.caseId as string;

          const detail = await jsonRequest(`/api/cases/${caseId}`);
          assert.equal(detail.response.status, 200);
          assert.equal(detail.body.case.studyContext.studyInstanceUid, requestedStudyUid);
          assert.equal(detail.body.case.studyContext.accessionNumber, "ACC-DW-002");
          assert.equal(detail.body.case.studyContext.studyDate, "20260415");
          assert.equal(detail.body.case.studyContext.sourceArchive, "orthanc-dicomweb");
          assert.equal(detail.body.case.studyContext.dicomWebBaseUrl, `${archiveBaseUrl}/`);
          assert.deepEqual(detail.body.case.studyContext.series, []);
        },
        {
          archiveLookupBaseUrl: archiveBaseUrl,
          archiveLookupMode: "dicomweb",
          archiveLookupSource: "orthanc-dicomweb",
        },
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});